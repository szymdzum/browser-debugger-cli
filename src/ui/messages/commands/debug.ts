/**
 * Messages of logpoints: `bdg debug log|list|hits|clear` (#848).
 */

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type {
  DebugClearData,
  DebugLogData,
  ListedLogpoint,
  LogpointActionHit,
  LogpointHit,
  LogpointValue,
} from '@/ipc/protocol/debugTypes.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { logpointPlace } from '@/utils/logpointLocation.js';

/** Description of the `debug` command group */
export const DEBUG_DESCRIPTION =
  "Log the page's values at a source line without pausing it (logpoints)";

/** Description of `bdg debug log` */
export const DEBUG_LOG_DESCRIPTION =
  "Log expressions at a line of a loaded script each time it runs, without pausing the page; dom click, fill and press-key list what it logged (JSON: 'logpoints', 'moreLogpoints')";

/** Description of `bdg debug list` */
export const DEBUG_LIST_DESCRIPTION = 'List the logpoints with their hit counts and errors';

/** Description of `bdg debug hits` */
export const DEBUG_HITS_DESCRIPTION = 'Show what the logpoints logged (the page now loaded)';

/** Description of `bdg debug clear` */
export const DEBUG_CLEAR_DESCRIPTION = 'Remove a logpoint, or all of them';

/** Example lines under `bdg debug log --help` */
export const DEBUG_LOG_EXAMPLES = `
Examples:
  bdg debug log app.js:5 total discount "cart.items.length"
  bdg dom click "#checkout"        # the action report lists what was logged
  bdg debug log app.js:5           # no expression: a hit counter
  bdg debug log src/cart.ts:5 total # an original file of a bundle with a source map
  bdg debug hits --json            # every logged value, structured
  bdg debug clear

Lines and columns are 1-based. File is the end of a script URL (app.js, dist/app.js) or, when none matches, of a source in a loaded script's source map (src/cart.ts); values are then the generated code's variables.
Expressions run in the page at that line and see its variables; values are those before the line runs.`;

/**
 * A logged value as one short text.
 *
 * @param value - Value as the page serialized it
 * @returns e.g. `25`, `"abc"`, `[1,2]`, `undefined`
 */
export function logpointValueText(value: LogpointValue): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const marker = (value as { $?: unknown }).$;
    if (typeof marker === 'string' && Object.keys(value).length === 1) return marker;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Values by label as `label=value` words.
 *
 * @param values - Values by label
 * @returns e.g. `total=25 discount=0.5`
 */
function valuesText(values: Record<string, LogpointValue>): string {
  return Object.entries(values)
    .map(([label, value]) => `${label}=${shortText(logpointValueText(value))}`)
    .join(' ');
}

/**
 * A printed value, cut at the console's text length (`--json` has it whole).
 *
 * @param text - Value as text
 * @returns The text, or its start and `…`
 */
function shortText(text: string): string {
  return text.length > MAX_CONSOLE_TEXT_LENGTH
    ? `${text.slice(0, MAX_CONSOLE_TEXT_LENGTH)}…`
    : text;
}

/**
 * Result of `bdg debug log`.
 *
 * @param data - The logpoint set
 * @returns One or two lines
 */
export function logpointSetText(data: DebugLogData): string {
  const { id, requested, bound, state } = data;
  if (state === 'pending') {
    return `${id} pending: ${requested.file} is not loaded yet; the logpoint binds when it is`;
  }
  const first = bound[0];
  if (first?.source) {
    const asked = logpointPlace(requested.file, requested.line, requested.column);
    const generated = `${displayUrl(first.url)}:${first.line}:${first.column}`;
    return `${id} bound at ${asked} (generated ${generated}${bound.length > 1 ? `, ${bound.length} places` : ''})`;
  }
  if (first && first.line !== requested.line) {
    return `${id} bound at ${requested.file}:${first.line} (asked ${requested.line})`;
  }
  const asked = logpointPlace(requested.file, requested.line, requested.column);
  return `${id} bound at ${asked}${bound.length > 1 ? ` (${bound.length} scripts)` : ''}`;
}

/**
 * One line of `bdg debug list`.
 *
 * @param logpoint - Listed logpoint
 * @returns e.g. `lp1  app.js:5  bound  total, discount  hits 2`
 */
export function logpointListText(logpoint: ListedLogpoint): string {
  const place = logpointPlace(logpoint.file, logpoint.line, logpoint.column);
  const expressions = logpoint.expressions.length ? logpoint.expressions.join(', ') : '(counter)';
  const dropped = logpoint.dropped ? `, ${logpoint.dropped} dropped` : '';
  const errors = logpoint.errors
    ? `  errors ${logpoint.errors}${logpoint.lastError ? ` (last: ${logpoint.lastError})` : ''}`
    : '';
  return `${logpoint.id}  ${place}  ${logpoint.state}  ${expressions}  hits ${logpoint.hits}${dropped}${errors}`;
}

/** Output of `bdg debug list` without logpoints */
export const NO_LOGPOINTS_TEXT = 'No logpoints. Set one with: bdg debug log <file:line> [expr…]';

/**
 * One hit of `bdg debug hits`.
 *
 * @param hit - Hit
 * @returns e.g. `lp1  14:03:02.123  total=25 discount=0.5`
 */
export function logpointHitText(hit: LogpointHit): string {
  const time = new Date(hit.ts).toISOString().slice(11, 23);
  const parts = [valuesText(hit.values), ...failuresText(hit.errors)].filter(Boolean);
  if (hit.error !== undefined) parts.push(`threw ${hit.error}`);
  return `${hit.id}  ${time}  ${parts.join(' ') || '(hit)'}${hit.url ? `  [${hit.url}]` : ''}`;
}

/** Output of `bdg debug hits` without hits */
export const NO_LOGPOINT_HITS_TEXT = 'No hits yet on this page';

/**
 * Line under `bdg debug hits` when older hits were left out.
 *
 * @param omitted - Hits not shown
 * @returns e.g. `... and 5 older hits (--last to see more)`
 */
export function olderHitsNote(omitted: number): string {
  return `... and ${omitted} older ${omitted === 1 ? 'hit' : 'hits'} (--last to see more)`;
}

/**
 * Result of `bdg debug clear`.
 *
 * @param data - Ids removed
 * @returns e.g. `Cleared lp1, lp2`
 */
export function logpointsClearedText(data: DebugClearData): string {
  return data.cleared.length ? `Cleared ${data.cleared.join(', ')}` : 'No logpoints to clear';
}

/**
 * The action report's line for a logpoint that ran during the action.
 *
 * @param hit - What it logged
 * @returns e.g. `logpoint lp1 app.js:5: total=25 discount=0.5 (2 hits)`, and a
 *   `logpoint lp1 app.js:5 threw ReferenceError: …` line when an expression threw
 */
export function logpointActionText(hit: LogpointActionHit): string {
  const count = hit.hits > 1 ? ` (${hit.hits} hits)` : '';
  const head = `logpoint ${hit.id} ${hit.file}:${hit.line}${hit.url ? ` [${hit.url}]` : ''}`;
  const parts = [valuesText(hit.values), ...failuresText(hit.failed)].filter(Boolean);
  const lines =
    hit.hits > 0 ? [`${head}${parts.length ? `: ${parts.join(' ')}` : ''}${count}`] : [];
  if (hit.error !== undefined && !(hit.hits > 0 && hit.failed)) {
    const repeats = (hit.errors ?? 1) > 1 ? ` (${hit.errors}x)` : '';
    lines.push(`${head} threw ${hit.error}${repeats}`);
  }
  return lines.join('\n');
}

/**
 * Expressions that threw as `label threw message` words.
 *
 * @param errors - Messages by label
 * @returns One text per expression
 */
function failuresText(errors: Record<string, string> | undefined): string[] {
  return Object.entries(errors ?? {}).map(
    ([label, message]) => `${label} threw ${shortText(message)}`
  );
}

/** What to do about a variable declared on the logpoint's own line */
const TDZ_HINT =
  'values are those before the line runs: set the logpoint on the next line to see a variable declared on this one';

/**
 * Chrome's "Cannot access 'x' from debugger" (a `const` or `let` of the
 * logpoint's own line) with the way out.
 *
 * @param message - Error message of an expression
 * @returns The message, with a hint when it is that error
 */
export function withTdzHint(message: string): string {
  return /Cannot access '.*' (from debugger|before initialization)/.test(message)
    ? `${message} (${TDZ_HINT})`
    : message;
}

/**
 * The action report's line for logpoints past the cap.
 *
 * @param more - Logpoints not listed
 * @returns e.g. `+2 more logpoints (bdg debug hits)`
 */
export function moreLogpointsText(more: number): string {
  return `+${more} more ${more === 1 ? 'logpoint' : 'logpoints'} (bdg debug hits)`;
}

/**
 * The `bdg status` row for the session's logpoints.
 *
 * @param count - Logpoints set
 * @returns e.g. `2 (bdg debug list)`
 */
export function logpointsStatusText(count: number): string {
  return `${count} (bdg debug list)`;
}
