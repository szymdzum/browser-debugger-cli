/**
 * Loading state reported by start and `bdg page`: readyState and the requests still running.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readPageLoadingState, summarizePendingRequests } from '@/runtime/page/loadingState.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';

/**
 * A pending request entry.
 *
 * @param url - Request URL
 * @param timestamp - Start time (ms)
 * @param resourceType - CDP resource type
 * @returns Entry as the network collector keeps it
 */
function pending(url: string, timestamp: number, resourceType?: string): PendingRequest {
  return {
    timestamp,
    request: {
      requestId: url,
      url,
      method: 'GET',
      timestamp,
      ...(resourceType && { resourceType: resourceType as never }),
    },
  };
}

/**
 * CDP stub answering `Runtime.evaluate` with a readyState.
 *
 * @param readyState - Value to answer, or undefined for a page that never answers
 * @returns Stub
 */
function fakeCdp(readyState: string | undefined): CDPSender {
  return {
    send: () =>
      readyState === undefined
        ? new Promise(() => undefined)
        : Promise.resolve({ result: { value: readyState } }),
  };
}

void describe('summarizePendingRequests', () => {
  void it('names load-blocking requests first, the longest-running first, at most 3', () => {
    const now = 100_000;
    const summary = summarizePendingRequests(
      [
        pending('https://a.test/poll', 1_000, 'XHR'),
        pending('https://a.test/late.js', 90_000, 'Script'),
        pending('https://a.test/jquery-ui.js', 70_000, 'Script'),
        pending('https://a.test/hero.png', 80_000, 'Image'),
        pending('https://a.test/font.woff2', 95_000, 'Font'),
      ],
      now
    );
    assert.deepEqual(
      summary.map((request) => request.url),
      ['https://a.test/jquery-ui.js', 'https://a.test/hero.png', 'https://a.test/late.js']
    );
    assert.equal(summary[0]?.pendingMs, 30_000);
    assert.equal(summary[0]?.resourceType, 'Script');
  });
});

void describe('readPageLoadingState', () => {
  void it('reports nothing for a complete document', async () => {
    assert.equal(await readPageLoadingState(fakeCdp('complete'), [pending('x', 0)]), undefined);
  });

  void it('reports the readyState and the pending requests of a loading document', async () => {
    const state = await readPageLoadingState(fakeCdp('loading'), [
      pending('https://a.test/1.js', Date.now(), 'Script'),
      pending('https://a.test/2.js', Date.now(), 'Script'),
      pending('https://a.test/3.js', Date.now(), 'Script'),
      pending('https://a.test/4.js', Date.now(), 'Script'),
    ]);
    assert.equal(state?.readyState, 'loading');
    assert.equal(state?.pending.length, 3);
    assert.equal(state?.pendingCount, 4);
  });

  void it('reports nothing when the page does not answer', async () => {
    assert.equal(await readPageLoadingState(fakeCdp(undefined), []), undefined);
  });
});
