/**
 * Where a request's time went (#837): queued, dns, connect, tls, send, wait
 * (time to first byte) and download, computed from the timing Chrome reports.
 */

import type { NetworkRequest } from '@/types.js';

type Timing = NonNullable<NetworkRequest['timing']>;

const MS_PER_SECOND = 1000;

/** The phases of a request, in the order they happen */
export const TIMING_PHASES = [
  'queued',
  'dns',
  'connect',
  'tls',
  'send',
  'wait',
  'download',
] as const;

/** One phase of a request */
export type TimingPhase = (typeof TIMING_PHASES)[number];

/** Why a request has no breakdown */
export type TimingUnavailableReason =
  'cache' | 'pending' | 'failed' | 'service-worker' | 'no-timing';

/** The phases of a request that has timing; a phase that did not happen is absent */
export interface TimingPhases {
  phases: Partial<Record<TimingPhase, number>>;
  dominant: TimingPhase;
  totalMs: number;
}

/** Breakdown of a request: its phases, or why there are none */
export type TimingBreakdown = TimingPhases | { unavailable: TimingUnavailableReason };

/**
 * Time between two of Chrome's timing offsets (ms from `requestTime`).
 *
 * @param start - Start offset (-1 when the phase did not happen)
 * @param end - End offset (-1 when the phase did not happen)
 * @returns Duration in ms, or undefined when either end is missing or the span is negative
 */
export function offsetSpan(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined || start < 0 || end < 0 || end < start) {
    return undefined;
  }
  return end - start;
}

/**
 * Chrome's monotonic time (seconds) the request ended: its last byte, or for
 * a failed request the failure (`sentTime` plus `duration`).
 *
 * @param request - Captured request
 * @returns The end time, or undefined while the request is pending
 */
function endTime(request: NetworkRequest): number | undefined {
  if (request.loadingFinishedTime !== undefined) return request.loadingFinishedTime;
  if (request.sentTime === undefined || request.duration === undefined) return undefined;
  return request.sentTime + request.duration / MS_PER_SECOND;
}

/**
 * Whether the request has the timing offsets to measure it by: its start,
 * and send and headers offsets in order.
 *
 * @param request - Captured request
 * @returns True when the phases can be measured
 */
function hasUsableTiming(request: NetworkRequest): boolean {
  return (
    request.timing?.requestTime !== undefined &&
    request.sentTime !== undefined &&
    hasOrderedOffsets(request.timing)
  );
}

/**
 * Whether the timing has the offsets the wait and send phases are measured
 * from, in order (send ends before the headers end); anything else would
 * give phases that are not what happened.
 *
 * @param timing - Chrome's timing of the request
 * @returns True when the offsets are present and ordered
 */
function hasOrderedOffsets(timing: Timing): boolean {
  const { sendStart, sendEnd, receiveHeadersEnd } = timing;
  if (sendEnd === undefined || receiveHeadersEnd === undefined) return false;
  if (sendEnd < 0 || receiveHeadersEnd < sendEnd) return false;
  return sendStart === undefined || sendStart < 0 || sendStart <= sendEnd;
}

/**
 * Why a request has no breakdown.
 *
 * @param request - Captured request
 * @returns The reason, or undefined when the request has timing to break down
 */
function unavailableReason(request: NetworkRequest): TimingUnavailableReason | undefined {
  if (/^(data|blob):/i.test(request.url) || request.resourceType === 'WebSocket') {
    return 'no-timing';
  }
  if (request.fromCache) return 'cache';
  if (request.blockedReason !== undefined) return 'failed';
  if (request.errorText !== undefined) return hasUsableTiming(request) ? undefined : 'failed';
  if (endTime(request) === undefined) return 'pending';
  if (request.fromServiceWorker) return 'service-worker';
  return hasUsableTiming(request) ? undefined : 'no-timing';
}

/**
 * Milliseconds from the request start (`sentTime`) to the first connection or
 * send phase: Chrome's queue (connection limit, priority, cache lookup).
 * Proxy resolution happens inside that gap (Chrome sets `proxyStart` at the
 * start of the request, so waiting for a socket follows it): it is counted
 * as connect time by {@link connectMs} and taken out here.
 *
 * @param timing - Chrome's timing of the request
 * @param startedAfter - Milliseconds from `sentTime` to `timing.requestTime`
 * @returns Queued time in ms
 */
function queuedMs(timing: Timing, startedAfter: number): number {
  const starts = [timing.dnsStart, timing.connectStart, timing.sendStart].filter(
    (offset): offset is number => offset !== undefined && offset >= 0
  );
  const firstStart = starts.length > 0 ? Math.min(...starts) : 0;
  return startedAfter + firstStart - (offsetSpan(timing.proxyStart, timing.proxyEnd) ?? 0);
}

/**
 * Connect time without TLS, with proxy resolution folded in.
 *
 * @param timing - Chrome's timing of the request
 * @param tls - TLS time (Chrome's connect span includes it)
 * @returns Connect time in ms, or undefined when there was no connect or proxy phase
 */
function connectMs(timing: Timing, tls: number | undefined): number | undefined {
  const connect = offsetSpan(timing.connectStart, timing.connectEnd);
  const proxy = offsetSpan(timing.proxyStart, timing.proxyEnd);
  if (connect === undefined) return proxy === undefined || proxy === 0 ? undefined : proxy;
  return connect - (tls ?? 0) + (proxy ?? 0);
}

/**
 * Measure each phase of a request that has timing.
 *
 * @param request - Captured request (`sentTime`, an end time and `timing.requestTime` set)
 * @param timing - Chrome's timing of the request
 * @returns Phases in ms (rounded, never negative); those that did not happen are absent
 */
function measurePhases(request: NetworkRequest, timing: Timing): TimingPhases['phases'] {
  const requestTime = timing.requestTime ?? 0;
  const startedAfter = (requestTime - (request.sentTime ?? 0)) * MS_PER_SECOND;
  const downloadStart = timing.receiveHeadersEnd;
  const tls = offsetSpan(timing.sslStart, timing.sslEnd);
  const measured: Partial<Record<TimingPhase, number | undefined>> = {
    queued: queuedMs(timing, startedAfter),
    dns: offsetSpan(timing.dnsStart, timing.dnsEnd),
    connect: connectMs(timing, tls),
    tls,
    send: offsetSpan(timing.sendStart, timing.sendEnd),
    wait: offsetSpan(timing.sendEnd, timing.receiveHeadersEnd),
    download:
      downloadStart !== undefined && downloadStart >= 0
        ? ((endTime(request) ?? 0) - requestTime) * MS_PER_SECOND - downloadStart
        : undefined,
  };
  const phases: TimingPhases['phases'] = {};
  for (const phase of TIMING_PHASES) {
    const ms = measured[phase];
    if (ms !== undefined) phases[phase] = Math.max(0, Math.round(ms));
  }
  return phases;
}

/**
 * Break a request's time into phases.
 *
 * `timing.*` are ms offsets from `timing.requestTime`; `sentTime`,
 * `requestTime` and `loadingFinishedTime` are Chrome's monotonic seconds.
 * Queued is the time before the first connection or send phase starts,
 * connect excludes TLS and includes proxy resolution, wait is the time from
 * the end of the send to the first byte, download runs to the last byte.
 *
 * @param request - Captured request
 * @returns Phases in ms with the dominant one and the total, or the reason there are none
 */
export function timingBreakdown(request: NetworkRequest): TimingBreakdown {
  const unavailable = unavailableReason(request);
  if (unavailable !== undefined) return { unavailable };
  const phases = measurePhases(request, request.timing ?? {});
  const dominant = TIMING_PHASES.reduce<TimingPhase>(
    (best, phase) => ((phases[phase] ?? -1) > (phases[best] ?? -1) ? phase : best),
    'queued'
  );
  const totalMs = ((endTime(request) ?? 0) - (request.sentTime ?? 0)) * MS_PER_SECOND;
  return { phases, dominant, totalMs: Math.max(0, Math.round(totalMs)) };
}
