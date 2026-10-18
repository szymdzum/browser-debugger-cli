/**
 * The Timing rows of `network details` (#837): the phases on one line and a
 * verdict naming the phase that took most of the time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NetworkRequest } from '@/types.js';
import { formatNetworkDetails } from '@/ui/formatters/details.js';

/**
 * A completed request starting at monotonic second 100 with a reused connection.
 *
 * @param extra - Fields to add or replace
 * @returns Request
 */
function request(extra: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: '1',
    url: 'https://app.test/api',
    method: 'GET',
    timestamp: 0,
    status: 200,
    sentTime: 100,
    loadingFinishedTime: 101.05,
    duration: 1050,
    protocol: 'h2',
    timing: {
      requestTime: 100.01,
      dnsStart: -1,
      dnsEnd: -1,
      connectStart: -1,
      connectEnd: -1,
      sslStart: -1,
      sslEnd: -1,
      sendStart: 1,
      sendEnd: 2,
      receiveHeadersEnd: 1002,
    },
    ...extra,
  };
}

void describe('network details Timing rows', () => {
  void it('shows the phases on one line, without those that did not happen', () => {
    const text = formatNetworkDetails(request());
    assert.match(text, /Timing:\s+queued 11 ms · send 1 ms · wait 1000 ms · download 38 ms\n/);
    assert.doesNotMatch(text, /dns|connect|tls/);
  });

  void it('says a dominant wait is server time and nothing to fix in the page', () => {
    assert.match(
      formatNetworkDetails(request()),
      /wait.*server time \(TTFB\).*nothing to fix in the page/
    );
  });

  void it('explains a dominant queue with the 6-connection limit on HTTP/1.1 only', () => {
    const queued = request({
      protocol: 'http/1.1',
      timing: { requestTime: 100.9, sendStart: 1, sendEnd: 2, receiveHeadersEnd: 10 },
      loadingFinishedTime: 100.92,
      duration: 920,
    });
    assert.match(formatNetworkDetails(queued), /queued.*at most 6 connections per host/);
    assert.doesNotMatch(
      formatNetworkDetails({ ...queued, protocol: 'h2' }),
      /6 connections per host/
    );
  });

  void it('says a response from the cache used no network', () => {
    assert.match(
      formatNetworkDetails(request({ fromCache: true })),
      /Timing:\s+.*cache.*no network/
    );
  });

  void it('gives a reason instead of zeros when the request has no timing', () => {
    const { timing, ...noTiming } = request();
    void timing;
    const text = formatNetworkDetails(noTiming);
    assert.match(text, /Timing:\s+none \(/);
    assert.doesNotMatch(text, /wait 0|download 0/);
  });

  void it('puts the size in a dominant download and names both causes', () => {
    const slowBody = request({
      timing: { requestTime: 100.0, sendStart: 1, sendEnd: 2, receiveHeadersEnd: 10 },
      loadingFinishedTime: 101.8,
      duration: 1800,
      encodedDataLength: 540672,
    });
    assert.match(
      formatNetworkDetails(slowBody),
      /spent in download \(528\.0 KB in 1790 ms\): a large body, or a server sending it slowly/
    );
  });

  void it('notes that a local proxy owns the protocol and the connection times', () => {
    const proxied = request({
      url: 'https://app.test/api',
      serverIPAddress: '127.0.0.1',
      serverPort: 9000,
    });
    assert.match(formatNetworkDetails(proxied), /local proxy's/);
    assert.doesNotMatch(formatNetworkDetails(request()), /local proxy's/);
  });
});
