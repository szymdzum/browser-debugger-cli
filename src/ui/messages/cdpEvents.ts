/**
 * Messages of CDP event collection: `bdg cdp <Method> --collect`, `--listen`,
 * `--events`, `--unlisten`, and the Fetch interception notes.
 */

import type { ErrorWithSuggestion } from '@/errors/messages.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/** `bdg cdp --help` section on events */
export const CDP_EVENTS_HELP = [
  'Events (IPC is request/response, so the daemon buffers them):',
  '  bdg cdp <Method> --collect <Event>[,...] [--until <Event>] [--timeout <s>] [--out <file>]',
  '      subscribe, call, collect until --until arrives or --timeout (default 10 s, max 120;',
  '      complete: false when --until did not come); --out writes NDJSON, else output is',
  '      kept to about 20000 characters',
  '  bdg cdp [<Method>] --listen <Event>[,...]   buffer events between commands (1000 events,',
  '      10 MB; oldest dropped and counted); with a method, listen before calling it',
  '  bdg cdp --events [<Event>[,...]] [--wait <s>] [--clear] [--out <file>]   read and remove them',
  '  bdg cdp --unlisten                          stop and discard the buffer',
  '  Only events of the session page are kept (not of attached iframe/worker sessions).',
  '  Trace: bdg cdp Tracing.start, act, then bdg cdp Tracing.end --collect Tracing.dataCollected \\',
  '      --until Tracing.tracingComplete --out trace.ndjson',
].join('\n');

/** How to collect a trace with `Tracing.end` */
export const TRACING_COLLECT_COMMAND =
  'bdg cdp Tracing.end --collect Tracing.dataCollected --until Tracing.tracingComplete --out trace.ndjson';

/** How to collect a heap snapshot */
export const HEAP_SNAPSHOT_COLLECT_COMMAND =
  'bdg cdp HeapProfiler.takeHeapSnapshot --collect HeapProfiler.addHeapSnapshotChunk --timeout 1 --out heap.ndjson';

/** Note on Fetch.enable: what pauses, and how to read and release it */
export const FETCH_ENABLE_NOTE =
  'Requests matching the patterns (all requests without patterns) now pause until continued. ' +
  'Listen before they start: bdg cdp Fetch.enable --params ... --listen Fetch.requestPaused, ' +
  'then read requestId with bdg cdp --events Fetch.requestPaused --wait 5 and answer each with ' +
  'Fetch.continueRequest, Fetch.fulfillRequest or Fetch.failRequest. bdg cdp Fetch.disable releases them all.';

/**
 * Cause named when a command times out while Fetch interception is on.
 *
 * @returns Message part and suggestion
 */
export function fetchInterceptionTimeoutCause(): ErrorWithSuggestion {
  return {
    message:
      'Fetch interception may be enabled (bdg cdp Fetch.enable ran without Fetch.disable since): requests matching its patterns stay paused until continued, which can stall loads and actions',
    suggestion: [
      `Release them: ${sessionCommand('bdg cdp Fetch.disable')}`,
      `Or answer each: ${sessionCommand('bdg cdp --events Fetch.requestPaused')} (after --listen Fetch.requestPaused), then Fetch.continueRequest / Fetch.fulfillRequest with its requestId`,
    ].join('\n'),
  };
}

/**
 * An event name bdg can't tell from a typo of a bundled event or domain.
 *
 * @param input - Name as typed
 * @param suggestions - Close bundled events
 * @param domainEvents - Every event of the domain, when the domain is known
 * @returns Message and suggestion
 */
export function cdpEventTypoError(
  input: string,
  suggestions: string[],
  domainEvents: string[]
): ErrorWithSuggestion {
  const lines = [
    ...(suggestions.length > 0 ? ['Did you mean:', ...suggestions.map((s) => `  - ${s}`)] : []),
    ...(domainEvents.length > 0 ? [`Events of the domain: ${domainEvents.join(', ')}`] : []),
    'Events of a domain: bdg cdp <Domain> --describe (or --search <keyword>)',
  ];
  return { message: `Unknown CDP event '${input}'`, suggestion: lines.join('\n') };
}

/**
 * A method given where an event is expected.
 *
 * @param method - The method
 * @param domainEvents - Events of its domain
 * @returns Message and suggestion
 */
export function cdpMethodNotEventError(
  method: string,
  domainEvents: string[]
): ErrorWithSuggestion {
  return {
    message: `${method} is a method, not an event`,
    suggestion:
      domainEvents.length > 0
        ? `Events of the domain: ${domainEvents.join(', ')}`
        : `${method.split('.')[0]} has no events; call the method with: bdg cdp ${method}`,
  };
}

/**
 * A name that is not `Domain.event`.
 *
 * @param input - Name as typed
 * @returns Message and suggestion
 */
export function cdpEventMalformedError(input: string): ErrorWithSuggestion {
  return {
    message: `'${input}' is not a CDP event name (Domain.event, e.g. Fetch.requestPaused)`,
    suggestion: 'Events of a domain: bdg cdp <Domain> --describe',
  };
}

/**
 * Warning for an event the bundled protocol lacks.
 *
 * @param event - Event name
 * @param protocolVersion - Bundled devtools-protocol version
 * @returns Warning text
 */
export function cdpUnlistedEventWarning(event: string, protocolVersion: string): string {
  return `${event} is not an event in the bundled protocol (devtools-protocol ${protocolVersion}); listening for it as typed`;
}

/**
 * `--events` or `--unlisten` without a `--listen` first.
 *
 * @returns Message and suggestion
 */
export function cdpNotListeningError(): ErrorWithSuggestion {
  return {
    message: 'No CDP events are being listened to',
    suggestion: `Start with: ${sessionCommand('bdg cdp --listen <Event>[,<Event>]')} (e.g. Fetch.requestPaused)`,
  };
}

/**
 * Flags that only work in another mode (`--until` without a method, ...).
 *
 * @param flags - The flags given
 * @param needs - What they need, e.g. "a method and --collect or --until"
 * @param example - Example command
 * @returns Message and suggestion
 */
export function cdpEventFlagsError(
  flags: string[],
  needs: string,
  example: string
): ErrorWithSuggestion {
  return {
    message: `${flags.join(', ')} ${flags.length === 1 ? 'needs' : 'need'} ${needs}`,
    suggestion: `Example: ${example}`,
  };
}

/**
 * Flags that cannot be combined.
 *
 * @param flags - The flags
 * @param reason - Why
 * @returns Message and suggestion
 */
export function cdpEventFlagsConflictError(flags: string[], reason: string): ErrorWithSuggestion {
  return {
    message: `${flags.join(' and ')} cannot be combined`,
    suggestion: reason,
  };
}

/**
 * A seconds value out of range.
 *
 * @param flag - Flag
 * @param value - Value as typed
 * @param max - Largest value
 * @returns Message and suggestion
 */
export function cdpSecondsRangeError(
  flag: string,
  value: string,
  max: number
): ErrorWithSuggestion {
  return {
    message: `${flag} must be a number of seconds from 0 to ${max} (got '${value}')`,
    suggestion: `Example: ${flag} 10`,
  };
}

/**
 * Hint for a collection whose `--until` event did not arrive.
 *
 * @param until - Event waited for
 * @param timeoutS - Timeout in seconds
 * @returns Hint text
 */
export function collectIncompleteHint(until: string, timeoutS: number): string {
  return `${until} did not arrive within ${timeoutS}s: the events are partial (complete: false). Raise --timeout (max 120) or check that the method starts what sends it`;
}

/**
 * Hint for events a collection dropped because its file fell behind.
 *
 * @param dropped - Events dropped
 * @returns Hint text
 */
export function collectDroppedHint(dropped: number): string {
  return `${dropped} ${dropped === 1 ? 'event was' : 'events were'} dropped: the disk fell over 64 MB behind (complete: false). Write to a faster disk, or collect fewer events`;
}

/**
 * Hint for events left out of an answer by the output budget.
 *
 * @param omitted - Events left out
 * @param buffered - Whether they stay in the `--listen` buffer
 * @returns Hint text
 */
export function eventsOmittedHint(omitted: number, buffered: boolean): string {
  const plural = omitted === 1 ? 'event' : 'events';
  return buffered
    ? `${omitted} more ${plural} still buffered (output kept to about 20000 characters): run bdg cdp --events again, or write them all with --out <file>`
    : `${omitted} more ${plural} left out (output kept to about 20000 characters): write them all with --out <file>`;
}

/**
 * Hint for a `--wait` that ran out without an event.
 *
 * @param waitS - Seconds waited
 * @param events - Events waited for (all listened events when empty)
 * @returns Hint text
 */
export function eventsWaitedOutHint(waitS: number, events: string[]): string {
  const what = events.length > 0 ? events.join(', ') : 'listened';
  return `No ${what} event within ${waitS}s`;
}

/**
 * Hint after `--listen`.
 *
 * @returns Hint text
 */
export function listeningHint(): string {
  return `Read them with: ${sessionCommand('bdg cdp --events [<Event>] [--wait <s>]')}; stop with: ${sessionCommand('bdg cdp --unlisten')}`;
}
