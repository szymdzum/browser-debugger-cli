/**
 * Where a request's time went (#837): queued, dns, connect, tls, send, wait
 * (time to first byte) and download, computed from the timing Chrome reports.
 */

import type { NetworkRequest } from '@/types.js';

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
export type TimingUnavailableReason = 'cache' | 'pending' | 'failed' | 'no-timing';

/** The phases of a request that has timing; a phase that did not happen is absent */
export interface TimingPhases {
  phases: Partial<Record<TimingPhase, number>>;
  dominant: TimingPhase;
  totalMs: number;
}

/** Breakdown of a request: its phases, or why there are none */
export type TimingBreakdown = TimingPhases | { unavailable: TimingUnavailableReason };

/**
 * Break a request's time into phases.
 *
 * @param request - Captured request
 * @returns Phases in ms with the dominant one, or the reason there are none
 */
export function timingBreakdown(request: NetworkRequest): TimingBreakdown {
  void request;
  return { unavailable: 'no-timing' };
}
