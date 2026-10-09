/**
 * Human-readable output of CDP event collection:
 * `bdg cdp <Method> --collect`, `--listen`, `--events` and `--unlisten`.
 */

import type {
  CdpCollectedEvents,
  CdpEventOutput,
  CdpEventsData,
} from '@/ipc/protocol/cdpEventTypes.js';
import { isEmptyCdpResult } from '@/ui/formatters/cdp.js';
import { formatTimestamp } from '@/ui/formatters/console/shared.js';
import { formatBytes, joinLines, pluralize } from '@/ui/formatting.js';

/** Characters of an event's params on its line */
const PARAMS_PREVIEW_LENGTH = 300;

/** `bdg cdp <Method> --collect` result */
export type CdpCollectData = { method: string; result: unknown } & CdpCollectedEvents;

/** `bdg cdp --listen/--events/--unlisten` result, with the method `--listen` called */
export type CdpEventsCommandData = CdpEventsData & { method?: string; result?: unknown };

/**
 * The start of a JSON text, saying how long it is when cut.
 *
 * @param json - JSON text
 * @returns Preview
 */
function preview(json: string): string {
  return json.length > PARAMS_PREVIEW_LENGTH
    ? `${json.slice(0, PARAMS_PREVIEW_LENGTH)}… (${json.length} chars, use --json or --out)`
    : json;
}

/**
 * One line per event: time, name and the start of its params.
 *
 * @param events - Events
 * @returns Indented lines
 */
function eventLines(events: CdpEventOutput[]): string[] {
  return events.map((event) => {
    const params = typeof event.params === 'string' ? event.params : JSON.stringify(event.params);
    return `  ${formatTimestamp(event.ts)} ${event.method} ${preview(params ?? 'null')}`;
  });
}

/**
 * Where the events went: the file written, or nothing (they are listed).
 *
 * @param data - Delivery
 * @returns Line, or undefined
 */
function fileLine(data: { file?: string; bytes?: number; count?: number }): string | undefined {
  if (data.file === undefined) return undefined;
  return `Wrote ${pluralize(data.count ?? 0, 'event')} to ${data.file} (${formatBytes(data.bytes ?? 0)}, NDJSON)`;
}

/**
 * The method's result on one line, when it returned anything.
 *
 * @param method - Method called
 * @param result - Its result
 * @returns Line, or undefined
 */
function resultLine(method: string | undefined, result: unknown): string | undefined {
  if (method === undefined) return undefined;
  if (isEmptyCdpResult(result)) return `${method}: done (no result data)`;
  return `${method}: ${preview(JSON.stringify(result))}`;
}

/**
 * Format `bdg cdp <Method> --collect`.
 *
 * @param data - Method result and collected events
 * @returns Text output
 */
export function formatCdpCollect(data: CdpCollectData): string {
  const status = data.dropped
    ? ` (incomplete: ${data.dropped} dropped, the disk fell behind)`
    : data.complete
      ? ''
      : ' (incomplete: timed out)';
  return joinLines(
    resultLine(data.method, data.result),
    (fileLine(data) ?? `Collected ${pluralize(data.count, 'event')}`) + status,
    ...eventLines(data.events ?? [])
  );
}

/**
 * Format `bdg cdp --listen`, `--events` and `--unlisten`.
 *
 * @param data - Buffer state and the events read
 * @returns Text output
 */
export function formatCdpEvents(data: CdpEventsCommandData): string {
  const state = `${pluralize(data.buffered, 'event')} buffered${data.dropped > 0 ? `, ${data.dropped} dropped at the cap` : ''}`;
  if (data.stopped !== undefined) {
    return `Stopped listening to ${data.stopped.join(', ')} (${pluralize(data.discarded ?? 0, 'buffered event')} discarded)`;
  }
  if (data.cleared !== undefined) return `Cleared ${pluralize(data.cleared, 'event')} (${state})`;
  if (data.count === undefined) {
    return joinLines(
      resultLine(data.method, data.result),
      `Listening to ${data.listening.join(', ')} (${state})`
    );
  }
  return joinLines(
    fileLine(data) ?? pluralize(data.count, 'event'),
    ...eventLines(data.events ?? []),
    `(${state}; listening to ${data.listening.join(', ')})`
  );
}

/** Result of any `bdg cdp` event mode */
export type CdpEventCommandData = CdpCollectData | CdpEventsCommandData;

/**
 * Format the result of a `bdg cdp` event mode.
 *
 * @param data - Collection, or buffer state and events
 * @returns Text output
 */
export function formatCdpEventCommand(data: CdpEventCommandData): string {
  return 'complete' in data ? formatCdpCollect(data) : formatCdpEvents(data);
}
