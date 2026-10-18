/**
 * Protocol-owned DTOs for logpoints: `bdg debug log|list|hits|clear` (#848).
 * Lines and columns are 1-based everywhere in them.
 */

/** Where a logpoint is bound in a loaded script */
export interface LogpointBound {
  /** Script URL */
  url: string;
  line: number;
  column: number;
}

/** `bound` once a loaded script holds the line, `pending` until one does */
export type LogpointState = 'bound' | 'pending';

/** debug_log: set a logpoint */
export interface DebugLogCommand {
  /** File as typed: a path suffix of the script URL, or a full URL */
  file: string;
  line: number;
  column?: number;
  /** Expressions to log, each its own label (none: a hit counter) */
  expressions: string[];
  /** Log only when this expression is truthy */
  guard?: string;
  /** Hits logged per page load (the rest are counted as dropped); default 100 */
  max?: number;
}

/** debug_log: the logpoint set */
export interface DebugLogData {
  id: string;
  requested: { file: string; line: number; column?: number };
  bound: LogpointBound[];
  state: LogpointState;
}

/** debug_list: no parameters */
export type DebugListCommand = Record<string, never>;

/** A logpoint as `debug list` shows it */
export interface ListedLogpoint {
  id: string;
  file: string;
  line: number;
  column?: number;
  expressions: string[];
  guard?: string;
  state: LogpointState;
  bound: LogpointBound[];
  /** Times the line ran on the page now loaded (hits past `max` included) */
  hits: number;
  /** Hits past `max` that were counted, not logged, on the page now loaded */
  dropped: number;
  /** Times an expression threw on the page now loaded */
  errors: number;
  /** The last error's message (with `errors`) */
  lastError?: string;
}

/** debug_list: the session's logpoints, oldest first */
export interface DebugListData {
  logpoints: ListedLogpoint[];
}

/** debug_hits: read the logged values */
export interface DebugHitsCommand {
  /** Only this logpoint's hits */
  id?: string;
  /** Newest n hits (default 20) */
  last?: number;
  /** Hits of every page load (default: the page now loaded) */
  allPages?: boolean;
}

/** A value of a logged expression: JSON, with `{ "$": "<description>" }` for what JSON cannot carry */
export type LogpointValue = unknown;

/** One time a logpoint's line ran */
export interface LogpointHit {
  id: string;
  /** When bdg received it (epoch ms) */
  ts: number;
  /** Value of each expression by label */
  values: Record<string, LogpointValue>;
  /** Page load it belongs to */
  navigationId: number;
}

/** debug_hits: the hits, oldest first */
export interface DebugHitsData {
  hits: LogpointHit[];
  /** Hits that matched but are older than `last` */
  omitted?: number;
}

/** debug_clear: remove one logpoint, or all */
export interface DebugClearCommand {
  id?: string;
}

/** debug_clear: the ids removed */
export interface DebugClearData {
  cleared: string[];
}

/** What a logpoint logged while an action ran, in an action's result */
export interface LogpointActionHit {
  id: string;
  /** File as typed */
  file: string;
  /** Line the logpoint is bound at (the requested one while pending) */
  line: number;
  /** Values of the first hit during the action by label */
  values: Record<string, LogpointValue>;
  /** Hits during the action (also those past the stored ones) */
  hits: number;
}
