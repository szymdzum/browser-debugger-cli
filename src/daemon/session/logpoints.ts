/**
 * Logpoints (#848): breakpoints whose condition logs values and answers
 * `false`, so the page never pauses. One module holds the registry, the ids,
 * the stored hits and the CDP calls: `Debugger` is enabled with the first
 * logpoint and disabled after the last is cleared; pauses are skipped while
 * any exists (`Debugger.setSkipAllPauses`, sent again after every
 * navigation), and a pause that happens anyway is resumed. Hits reach the
 * daemon through a `Runtime.addBinding` binding, see `logpointCondition.ts`.
 */

import type { Protocol } from 'devtools-protocol/types/protocol.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { sendTyped } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  duplicateLogpointError,
  logpointFileNotLoadedWarning,
  logpointNoCodeError,
  logpointNoMappedCodeError,
  logpointNotFoundError,
  logpointSourceMapWarning,
  logpointSyntaxError,
  MAX_LOGPOINTS,
  tooManyLogpointsError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import type {
  DebugClearData,
  DebugHitsCommand,
  DebugHitsData,
  DebugListData,
  DebugLogCommand,
  DebugLogData,
  LogpointActionHit,
  LogpointBound,
  LogpointHit,
  LogpointValue,
} from '@/ipc/protocol/debugTypes.js';
import { withTdzHint } from '@/ui/messages/commands.js';
import { raceTimeout } from '@/utils/async.js';
import { createLogger } from '@/ui/logging/index.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { logpointPlace, scriptUrlPattern } from '@/utils/logpointLocation.js';
import { findSimilar } from '@/utils/suggestions.js';

import {
  buildLogpointCondition,
  LOGPOINT_BINDING,
  readLogpointCountersExpression,
} from './logpointCondition.js';
import { SourceMapReader, type MappedPlace, type MappedScript } from './logpointSourceMaps.js';

const log = createLogger('session');

/** Hits stored per logpoint per page load */
const MAX_STORED_HITS = 100;

/** Hits logged per page load by default (the rest are counted as dropped) */
const DEFAULT_MAX_HITS = 100;

/** Hits kept per logpoint over all page loads (the oldest go first) */
const MAX_RETAINED_HITS = 1000;

/** How long ending the session waits for Chrome to take the logpoints back */
const SHUTDOWN_WAIT_MS = 500;

/** Hits `debug hits` shows by default */
const DEFAULT_SHOWN_HITS = 20;

/** A script Chrome parsed */
interface Script extends MappedScript {
  url: string;
  endLine: number;
  endColumn: number;
}

/** A hit as the page reported it */
interface ParsedHit {
  id: string;
  values: LogpointValue[];
  /** Messages of the expressions that threw, by index */
  failures: Record<string, string>;
  url?: string;
  /** The guard threw */
  error?: string;
}

/** A stored hit with its place in the order hits arrived */
interface StoredHit extends LogpointHit {
  seq: number;
}

/** What a logpoint's breakpoint is built from */
interface LogpointSpec {
  id: string;
  file: string;
  line: number;
  column?: number | undefined;
  expressions: string[];
  guard?: string | undefined;
  max: number;
}

/** A logpoint in the registry */
interface Logpoint extends LogpointSpec {
  /** The breakpoint by the file as typed first, then one per generated position of a source map */
  breakpointIds: string[];
  /** Original place of each breakpoint set from a source map, by breakpoint */
  sources: Map<string, { file: string; line: number }>;
  /** Scripts whose source map this logpoint was set from (`url` and map URL) */
  mappedScripts: Set<string>;
  bound: LogpointBound[];
  /** Stored hits, oldest first */
  hits: StoredHit[];
  /** Hits received, stored or not */
  received: number;
  /** Errors of expressions received, and the last message */
  errorsReceived: number;
  lastError?: string;
  /** The page load `storedInLoad` counts */
  loadId: number;
  storedInLoad: number;
}

/** A point in the arrival of hits, to tell which came later (see {@link Logpoints.hitsSince}) */
export interface HitMark {
  seq: number;
  received: ReadonlyMap<string, number>;
  errors: ReadonlyMap<string, number>;
}

/** Counters the condition keeps in the page, by logpoint id */
type PageCounters = Record<string, { hits: number; errors: number; last: string } | undefined>;

/**
 * A command error with an exit code.
 *
 * @param error - Message and suggestion
 * @param exitCode - Exit code
 * @returns Error to throw
 */
function commandError(error: ErrorWithSuggestion, exitCode: number): CommandError {
  return new CommandError(error.message, { suggestion: error.suggestion }, exitCode);
}

/**
 * Last line of a script as an editor numbers it (a final newline does not
 * start another line).
 *
 * @param script - Parsed script
 * @returns 1-based line
 */
function lastLine(script: Script): number {
  return script.endColumn === 0 && script.endLine > 0 ? script.endLine : script.endLine + 1;
}

/**
 * The script a condition ran in, from its own stack frame
 * (`at eval (eval at fn (http://h/a.js:8:16), <anonymous>:29:1)`).
 *
 * @param frame - The condition's stack frame
 * @returns Script URL as shown (credentials and tokens masked), or undefined
 */
function scriptOfFrame(frame: string): string | undefined {
  const url = /eval at [^(]*\((.+?):\d+:\d+\)/.exec(frame)?.[1];
  return url === undefined ? undefined : displayUrl(url);
}

/**
 * Chrome's message for an expression it cannot compile.
 *
 * @param details - Exception of `Runtime.compileScript`
 * @returns First line of the description
 */
function compileMessage(details: Protocol.Runtime.ExceptionDetails): string {
  const text = details.exception?.description ?? details.text;
  return text.split('\n')[0] ?? text;
}

/**
 * The session's logpoints.
 */
export class Logpoints {
  private readonly points = new Map<string, Logpoint>();
  private nextId = 1;
  private seq = 0;
  /** Scripts of the page now loaded (known while `Debugger` is enabled) */
  private readonly scripts = new Map<string, Script>();
  /** `Debugger` is enabled, pauses are skipped and the binding exists */
  private enabled = false;
  private working: Promise<unknown> = Promise.resolve();
  private readonly maps = new SourceMapReader();

  /**
   * @param navigationId - Id of the page load now current
   */
  constructor(private readonly navigationId: () => number) {}

  /** How many logpoints exist */
  get size(): number {
    return this.points.size;
  }

  /**
   * Listen for what logpoints need from a page connection: scripts, bound
   * locations, hits and pauses. On a tab the session moves to, existing
   * logpoints are set again there.
   *
   * @param cdp - The tab's connection
   * @returns Stops listening
   */
  follow(cdp: CDPConnection): () => void {
    this.scripts.clear();
    this.maps.clear();
    const stops = [
      cdp.on<Protocol.Debugger.ScriptParsedEvent>('Debugger.scriptParsed', (event) => {
        if (!event.url) return;
        const script = {
          url: event.url,
          endLine: event.endLine,
          endColumn: event.endColumn,
          ...(event.sourceMapURL && { sourceMapURL: event.sourceMapURL }),
        };
        this.scripts.set(event.scriptId, script);
        if (script.sourceMapURL) this.mapLoadedScript(cdp, script);
      }),
      cdp.on('Debugger.globalObjectCleared', () => this.pageCleared(cdp)),
      cdp.on<Protocol.Debugger.BreakpointResolvedEvent>('Debugger.breakpointResolved', (event) => {
        const point = this.byBreakpoint(event.breakpointId);
        if (point) this.addBound(point, event.location, event.breakpointId);
      }),
      cdp.on<Protocol.Runtime.BindingCalledEvent>('Runtime.bindingCalled', (event) => {
        if (event.name === LOGPOINT_BINDING) this.receive(event.payload);
      }),
      cdp.on('Debugger.paused', () => {
        if (this.points.size === 0) return;
        void cdp
          .send('Debugger.resume')
          .catch((error: unknown) => log.debug(`Not resumed: ${getErrorMessage(error)}`));
      }),
    ];
    if (this.enabled) void this.serialized(() => this.rebind(cdp));
    return () => stops.forEach((stop) => stop());
  }

  /**
   * Set a logpoint.
   *
   * @param cdp - Page connection
   * @param params - Where, what to log, guard and limit
   * @returns The logpoint, bound or pending
   * @throws CommandError (81 invalid expression or too many, 83 no such script or line, 84 duplicate)
   */
  add(cdp: CDPConnection, params: DebugLogCommand): Promise<DebugLogData> {
    return this.serialized(() => this.addNow(cdp, params));
  }

  /**
   * Every logpoint with the page's counters.
   *
   * @param cdp - Page connection
   * @returns Logpoints, oldest first
   */
  async list(cdp: CDPConnection): Promise<DebugListData> {
    const counters = await this.readCounters(cdp);
    return {
      logpoints: [...this.points.values()].map((point) => {
        const counted = counters[point.id];
        const hits = counted?.hits ?? 0;
        return {
          id: point.id,
          file: point.file,
          line: point.line,
          ...(point.column !== undefined && { column: point.column }),
          expressions: point.expressions,
          ...(point.guard !== undefined && { guard: point.guard }),
          state: point.bound.length > 0 ? ('bound' as const) : ('pending' as const),
          bound: point.bound,
          hits,
          dropped: Math.max(0, hits - point.max),
          errors: counted?.errors ?? 0,
          ...(counted?.last && { lastError: withTdzHint(counted.last) }),
        };
      }),
    };
  }

  /**
   * What logpoints logged.
   *
   * @param params - Logpoint, count and whether to include earlier page loads
   * @returns Hits, oldest first
   * @throws CommandError (83) for an id no logpoint has
   */
  hits(params: DebugHitsCommand): DebugHitsData {
    const points = params.id === undefined ? [...this.points.values()] : [this.find(params.id)];
    const navigation = this.navigationId();
    const matching = points
      .flatMap((point) => point.hits)
      .filter((hit) => params.allPages === true || hit.navigationId === navigation)
      .sort((a, b) => a.seq - b.seq);
    const last = params.last ?? DEFAULT_SHOWN_HITS;
    const shown = matching.slice(-last).map(({ seq: _seq, ...hit }) => hit);
    const omitted = matching.length - shown.length;
    return { hits: shown, ...(omitted > 0 && { omitted }) };
  }

  /**
   * Remove one logpoint, or all.
   *
   * @param cdp - Page connection
   * @param id - Logpoint (none: all)
   * @returns Ids removed
   * @throws CommandError (83) for an id no logpoint has
   */
  clear(cdp: CDPConnection, id?: string): Promise<DebugClearData> {
    return this.serialized(async () => {
      const removed = id === undefined ? [...this.points.values()] : [this.find(id)];
      for (const point of removed) {
        this.points.delete(point.id);
        for (const breakpointId of point.breakpointIds) {
          await sendTyped(cdp, 'Debugger.removeBreakpoint', { breakpointId }).catch(
            (error: unknown) => log.debug(`Not removed: ${getErrorMessage(error)}`)
          );
        }
      }
      if (this.points.size === 0) await this.turnOff(cdp);
      return { cleared: removed.map((point) => point.id) };
    });
  }

  /**
   * End the session's logpoints: leave the page's Chrome as it was (binding
   * removed, pauses allowed, `Debugger` disabled; best effort, a moment at
   * most) and forget them.
   *
   * @param cdp - The session's page connection
   */
  async shutdown(cdp: CDPConnection): Promise<void> {
    const wasEnabled = this.enabled;
    this.points.clear();
    this.scripts.clear();
    this.enabled = false;
    if (wasEnabled) await raceTimeout(this.release(cdp), SHUTDOWN_WAIT_MS);
  }

  /**
   * Leave a tab the session moved away from as it was; the logpoints stay
   * and are set again on the tab the session moved to.
   *
   * @param cdp - The tab's connection
   */
  async leave(cdp: CDPConnection): Promise<void> {
    if (this.enabled) await raceTimeout(this.release(cdp), SHUTDOWN_WAIT_MS);
  }

  /**
   * A mark for {@link hitsSince}: taken as an action starts.
   *
   * @returns Mark
   */
  hitMark(): HitMark {
    const points = [...this.points.values()];
    return {
      seq: this.seq,
      received: new Map(points.map((point) => [point.id, point.received])),
      errors: new Map(points.map((point) => [point.id, point.errorsReceived])),
    };
  }

  /**
   * What logpoints logged since a mark: per logpoint the first stored hit's
   * values and how many hits there were.
   *
   * @param mark - From {@link hitMark}
   * @returns One entry per logpoint that was hit, oldest logpoint first
   */
  hitsSince(mark: HitMark): LogpointActionHit[] {
    return [...this.points.values()].flatMap((point) => {
      const count = point.received - (mark.received.get(point.id) ?? 0);
      const errors = point.errorsReceived - (mark.errors.get(point.id) ?? 0);
      if (count <= 0 && errors <= 0) return [];
      const base = {
        id: point.id,
        file: point.file,
        line: point.bound[0]?.source?.line ?? point.bound[0]?.line ?? point.line,
        ...(errors > 0 && { error: point.lastError ?? '', errors }),
      };
      const since = point.hits.filter((hit) => hit.seq > mark.seq && hit.error === undefined);
      const urls = new Set(point.bound.map((bound) => bound.url));
      if (urls.size > 1 && since.length > 0) {
        return [...new Set(since.map((hit) => hit.url))].map((url) => {
          const own = since.filter((hit) => hit.url === url);
          return {
            ...base,
            values: own[0]?.values ?? {},
            hits: own.length,
            ...(own[0]?.errors && { failed: own[0].errors }),
            ...(url !== undefined && { url }),
          };
        });
      }
      const failed = since[0]?.errors;
      return [{ ...base, values: since[0]?.values ?? {}, hits: count, ...(failed && { failed }) }];
    });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.working.then(work);
    this.working = result.catch(() => undefined);
    return result;
  }

  private find(id: string): Logpoint {
    const point = this.points.get(id);
    if (point) return point;
    throw commandError(
      logpointNotFoundError(id, [...this.points.keys()]),
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  private byBreakpoint(breakpointId: string): Logpoint | undefined {
    return [...this.points.values()].find((point) => point.breakpointIds.includes(breakpointId));
  }

  private addBound(
    point: Logpoint,
    location: Protocol.Debugger.Location,
    breakpointId: string
  ): void {
    const url = this.scripts.get(location.scriptId)?.url ?? '';
    const source = point.sources.get(breakpointId);
    const bound = {
      url,
      line: location.lineNumber + 1,
      column: (location.columnNumber ?? 0) + 1,
      ...(source && { source }),
    };
    const known = point.bound.some(
      (other) => other.url === url && other.line === bound.line && other.column === bound.column
    );
    if (!known) point.bound.push(bound);
  }

  private pageCleared(cdp: CDPConnection): void {
    this.scripts.clear();
    this.maps.clear();
    this.points.forEach((point) => (point.bound = []));
    if (this.points.size === 0) return;
    void sendTyped(cdp, 'Debugger.setSkipAllPauses', { skip: true }).catch((error: unknown) =>
      log.debug(`Pauses not skipped: ${getErrorMessage(error)}`)
    );
  }

  private receive(payload: string): void {
    const parsed = this.parseHit(payload);
    const point = parsed && this.points.get(parsed.id);
    if (!parsed || !point) return;
    const failed = Object.entries(parsed.failures).map(
      ([index, message]) =>
        [point.expressions[Number(index)] ?? index, withTdzHint(message)] as const
    );
    const errors = parsed.error === undefined ? failed.length : 1;
    if (errors > 0) {
      point.errorsReceived += errors;
      point.lastError = parsed.error ?? failed[failed.length - 1]?.[1] ?? '';
    }
    const navigationId = this.navigationId();
    if (parsed.error === undefined) point.received++;
    this.seq++;
    if (point.loadId !== navigationId) {
      point.loadId = navigationId;
      point.storedInLoad = 0;
    }
    if (point.storedInLoad >= MAX_STORED_HITS) return;
    point.storedInLoad++;
    const values = Object.fromEntries(
      point.expressions
        .map((expression, index) => [expression, parsed.values[index], index] as const)
        .filter(([, , index]) => !(String(index) in parsed.failures))
        .map(([expression, value]) => [expression, value])
    );
    point.hits.push({
      id: point.id,
      ts: Date.now(),
      values,
      navigationId,
      seq: this.seq,
      ...(parsed.url !== undefined && { url: parsed.url }),
      ...(failed.length > 0 && { errors: Object.fromEntries(failed) }),
      ...(parsed.error !== undefined && { error: withTdzHint(parsed.error) }),
    });
    if (point.hits.length > MAX_RETAINED_HITS) point.hits.shift();
  }

  private parseHit(payload: string): ParsedHit | undefined {
    try {
      const { i, v, s, e, x } = JSON.parse(payload) as {
        i?: unknown;
        v?: unknown;
        s?: unknown;
        e?: unknown;
        x?: unknown;
      };
      if (typeof i !== 'string') return undefined;
      if (typeof e === 'string') return { id: i, values: [], failures: {}, error: e };
      if (!Array.isArray(v)) return undefined;
      const url = typeof s === 'string' ? scriptOfFrame(s) : undefined;
      const failures = typeof x === 'object' && x !== null ? (x as Record<string, string>) : {};
      return { id: i, values: v as LogpointValue[], failures, ...(url !== undefined && { url }) };
    } catch (error) {
      log.debug(`Hit not parsed: ${getErrorMessage(error)}`);
    }
    return undefined;
  }

  private async readCounters(cdp: CDPConnection): Promise<PageCounters> {
    if (this.points.size === 0) return {};
    try {
      const response = await sendTyped(cdp, 'Runtime.evaluate', {
        expression: readLogpointCountersExpression(),
        returnByValue: true,
      });
      const text: unknown = response.result.value;
      return typeof text === 'string' ? (JSON.parse(text) as PageCounters) : {};
    } catch (error) {
      log.debug(`Counters not read: ${getErrorMessage(error)}`);
      return {};
    }
  }

  private async addNow(cdp: CDPConnection, params: DebugLogCommand): Promise<DebugLogData> {
    const { file, line, column } = params;
    if (this.points.size >= MAX_LOGPOINTS) {
      throw commandError(tooManyLogpointsError(), EXIT_CODES.INVALID_ARGUMENTS);
    }
    const duplicate = [...this.points.values()].find(
      (point) => point.file === file && point.line === line && point.column === column
    );
    if (duplicate) {
      throw commandError(
        duplicateLogpointError(duplicate.id, logpointPlace(file, line, column)),
        EXIT_CODES.RESOURCE_ALREADY_EXISTS
      );
    }
    await this.checkSyntax(cdp, [...params.expressions, ...(params.guard ? [params.guard] : [])]);
    try {
      await this.turnOn(cdp);
      return await this.bind(cdp, params);
    } catch (error) {
      if (this.points.size === 0) await this.turnOff(cdp);
      throw error;
    }
  }

  private async bind(cdp: CDPConnection, params: DebugLogCommand): Promise<DebugLogData> {
    const { file, line, column } = params;
    const matcher = new RegExp(scriptUrlPattern(file));
    const matching = [...this.scripts.values()].filter((script) => matcher.test(script.url));
    if (matching.length > 0 && line > Math.max(...matching.map(lastLine))) {
      throw this.noCode(file, line, matching);
    }
    const id = `lp${this.nextId}`;
    const max = params.max ?? DEFAULT_MAX_HITS;
    const spec = {
      id,
      file,
      line,
      column,
      expressions: params.expressions,
      guard: params.guard,
      max,
    };
    const resolution =
      matching.length === 0
        ? await this.maps.resolve([...this.scripts.values()], file, line, column)
        : undefined;
    if (resolution?.places.length === 0 && resolution.noCode !== undefined) {
      throw commandError(logpointNoMappedCodeError(file, line), EXIT_CODES.RESOURCE_NOT_FOUND);
    }
    await this.checkCondition(cdp, spec);
    const set = await this.setBreakpoint(cdp, spec);
    if (matching.length > 0 && set.locations.length === 0) {
      await sendTyped(cdp, 'Debugger.removeBreakpoint', { breakpointId: set.breakpointId }).catch(
        (error: unknown) => log.debug(`Not removed: ${getErrorMessage(error)}`)
      );
      throw this.noCode(file, line, matching);
    }
    const point: Logpoint = {
      ...spec,
      breakpointIds: [set.breakpointId],
      sources: new Map(),
      mappedScripts: new Set(),
      bound: [],
      hits: [],
      received: 0,
      errorsReceived: 0,
      loadId: this.navigationId(),
      storedInLoad: 0,
    };
    set.locations.forEach((location) => this.addBound(point, location, set.breakpointId));
    this.nextId++;
    this.points.set(id, point);
    if (resolution) await this.bindPlaces(cdp, point, resolution.places);
    return {
      id,
      requested: { file, line, ...(column !== undefined && { column }) },
      bound: point.bound,
      state: point.bound.length > 0 ? 'bound' : 'pending',
      ...(point.bound.length === 0 &&
        matching.length === 0 && {
          warning: this.pendingWarning(file, resolution?.failures ?? []),
        }),
    };
  }

  /**
   * Set a breakpoint at each generated position a source map gave.
   *
   * @param cdp - Page connection
   * @param point - The logpoint (its original file and line)
   * @param places - Positions in generated scripts
   */
  private async bindPlaces(
    cdp: CDPConnection,
    point: Logpoint,
    places: MappedPlace[]
  ): Promise<void> {
    for (const place of places) {
      const set = await sendTyped(cdp, 'Debugger.setBreakpointByUrl', {
        url: place.scriptUrl,
        lineNumber: place.line - 1,
        columnNumber: place.column - 1,
        condition: buildLogpointCondition(point),
      });
      point.breakpointIds.push(set.breakpointId);
      point.sources.set(set.breakpointId, { file: displayUrl(place.source), line: point.line });
      set.locations.forEach((location) => this.addBound(point, location, set.breakpointId));
    }
  }

  /**
   * A script with a source map was parsed: logpoints whose file no script
   * URL matches are set from its map when it names the file (lazily loaded
   * chunks).
   *
   * @param cdp - Page connection
   * @param script - The script
   */
  private mapLoadedScript(cdp: CDPConnection, script: Script): void {
    const { url, sourceMapURL } = script;
    if (sourceMapURL === undefined) return;
    const key = `${url}\n${sourceMapURL}`;
    const waiting = [...this.points.values()].filter(
      (point) => !point.mappedScripts.has(key) && !this.hasScriptNamed(point.file)
    );
    if (waiting.length === 0) return;
    void (async () => {
      const found = await Promise.all(
        waiting.map(async (point) => ({
          point,
          ...(await this.maps.resolveScript(
            { url, sourceMapURL },
            point.file,
            point.line,
            point.column
          )),
        }))
      );
      await this.serialized(async () => {
        for (const { point, places } of found) {
          if (places.length === 0 || this.points.get(point.id) !== point) continue;
          if (point.mappedScripts.has(key)) continue;
          point.mappedScripts.add(key);
          await this.bindPlaces(cdp, point, places);
        }
      });
    })().catch((error: unknown) =>
      log.debug(`Not set from a source map: ${getErrorMessage(error)}`)
    );
  }

  private hasScriptNamed(file: string): boolean {
    const matcher = new RegExp(scriptUrlPattern(file));
    return [...this.scripts.values()].some((script) => matcher.test(script.url));
  }

  private pendingWarning(file: string, failures: string[]): string {
    return failures.length > 0
      ? logpointSourceMapWarning(file, failures)
      : this.notLoadedWarning(file);
  }

  private async checkCondition(cdp: CDPConnection, spec: LogpointSpec): Promise<void> {
    const compiled = await sendTyped(cdp, 'Runtime.compileScript', {
      expression: buildLogpointCondition(spec),
      sourceURL: '',
      persistScript: false,
    });
    if (compiled.exceptionDetails) {
      throw commandError(
        logpointSyntaxError(
          [...spec.expressions, ...(spec.guard ? [spec.guard] : [])].join(', '),
          compileMessage(compiled.exceptionDetails)
        ),
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
  }

  private noCode(file: string, line: number, matching: Script[]): CommandError {
    const last = Math.max(...matching.map(lastLine));
    return commandError(logpointNoCodeError(file, line, last), EXIT_CODES.RESOURCE_NOT_FOUND);
  }

  private notLoadedWarning(file: string): string {
    const names = [...this.scripts.values()].map((script) => script.url.split(/[?#]/)[0] ?? '');
    const basenames = [...new Set(names.map((name) => name.split('/').pop() ?? name))];
    const typed = file.split('/').pop() ?? file;
    return logpointFileNotLoadedWarning(file, findSimilar(typed, basenames), this.scripts.size);
  }

  private setBreakpoint(
    cdp: CDPConnection,
    spec: LogpointSpec
  ): Promise<Protocol.Debugger.SetBreakpointByUrlResponse> {
    return sendTyped(cdp, 'Debugger.setBreakpointByUrl', {
      lineNumber: spec.line - 1,
      urlRegex: scriptUrlPattern(spec.file),
      condition: buildLogpointCondition(spec),
      ...(spec.column !== undefined && { columnNumber: spec.column - 1 }),
    });
  }

  private async checkSyntax(cdp: CDPConnection, texts: string[]): Promise<void> {
    const compile = (expression: string): Promise<Protocol.Runtime.CompileScriptResponse> =>
      sendTyped(cdp, 'Runtime.compileScript', { expression, sourceURL: '', persistScript: false });
    const compiled = await Promise.all(
      texts.map(async (text) => {
        const forms = await Promise.all([compile(`(\n${text}\n)`), compile(`[\n${text}\n]`)]);
        return forms.find((form) => form.exceptionDetails) ?? forms[0];
      })
    );
    const index = compiled.findIndex((result) => result?.exceptionDetails);
    const details = compiled[index]?.exceptionDetails;
    if (details) {
      throw commandError(
        logpointSyntaxError(texts[index] ?? '', compileMessage(details)),
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
  }

  private async turnOn(cdp: CDPConnection): Promise<void> {
    if (this.enabled) return;
    await sendTyped(cdp, 'Debugger.enable');
    this.enabled = true;
    await Promise.all([
      sendTyped(cdp, 'Debugger.setSkipAllPauses', { skip: true }),
      sendTyped(cdp, 'Runtime.addBinding', { name: LOGPOINT_BINDING }),
    ]);
  }

  private async turnOff(cdp: CDPConnection): Promise<void> {
    if (!this.enabled) return;
    this.enabled = false;
    this.scripts.clear();
    await this.release(cdp);
  }

  private async release(cdp: CDPConnection): Promise<void> {
    for (const [method, params] of [
      ['Runtime.removeBinding', { name: LOGPOINT_BINDING }],
      ['Debugger.setSkipAllPauses', { skip: false }],
      ['Debugger.disable', undefined],
    ] as const) {
      await cdp
        .send(method, params)
        .catch((error: unknown) => log.debug(`${method} failed: ${getErrorMessage(error)}`));
    }
  }

  private async rebind(cdp: CDPConnection): Promise<void> {
    try {
      this.enabled = false;
      for (const point of this.points.values()) {
        point.bound = [];
        point.breakpointIds = [];
        point.sources.clear();
        point.mappedScripts.clear();
      }
      await this.turnOn(cdp);
      for (const point of this.points.values()) {
        const set = await this.setBreakpoint(cdp, point);
        point.breakpointIds = [set.breakpointId];
        set.locations.forEach((location) => this.addBound(point, location, set.breakpointId));
      }
    } catch (error) {
      log.debug(`Logpoints not set on the new tab: ${getErrorMessage(error)}`);
    }
  }
}
