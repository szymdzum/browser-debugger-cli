/**
 * Response bodies in `details network`: the default cap, `--body-max`,
 * `--no-body`, and why `--body` has nothing to print.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { skippedBodyPlaceholder } from '@/telemetry/networkRetention.js';
import { DEFAULT_BODY_MAX, capResponseBody, missingBodyReason } from '@/telemetry/responseBody.js';
import type { NetworkRequest } from '@/types.js';

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: 'R',
    url: 'https://a.test/',
    method: 'GET',
    timestamp: 0,
    status: 200,
    duration: 12,
    ...overrides,
  };
}

void describe('capResponseBody', () => {
  void it('cuts a body past the default cap and says how long it was', () => {
    const capped = capResponseBody(request({ responseBody: 'x'.repeat(614000) }));
    assert.equal(DEFAULT_BODY_MAX, 20000);
    assert.equal(capped.responseBody?.length, DEFAULT_BODY_MAX);
    assert.equal(capped.bodyTruncated, true);
    assert.equal(capped.bodyLength, 614000);
  });

  void it('keeps a short body as it is, without the flags', () => {
    const capped = capResponseBody(request({ responseBody: 'short' }));
    assert.equal(capped.responseBody, 'short');
    assert.ok(!('bodyTruncated' in capped));
    assert.ok(!('bodyLength' in capped));
  });

  void it('takes --body-max, 0 for the whole body', () => {
    const body = 'y'.repeat(30000);
    assert.equal(
      capResponseBody(request({ responseBody: body }), { bodyMax: 100 }).responseBody?.length,
      100
    );
    assert.equal(
      capResponseBody(request({ responseBody: body }), { bodyMax: 0 }).responseBody,
      body
    );
  });

  void it('cuts base64 bodies on a whole 4-character group', () => {
    const capped = capResponseBody(
      request({ responseBody: 'QUJD'.repeat(100), responseBodyBase64: true }),
      { bodyMax: 10 }
    );
    assert.equal(capped.responseBody, 'QUJDQUJD');
    assert.equal(capped.bodyLength, 400);
  });

  void it('drops the response body with --no-body, keeping the rest', () => {
    const capped = capResponseBody(
      request({ responseBody: 'abc', responseBodyBase64: true, requestBody: 'q=1' }),
      { noBody: true }
    );
    assert.ok(!('responseBody' in capped));
    assert.ok(!('responseBodyBase64' in capped));
    assert.equal(capped.requestBody, 'q=1');
  });
});

void describe('missingBodyReason', () => {
  void it('is undefined when there is a body, an empty one too', () => {
    assert.equal(missingBodyReason(request({ responseBody: 'a' })), undefined);
    assert.equal(missingBodyReason(request({ responseBody: '' })), undefined);
  });

  void it('says why a body was not captured or was evicted', () => {
    assert.match(
      missingBodyReason(request({ bodyNotCaptured: 'evicted: total body budget' })) ?? '',
      /not captured: evicted: total body budget/
    );
    assert.match(
      missingBodyReason(request({ responseBody: skippedBodyPlaceholder('image') })) ?? '',
      /not captured: image/
    );
  });

  void it('says when the request is still loading or has no body', () => {
    const { duration: _duration, ...pending } = request();
    assert.match(missingBodyReason(pending) ?? '', /still loading/);
    assert.match(missingBodyReason(request()) ?? '', /no response body was captured/);
  });

  void it('says a 204, 205, 304 or HEAD response has no body', () => {
    for (const status of [204, 205, 304]) {
      assert.equal(missingBodyReason(request({ status })), 'the response has no body');
    }
    assert.equal(missingBodyReason(request({ method: 'HEAD' })), 'the response has no body');
    assert.match(
      missingBodyReason(request({ resourceType: 'WebSocket', status: 101 })) ?? '',
      /WebSocket/
    );
  });
});
