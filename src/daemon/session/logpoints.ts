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
  logpointFileNotLoadedError,
  logpointNoCodeError,
  logpointNotFoundError,
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
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { logpointPlace, scriptUrlPattern } from '@/utils/logpointLocation.js';
import { findSimilar } from '@/utils/suggestions.js';

import {
  buildLogpointCondition,
  LOGPOINT_BINDING,
  readLogpointCountersExpression,
} from './logpointCondition.js';

const log = createLogger('session');

/** Hits stored per logpoint per page load */
const MAX_STORED_HITS = 100;

/** Hits logged per page load by default (the rest are counted as dropped) */
const DEFAULT_MAX_HITS = 100;

/** Hits kept per logpoint over all page loads (the oldest go first) */
const MAX_RETAINED_HITS = 1000;

/** Hits `debug hits` shows by default */
const DEFAULT_SHOWN_HITS = 20;

/** A script Chrome parsed */
interface Script {
  url: string;
  endLine: number;
  endColumn: number;
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
  breakpointId: string;
  bound: LogpointBound[];
  /** Stored hits, oldest first */
  hits: StoredHit[];
  /** Hits received, stored or not */
  received: number;
  /** The page load `storedInLoad` counts */
  loadId: number;
  storedInLoad: number;
}

/** A point in the arrival of hits, to tell which came later (see {@link Logpoints.hitsSince}) */
export interface HitMark {
  seq: number;
  received: ReadonlyMap<string, number>;
}

/** What the page tells about the session's pages when a logpoint is set */
export interface PageLoad {
  /** The document has not finished loading */
  loading: boolean;
  /** URLs of the requests still running */
  pendingUrls: string[];
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
    const stops = [
      cdp.on<Protocol.Debugger.ScriptParsedEvent>('Debugger.scriptParsed', (event) => {
        if (event.url) {
          this.scripts.set(event.scriptId, {
            url: event.url,
            endLine: event.endLine,
            endColumn: event.endColumn,
          });
        }
      }),
      cdp.on('Debugger.globalObjectCleared', () => this.pageCleared(cdp)),
      cdp.on<Protocol.Debugger.BreakpointResolvedEvent>('Debugger.breakpointResolved', (event) => {
        const point = this.byBreakpoint(event.breakpointId);
        if (point) this.addBound(point, event.location);
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
    if (this.enabled) void this.rebind(cdp);
    return () => stops.forEach((stop) => stop());
  }

  /**
   * Set a logpoint.
   *
   * @param cdp - Page connection
   * @param params - Where, what to log, guard and limit
   * @param page - Whether the page is still loading scripts
   * @returns The logpoint, bound or pending
   * @throws CommandError (81 invalid expression or too many, 83 no such script or line, 84 duplicate)
   */
  add(cdp: CDPConnection, params: DebugLogCommand, page: PageLoad): Promise<DebugLogData> {
    return this.serialized(() => this.addNow(cdp, params, page));
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
          ...(counted?.last && { lastError: counted.last }),
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
        await sendTyped(cdp, 'Debugger.removeBreakpoint', {
          breakpointId: point.breakpointId,
        }).catch((error: unknown) => log.debug(`Not removed: ${getErrorMessage(error)}`));
      }
      if (this.points.size === 0) await this.turnOff(cdp);
      return { cleared: removed.map((point) => point.id) };
    });
  }

  /**
   * Forget every logpoint with the session (the connection is going away).
   */
  dispose(): void {
    this.points.clear();
    this.scripts.clear();
    this.enabled = false;
  }

  /**
   * A mark for {@link hitsSince}: taken as an action starts.
   *
   * @returns Mark
   */
  hitMark(): HitMark {
    if (this.points.size === 0) return { seq: this.seq, received: new Map() };
    return {
      seq: this.seq,
      received: new Map([...this.points.values()].map((point) => [point.id, point.received])),
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
      if (count <= 0) return [];
      const first = point.hits.find((hit) => hit.seq > mark.seq);
      return [
        {
          id: point.id,
          file: point.file,
          line: point.bound[0]?.line ?? point.line,
          values: first?.values ?? {},
          hits: count,
        },
      ];
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
    return [...this.points.values()].find((point) => point.breakpointId === breakpointId);
  }

  private addBound(point: Logpoint, location: Protocol.Debugger.Location): void {
    const url = this.scripts.get(location.scriptId)?.url ?? '';
    const bound = { url, line: location.lineNumber + 1, column: (location.columnNumber ?? 0) + 1 };
    const known = point.bound.some(
      (other) => other.url === url && other.line === bound.line && other.column === bound.column
    );
    if (!known) point.bound.push(bound);
  }

  private pageCleared(cdp: CDPConnection): void {
    this.scripts.clear();
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
    const navigationId = this.navigationId();
    point.received++;
    this.seq++;
    if (point.loadId !== navigationId) {
      point.loadId = navigationId;
      point.storedInLoad = 0;
    }
    if (point.storedInLoad >= MAX_STORED_HITS) return;
    point.storedInLoad++;
    const values = Object.fromEntries(
      point.expressions.map((expression, index) => [expression, parsed.values[index]])
    );
    point.hits.push({ id: point.id, ts: Date.now(), values, navigationId, seq: this.seq });
    if (point.hits.length > MAX_RETAINED_HITS) point.hits.shift();
  }

  private parseHit(payload: string): { id: string; values: LogpointValue[] } | undefined {
    try {
      const { i, v } = JSON.parse(payload) as { i?: unknown; v?: unknown };
      if (typeof i === 'string' && Array.isArray(v)) return { id: i, values: v as LogpointValue[] };
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

  private async addNow(
    cdp: CDPConnection,
    params: DebugLogCommand,
    page: PageLoad
  ): Promise<DebugLogData> {
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
    await this.turnOn(cdp);
    try {
      return await this.bind(cdp, params, page);
    } catch (error) {
      if (this.points.size === 0) await this.turnOff(cdp);
      throw error;
    }
  }

  private async bind(
    cdp: CDPConnection,
    params: DebugLogCommand,
    page: PageLoad
  ): Promise<DebugLogData> {
    const { file, line, column } = params;
    const matcher = new RegExp(scriptUrlPattern(file));
    const matching = [...this.scripts.values()].filter((script) => matcher.test(script.url));
    const loadingIt = page.loading || page.pendingUrls.some((url) => matcher.test(url));
    if (matching.length === 0 && !loadingIt) throw this.notLoaded(file);
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
    const set = await this.setBreakpoint(cdp, spec);
    if (matching.length > 0 && set.locations.length === 0) {
      await sendTyped(cdp, 'Debugger.removeBreakpoint', { breakpointId: set.breakpointId }).catch(
        (error: unknown) => log.debug(`Not removed: ${getErrorMessage(error)}`)
      );
      const last = Math.max(...matching.map(lastLine));
      throw commandError(logpointNoCodeError(file, line, last), EXIT_CODES.RESOURCE_NOT_FOUND);
    }
    const point: Logpoint = {
      ...spec,
      breakpointId: set.breakpointId,
      bound: [],
      hits: [],
      received: 0,
      loadId: this.navigationId(),
      storedInLoad: 0,
    };
    set.locations.forEach((location) => this.addBound(point, location));
    this.nextId++;
    this.points.set(id, point);
    return {
      id,
      requested: { file, line, ...(column !== undefined && { column }) },
      bound: point.bound,
      state: point.bound.length > 0 ? 'bound' : 'pending',
    };
  }

  private notLoaded(file: string): CommandError {
    const names = [...this.scripts.values()].map((script) => script.url.split(/[?#]/)[0] ?? '');
    const basenames = [...new Set(names.map((name) => name.split('/').pop() ?? name))];
    const typed = file.split('/').pop() ?? file;
    return commandError(
      logpointFileNotLoadedError(file, findSimilar(typed, basenames), this.scripts.size),
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
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
    const compiled = await Promise.all(
      texts.map((text) =>
        sendTyped(cdp, 'Runtime.compileScript', {
          expression: `(\n${text}\n)`,
          sourceURL: '',
          persistScript: false,
        })
      )
    );
    const index = compiled.findIndex((result) => result.exceptionDetails);
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
      await this.turnOn(cdp);
      for (const point of this.points.values()) {
        point.bound = [];
        const set = await this.setBreakpoint(cdp, point);
        point.breakpointId = set.breakpointId;
        set.locations.forEach((location) => this.addBound(point, location));
      }
    } catch (error) {
      log.debug(`Logpoints not set on the new tab: ${getErrorMessage(error)}`);
    }
  }
}
