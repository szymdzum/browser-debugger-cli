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
  logpointSamePlaceError,
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
import {
  mapKey,
  SourceMapReader,
  type BreakpointTarget,
  type MappedScript,
  type ScriptWithMap,
} from './logpointSourceMaps.js';

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

/** A breakpoint a logpoint holds in Chrome */
interface PointBreakpoint {
  id: string;
  /** The map source it stands for (set from a source map) */
  source?: string;
  /** {@link mapKey} of the script whose map gave it */
  mapKey?: string;
}

/** What binding a logpoint starts from */
interface TargetResolution {
  targets: BreakpointTarget[];
  /** The file's scripts or sources have no code at the line */
  noCode: boolean;
  /** Last line of the scripts the file names, when a script URL does */
  lastLine?: number;
  /** Source maps that could not be used */
  failures: string[];
}

/** A logpoint in the registry */
interface Logpoint extends LogpointSpec {
  /** Matches the script URLs and map sources the file as typed names */
  matcher: RegExp;
  breakpoints: PointBreakpoint[];
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
        if (event.sourceMapURL)
          this.mapLoadedScript(cdp, { url: event.url, sourceMapURL: event.sourceMapURL });
      }),
      cdp.on('Debugger.globalObjectCleared', () => this.pageCleared(cdp)),
      cdp.on<Protocol.Debugger.BreakpointResolvedEvent>('Debugger.breakpointResolved', (event) => {
        const point = this.byBreakpoint(event.breakpointId);
        const breakpoint = point?.breakpoints.find((own) => own.id === event.breakpointId);
        if (point && breakpoint) this.addBound(point, event.location, breakpoint);
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
        await this.removeBreakpoints(
          cdp,
          point.breakpoints.map((breakpoint) => breakpoint.id)
        );
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
    return [...this.points.values()].find((point) =>
      point.breakpoints.some((breakpoint) => breakpoint.id === breakpointId)
    );
  }

  private addBound(
    point: Logpoint,
    location: Protocol.Debugger.Location,
    breakpoint: PointBreakpoint
  ): void {
    const url = this.scripts.get(location.scriptId)?.url ?? '';
    const source = breakpoint.source && { file: breakpoint.source, line: point.line };
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
      (point) => point.file === file && point.line === line && (point.column ?? 1) === (column ?? 1)
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
    const id = `lp${this.nextId}`;
    const spec = {
      id,
      file,
      line,
      column,
      expressions: params.expressions,
      guard: params.guard,
      max: params.max ?? DEFAULT_MAX_HITS,
    };
    await this.checkCondition(cdp, spec);
    const matcher = new RegExp(scriptUrlPattern(file));
    const resolution = await this.resolveTargets(spec, matcher);
    if (resolution.noCode) throw this.noCodeError(file, line, resolution.lastLine);
    const point: Logpoint = {
      ...spec,
      matcher,
      breakpoints: [],
      bound: [],
      hits: [],
      received: 0,
      errorsReceived: 0,
      loadId: this.navigationId(),
      storedInLoad: 0,
    };
    await this.applyTargets(cdp, point, resolution.targets);
    if (resolution.lastLine !== undefined && point.bound.length === 0) {
      await this.removeBreakpoints(
        cdp,
        point.breakpoints.map((breakpoint) => breakpoint.id)
      );
      throw this.noCodeError(file, line, resolution.lastLine);
    }
    this.nextId++;
    this.points.set(id, point);
    return {
      id,
      requested: { file, line, ...(column !== undefined && { column }) },
      bound: point.bound,
      state: point.bound.length > 0 ? 'bound' : 'pending',
      ...(point.bound.length === 0 &&
        resolution.lastLine === undefined && {
          warning: this.pendingWarning(file, resolution.failures),
        }),
    };
  }

  /**
   * Where a new logpoint's breakpoints go: the file as typed (Chrome matches
   * scripts by URL, also ones loaded later) and, when no loaded script URL
   * ends with it, the generated places of the source maps that name it.
   */
  private async resolveTargets(spec: LogpointSpec, matcher: RegExp): Promise<TargetResolution> {
    const scripts = [...this.scripts.values()];
    const matching = scripts.filter((script) => matcher.test(script.url));
    const byUrl = this.urlTarget(spec);
    if (matching.length > 0) {
      const last = Math.max(...matching.map(lastLine));
      const noCode = spec.line > last;
      return { targets: noCode ? [] : [byUrl], noCode, lastLine: last, failures: [] };
    }
    const mapped = await this.maps.resolve(scripts, matcher, spec.line, spec.column);
    return {
      targets: [byUrl, ...mapped.targets],
      noCode: mapped.targets.length === 0 && mapped.noCode,
      failures: mapped.failures,
    };
  }

  private urlTarget(spec: LogpointSpec): BreakpointTarget {
    return {
      urlRegex: scriptUrlPattern(spec.file),
      line: spec.line,
      ...(spec.column !== undefined && { column: spec.column }),
    };
  }

  /**
   * Set the breakpoints for targets; all or none: when Chrome refuses one,
   * those set by this call are removed again.
   *
   * @param cdp - Page connection
   * @param point - The logpoint
   * @param targets - Places to set
   * @throws CommandError (84) when another breakpoint sits at one of the places
   */
  private async applyTargets(
    cdp: CDPConnection,
    point: Logpoint,
    targets: BreakpointTarget[]
  ): Promise<void> {
    const condition = buildLogpointCondition(point);
    const settled = await Promise.allSettled(
      targets.map((target) =>
        sendTyped(cdp, 'Debugger.setBreakpointByUrl', {
          ...(target.url !== undefined ? { url: target.url } : { urlRegex: target.urlRegex ?? '' }),
          lineNumber: target.line - 1,
          ...(target.column !== undefined && { columnNumber: target.column - 1 }),
          condition,
        })
      )
    );
    const set = settled.flatMap((result, index) => {
      const target = targets[index];
      return result.status === 'fulfilled' && target ? [{ target, response: result.value }] : [];
    });
    const refused = settled.find((result) => result.status === 'rejected');
    if (refused?.status === 'rejected') {
      await this.removeBreakpoints(
        cdp,
        set.map(({ response }) => response.breakpointId)
      );
      throw this.setFailure(refused.reason, point);
    }
    for (const { target, response } of set) {
      const breakpoint: PointBreakpoint = {
        id: response.breakpointId,
        ...(target.source !== undefined && { source: target.source }),
        ...(target.mapKey !== undefined && { mapKey: target.mapKey }),
      };
      point.breakpoints.push(breakpoint);
      response.locations.forEach((location) => this.addBound(point, location, breakpoint));
    }
  }

  private setFailure(reason: unknown, point: Logpoint): unknown {
    if (!/already exists/i.test(getErrorMessage(reason))) return reason;
    return commandError(
      logpointSamePlaceError(logpointPlace(point.file, point.line, point.column)),
      EXIT_CODES.RESOURCE_ALREADY_EXISTS
    );
  }

  private async removeBreakpoints(cdp: CDPConnection, ids: string[]): Promise<void> {
    await Promise.all(
      ids.map((breakpointId) =>
        sendTyped(cdp, 'Debugger.removeBreakpoint', { breakpointId }).catch((error: unknown) =>
          log.debug(`Not removed: ${getErrorMessage(error)}`)
        )
      )
    );
  }

  /**
   * A script with a source map was parsed (a lazily loaded chunk, or one
   * replayed when the session moves to a tab): logpoints no script URL
   * matches are set from its map when it names the file.
   */
  private mapLoadedScript(cdp: CDPConnection, script: ScriptWithMap): void {
    if (this.points.size === 0) return;
    const key = mapKey(script);
    void this.maps
      .index(script)
      .then((index) =>
        this.serialized(async () => {
          for (const point of this.points.values()) {
            if (point.breakpoints.some((breakpoint) => breakpoint.mapKey === key)) continue;
            if (this.hasScriptMatching(point.matcher)) continue;
            const { targets } = this.maps.targetsIn(
              index,
              script,
              point.matcher,
              point.line,
              point.column
            );
            if (targets.length === 0) continue;
            await this.applyTargets(cdp, point, targets).catch((error: unknown) =>
              log.debug(`Not set from a source map: ${getErrorMessage(error)}`)
            );
          }
        })
      )
      .catch((error: unknown) => log.debug(`Source map not used: ${getErrorMessage(error)}`));
  }

  private hasScriptMatching(matcher: RegExp): boolean {
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

  private noCodeError(file: string, line: number, lastLineOfScripts?: number): CommandError {
    return lastLineOfScripts === undefined
      ? commandError(logpointNoMappedCodeError(file, line), EXIT_CODES.RESOURCE_NOT_FOUND)
      : commandError(
          logpointNoCodeError(file, line, lastLineOfScripts),
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
  }

  private notLoadedWarning(file: string): string {
    const names = [...this.scripts.values()].map((script) => script.url.split(/[?#]/)[0] ?? '');
    const basenames = [...new Set(names.map((name) => name.split('/').pop() ?? name))];
    const typed = file.split('/').pop() ?? file;
    return logpointFileNotLoadedWarning(file, findSimilar(typed, basenames), this.scripts.size);
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
        point.breakpoints = [];
      }
      await this.turnOn(cdp);
      for (const point of this.points.values()) {
        await this.applyTargets(cdp, point, [this.urlTarget(point)]);
      }
    } catch (error) {
      log.debug(`Logpoints not set on the new tab: ${getErrorMessage(error)}`);
    }
  }
}
