/**
 * CDP events in `bdg cdp`: `<Method> --collect/--until/--timeout/--out`
 * collects events while one method runs; `--listen`, `--events` and
 * `--unlisten` keep a bounded buffer of events between commands (e.g.
 * `Fetch.requestPaused`, to answer paused requests).
 */

import * as path from 'path';

import { resolveEventTarget } from '@/cdp/methodTarget.js';
import { findDomain, getBundledProtocolVersion } from '@/cdp/protocol.js';
import type { CommandResult } from '@/commands/shared/CommandRunner.js';
import type { CdpCommandOptions } from '@/commands/shared/optionTypes.js';
import { assertFilePath } from '@/commands/shared/outputFile.js';
import { CommandError } from '@/errors/index.js';
import type { ErrorWithSuggestion } from '@/errors/messages.js';
import { cdpEvents } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { CdpCollectParams, CdpEventsCommand } from '@/ipc/protocol/cdpEventTypes.js';
import type { CdpCollectData, CdpEventsCommandData } from '@/ui/formatters/cdpEvents.js';
import {
  cdpEventFlagsConflictError,
  cdpEventFlagsError,
  cdpEventMalformedError,
  cdpEventTypoError,
  cdpMethodNotEventError,
  cdpSecondsRangeError,
  cdpUnlistedEventWarning,
  collectIncompleteHint,
  eventsOmittedHint,
  eventsWaitedOutHint,
  listeningHint,
} from '@/ui/messages/cdpEvents.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Default `--timeout` of a collection, in seconds */
export const COLLECT_DEFAULT_TIMEOUT_S = 10;

/**
 * Longest `--timeout` and `--wait`, in seconds: a request blocks the CLI
 * (the daemon extends its 30 s command timeout to this plus a margin)
 */
export const EVENT_WAIT_MAX_S = 120;

/** What the event flags ask for */
export type EventCommandPlan =
  | { mode: 'collect'; collect: CdpCollectParams; warning?: string }
  | { mode: 'listen'; events: string[]; warning?: string }
  | { mode: 'events'; request: Extract<CdpEventsCommand, { action: 'read' }>; warning?: string }
  | { mode: 'unlisten' };

/**
 * An invalid-arguments error (exit 81).
 *
 * @param err - Message and suggestion
 * @returns Command error
 */
function invalid(err: ErrorWithSuggestion): CommandError {
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}

/**
 * Event names of a domain, for suggestions.
 *
 * @param name - `Domain.member` as typed
 * @returns Full event names (empty for an unknown domain)
 */
function domainEvents(name: string): string[] {
  const domain = findDomain(name.split('.')[0] ?? '');
  return (domain?.events ?? []).map((event) => `${domain?.domain}.${event.name}`);
}

/**
 * Resolve one event name against the bundled protocol.
 *
 * @param name - Event name as typed
 * @returns Event to listen to, and a warning for one the protocol lacks
 * @throws CommandError (81) for a typo, a method or a malformed name
 */
function resolveEventName(name: string): { event: string; warning?: string } {
  const target = resolveEventTarget(name);
  switch (target.kind) {
    case 'known':
      return { event: target.event };
    case 'unlisted':
      return {
        event: target.event,
        warning: cdpUnlistedEventWarning(target.event, getBundledProtocolVersion()),
      };
    case 'typo':
      throw invalid(cdpEventTypoError(name, target.suggestions.slice(0, 3), domainEvents(name)));
    case 'method':
      throw invalid(cdpMethodNotEventError(target.method, domainEvents(target.method)));
    case 'malformed':
      throw invalid(cdpEventMalformedError(name));
  }
}

/**
 * Parse a comma-separated list of event names.
 *
 * @param list - Names as typed
 * @returns Events (bundled ones with their casing), and warnings for ones the protocol lacks
 * @throws CommandError (81) for typos (with suggestions), methods and malformed names
 */
export function parseEventNames(list: string): { events: string[]; warning?: string } {
  const names = list
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) throw invalid(cdpEventMalformedError(list));
  const resolved = names.map(resolveEventName);
  const warnings = resolved.flatMap((r) => (r.warning ? [r.warning] : []));
  return {
    events: [...new Set(resolved.map((r) => r.event))],
    ...(warnings.length > 0 && { warning: warnings.join('\n') }),
  };
}

/**
 * Parse a number of seconds.
 *
 * @param flag - Flag, for the error
 * @param value - Value as typed
 * @param min - Smallest value allowed (exclusive when `exclusiveMin`)
 * @param exclusiveMin - Whether `min` itself is refused
 * @returns Milliseconds
 * @throws CommandError (81) when not a number in range
 */
function parseSeconds(flag: string, value: string, min: number, exclusiveMin: boolean): number {
  const seconds = Number(value.trim());
  const belowMin = exclusiveMin ? seconds <= min : seconds < min;
  if (value.trim() === '' || !Number.isFinite(seconds) || belowMin || seconds > EVENT_WAIT_MAX_S) {
    throw invalid(cdpSecondsRangeError(flag, value, EVENT_WAIT_MAX_S));
  }
  return Math.round(seconds * 1000);
}

/**
 * Absolute path of an `--out` file.
 *
 * @param out - Path as typed
 * @returns Absolute path
 * @throws CommandError (81) for an empty path or a directory
 */
function outPath(out: string): string {
  assertFilePath(out, '.ndjson');
  return path.resolve(out);
}

/**
 * Fail when flags are given that belong to another mode.
 *
 * @param flags - Flags given, with whether each was set
 * @param needs - What they need
 * @param example - Example command
 * @throws CommandError (81) when any was set
 */
function rejectFlags(flags: Record<string, unknown>, needs: string, example: string): void {
  const given = Object.entries(flags)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([flag]) => flag);
  if (given.length > 0) throw invalid(cdpEventFlagsError(given, needs, example));
}

/**
 * Plan a collection (`<Method> --collect/--until`).
 *
 * @param options - Command options
 * @returns Collection plan
 */
function planCollect(options: CdpCommandOptions): EventCommandPlan {
  const collected = options.collect === undefined ? undefined : parseEventNames(options.collect);
  const until = options.until === undefined ? undefined : resolveEventName(options.until);
  const warning = [collected?.warning, until?.warning].filter(Boolean).join('\n');
  const timeoutMs =
    options.timeout === undefined
      ? COLLECT_DEFAULT_TIMEOUT_S * 1000
      : parseSeconds('--timeout', options.timeout, 0, true);
  return {
    mode: 'collect',
    collect: {
      events: collected?.events ?? [],
      ...(until && { until: until.event }),
      timeoutMs,
      ...(options.out !== undefined && { out: outPath(options.out) }),
    },
    ...(warning && { warning }),
  };
}

/**
 * Plan a read of the buffer (`--events`).
 *
 * @param options - Command options
 * @returns Read plan
 */
function planRead(options: CdpCommandOptions): EventCommandPlan {
  if (options.clear && options.out !== undefined) {
    throw invalid(
      cdpEventFlagsConflictError(
        ['--clear', '--out'],
        '--clear discards the events, --out writes them'
      )
    );
  }
  const filter = typeof options.events === 'string' ? parseEventNames(options.events) : undefined;
  return {
    mode: 'events',
    request: {
      action: 'read',
      ...(filter && { events: filter.events }),
      ...(options.wait !== undefined && { waitMs: parseSeconds('--wait', options.wait, 0, false) }),
      ...(options.clear && { clear: true }),
      ...(options.out !== undefined && { out: outPath(options.out) }),
    },
    ...(filter?.warning && { warning: filter.warning }),
  };
}

/**
 * Which event mode the flags ask for, checked before anything is sent.
 *
 * @param method - Method argument
 * @param options - Command options
 * @returns The plan, or undefined when no event flag is given
 * @throws CommandError (81) for bad event names, ranges, or flags without their mode
 */
export function planEventCommand(
  method: string | undefined,
  options: CdpCommandOptions
): EventCommandPlan | undefined {
  if (options.events !== undefined && options.events !== false) {
    if (method !== undefined) {
      throw invalid(
        cdpEventFlagsConflictError(
          ['--events', 'a method'],
          '--events reads the buffer; to listen while calling a method use <Method> --listen <Event>'
        )
      );
    }
    return planRead(options);
  }
  rejectFlags(
    { '--wait': options.wait, '--clear': options.clear },
    '--events',
    'bdg cdp --events Fetch.requestPaused --wait 5'
  );
  if (options.collect !== undefined || options.until !== undefined) {
    if (method === undefined) {
      throw invalid(
        cdpEventFlagsError(
          [options.collect !== undefined ? '--collect' : '--until'],
          'a method to call',
          'bdg cdp Tracing.end --collect Tracing.dataCollected --until Tracing.tracingComplete --out trace.ndjson'
        )
      );
    }
    return planCollect(options);
  }
  rejectFlags(
    { '--timeout': options.timeout },
    '--collect or --until',
    'bdg cdp Page.reload --until Page.loadEventFired --timeout 5'
  );
  rejectFlags(
    { '--out': options.out },
    '--collect, --until or --events',
    'bdg cdp --events --out events.ndjson'
  );
  if (options.unlisten) {
    if (method !== undefined) {
      throw invalid(
        cdpEventFlagsConflictError(
          ['--unlisten', 'a method'],
          'call the method first, then: bdg cdp --unlisten'
        )
      );
    }
    return { mode: 'unlisten' };
  }
  if (options.listen === undefined) return undefined;
  const listened = parseEventNames(options.listen);
  return {
    mode: 'listen',
    events: listened.events,
    ...(listened.warning && { warning: listened.warning }),
  };
}

/**
 * Hints of a collection: partial events, events left out.
 *
 * @param data - Collection result
 * @param collect - What was asked
 * @returns Hint lines
 */
export function collectHints(data: CdpCollectData, collect: CdpCollectParams): string[] {
  return [
    ...(!data.complete && collect.until
      ? [collectIncompleteHint(collect.until, collect.timeoutMs / 1000)]
      : []),
    ...(data.omitted ? [eventsOmittedHint(data.omitted, false)] : []),
  ];
}

/**
 * Send a `cdp_events` request and shape its answer.
 *
 * @param request - Listen, read or unlisten
 * @param warning - Warning of the event names
 * @returns Command result with hints
 */
export async function runEventsRequest(
  request: CdpEventsCommand,
  warning?: string
): Promise<CommandResult<CdpEventsCommandData>> {
  const response = await cdpEvents(request);
  validateIPCResponse(response);
  const data = response.data as CdpEventsCommandData;
  const hints = [
    ...(request.action === 'listen' ? [listeningHint()] : []),
    ...(data.remaining ? [eventsOmittedHint(data.remaining, true)] : []),
    ...(data.waitedOut && request.action === 'read'
      ? [eventsWaitedOutHint((request.waitMs ?? 0) / 1000, request.events ?? [])]
      : []),
  ];
  return {
    success: true,
    data,
    ...(warning && { warning }),
    ...(hints.length > 0 && { hint: hints.join('\n') }),
  };
}
