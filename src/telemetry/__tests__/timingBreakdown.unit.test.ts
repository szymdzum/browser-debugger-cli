/**
 * Phase arithmetic of `network details` (#837): Chrome's timing offsets
 * (ms from `requestTime`, -1 when a phase did not happen) and monotonic
 * seconds become queued/dns/connect/tls/send/wait/download in ms.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timingBreakdown } from '@/telemetry/timingBreakdown.js';
import type { NetworkRequest } from '@/types.js';

type Timing = NonNullable<NetworkRequest['timing']>;

/**
 * A completed request whose start is monotonic second 100.
 *
 * @param timing - Timing offsets; `requestTime` defaults to 100.25
 * @param finishedAfterRequestTime - Seconds from `requestTime` to the last byte
 * @param extra - Other request fields
 * @returns Request
 */
function request(
  timing: Timing | undefined,
  finishedAfterRequestTime: number,
  extra: Partial<NetworkRequest> = {}
): NetworkRequest {
  const requestTime = timing?.requestTime ?? 100.25;
  return {
    requestId: '1',
    url: 'https://app.test/api',
    method: 'GET',
    timestamp: 0,
    sentTime: 100,
    loadingFinishedTime: requestTime + finishedAfterRequestTime,
    duration: Math.round((requestTime + finishedAfterRequestTime - 100) * 1000),
    ...(timing && { timing }),
    ...extra,
  };
}

const NEW_CONNECTION: Timing = {
  requestTime: 100.25,
  dnsStart: 5,
  dnsEnd: 25,
  connectStart: 25,
  connectEnd: 75,
  sslStart: 45,
  sslEnd: 75,
  sendStart: 75,
  sendEnd: 76,
  receiveHeadersEnd: 276,
};

const REUSED: Timing = {
  requestTime: 100.25,
  dnsStart: -1,
  dnsEnd: -1,
  connectStart: -1,
  connectEnd: -1,
  sslStart: -1,
  sslEnd: -1,
  sendStart: 2,
  sendEnd: 3,
  receiveHeadersEnd: 103,
};

void describe('timingBreakdown', () => {
  void it('splits a new TLS connection: queued up to the first phase, connect without tls', () => {
    assert.deepEqual(timingBreakdown(request(NEW_CONNECTION, 0.326)), {
      phases: { queued: 255, dns: 20, connect: 20, tls: 30, send: 1, wait: 200, download: 50 },
      dominant: 'queued',
      totalMs: 576,
    });
  });

  void it('names wait when the server took longest', () => {
    const slowServer = { ...NEW_CONNECTION, requestTime: 100.005, receiveHeadersEnd: 876 };
    const breakdown = timingBreakdown(request(slowServer, 0.926));
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal(breakdown.dominant, 'wait');
    assert.equal(breakdown.phases.wait, 800);
  });

  void it('leaves out the phases of a reused connection (-1), not 0', () => {
    assert.deepEqual(timingBreakdown(request(REUSED, 0.123)), {
      phases: { queued: 252, send: 1, wait: 100, download: 20 },
      dominant: 'queued',
      totalMs: 373,
    });
  });

  void it('counts proxy resolution as connect time and not as queued', () => {
    const proxied: Timing = {
      ...REUSED,
      proxyStart: 0,
      proxyEnd: 10,
      connectStart: 10,
      connectEnd: 12,
      sendStart: 12,
      sendEnd: 13,
      receiveHeadersEnd: 113,
    };
    const breakdown = timingBreakdown(request(proxied, 0.123));
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal(breakdown.phases.connect, 12);
    assert.equal(breakdown.phases.queued, 250);
  });

  void it('keeps the wait for a socket queued although Chrome starts proxyStart at 0', () => {
    const behindOthers: Timing = {
      ...REUSED,
      proxyStart: 0,
      proxyEnd: 0,
      connectStart: 700,
      connectEnd: 700,
      sendStart: 700,
      sendEnd: 701,
      receiveHeadersEnd: 703,
    };
    const breakdown = timingBreakdown(request(behindOthers, 0.704));
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal(breakdown.phases.queued, 950);
    assert.equal(breakdown.dominant, 'queued');
  });

  void it('omits connect for a reused connection with a zero-length proxy span', () => {
    const breakdown = timingBreakdown(request({ ...REUSED, proxyStart: 0, proxyEnd: 0 }, 0.123));
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal('connect' in breakdown.phases, false, JSON.stringify(breakdown.phases));
  });

  void it('says no-timing when the headers end is missing or -1', () => {
    const { receiveHeadersEnd, ...noHeadersEnd } = REUSED;
    void receiveHeadersEnd;
    for (const timing of [noHeadersEnd, { ...REUSED, receiveHeadersEnd: -1 }]) {
      assert.deepEqual(timingBreakdown(request(timing, 0.5)), { unavailable: 'no-timing' });
    }
    const { sendEnd, ...noSendEnd } = REUSED;
    void sendEnd;
    assert.deepEqual(timingBreakdown(request(noSendEnd, 0.5)), { unavailable: 'no-timing' });
  });

  void it('says no-timing when the offsets are out of order', () => {
    const shuffled: Timing = { ...REUSED, sendStart: 50, sendEnd: 2, receiveHeadersEnd: 1 };
    assert.deepEqual(timingBreakdown(request(shuffled, 0.5)), { unavailable: 'no-timing' });
  });

  void it('says service-worker when a service worker answered', () => {
    const viaFlag = request(REUSED, 0.123, { fromServiceWorker: true });
    assert.deepEqual(timingBreakdown(viaFlag), { unavailable: 'service-worker' });
  });

  void it('never gives a negative phase', () => {
    const breakdown = timingBreakdown(request(REUSED, 0.05));
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal(breakdown.phases.download, 0);
    for (const ms of Object.values(breakdown.phases)) assert.ok(ms >= 0);
  });

  void it('says cache for a response from the cache, whatever timing it carries', () => {
    assert.deepEqual(timingBreakdown(request(REUSED, 0.123, { fromCache: true })), {
      unavailable: 'cache',
    });
  });

  void it('says pending for a request that has not finished', () => {
    const { loadingFinishedTime, duration, ...pending } = request(REUSED, 0.123);
    void loadingFinishedTime;
    void duration;
    assert.deepEqual(timingBreakdown(pending), { unavailable: 'pending' });
  });

  void it('says failed for a request that failed before its headers arrived', () => {
    const { receiveHeadersEnd, ...noHeaders } = REUSED;
    void receiveHeadersEnd;
    const failed = request(noHeaders, 0.5, { errorText: 'net::ERR_CONNECTION_RESET' });
    assert.deepEqual(timingBreakdown(failed), { unavailable: 'failed' });
    const blocked = request(REUSED, 0.123, { blockedReason: 'csp' });
    assert.deepEqual(timingBreakdown(blocked), { unavailable: 'failed' });
  });

  void it('measures a request aborted after its headers up to the failure', () => {
    const { loadingFinishedTime, ...aborted } = request(REUSED, 0.175, {
      errorText: 'net::ERR_ABORTED',
    });
    void loadingFinishedTime;
    assert.deepEqual(timingBreakdown(aborted), {
      phases: { queued: 252, send: 1, wait: 100, download: 72 },
      dominant: 'queued',
      totalMs: 425,
    });
  });

  void it('says no-timing for a data: or blob: URL even when Chrome says cached', () => {
    for (const url of ['data:image/png;base64,AAAA', 'blob:https://app.test/1-2']) {
      const cached = request(undefined, 0, { url, fromCache: true });
      assert.deepEqual(timingBreakdown(cached), { unavailable: 'no-timing' }, url);
    }
  });

  void it('says no-timing for a finished request Chrome reported no timing for (data: URL)', () => {
    const data = request(undefined, 0, { url: 'data:text/plain,hi', duration: 0 });
    assert.deepEqual(timingBreakdown(data), { unavailable: 'no-timing' });
  });

  void it('breaks a redirect hop down when Chrome gave it timing', () => {
    const hop = request(REUSED, 0.113, {
      requestId: '1:redirect:1',
      status: 302,
      redirectURL: 'https://app.test/next',
    });
    const breakdown = timingBreakdown(hop);
    assert.ok('phases' in breakdown, JSON.stringify(breakdown));
    assert.equal(breakdown.phases.wait, 100);
    assert.equal(breakdown.phases.download, 10);
  });

  void it('says no-timing for a redirect hop without timing', () => {
    const hop = request(undefined, 0.1, {
      requestId: '1:redirect:1',
      redirectURL: 'https://a.test/',
    });
    assert.deepEqual(timingBreakdown(hop), { unavailable: 'no-timing' });
  });
});
