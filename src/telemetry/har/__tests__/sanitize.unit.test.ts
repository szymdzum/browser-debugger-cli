/**
 * HAR sanitization unit tests.
 *
 * `bdg network har` writes a sanitized HAR by default: credentials in
 * headers, cookies and request bodies are replaced by `[redacted]`, and
 * `--include-sensitive` (`includeSensitive: true`) keeps the HAR as captured.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildHAR } from '@/telemetry/har/builder.js';
import type { Entry, HAR } from '@/telemetry/har/types.js';
import type { NetworkRequest } from '@/types.js';

const REDACTED = '[redacted]';
const SECRETS = ['SECRET', 'hunter2', 'sid-value', 'xk-123', 'tok-456', 'csrf-789', 'pk-000'];

/** A login request carrying every kind of credential the sanitizer handles */
const LOGIN_REQUEST: NetworkRequest = {
  requestId: 'login',
  url: 'https://example.com/api/login?page=2',
  method: 'POST',
  timestamp: 1,
  status: 200,
  requestHeaders: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer SECRET',
    'Proxy-Authorization': 'Basic SECRET',
    Cookie: 'sid=sid-value; theme=dark',
    'X-Api-Key': 'xk-123',
    'x-auth-token': 'tok-456',
    'X-CSRF-Token': 'csrf-789',
    'api-key': 'pk-000',
    Accept: 'application/json',
  },
  requestBody: '{"user":"ann","password":"hunter2","nested":{"access_token":"tok-456"},"n":1}',
  responseHeaders: {
    'Content-Type': 'application/json',
    'Set-Cookie': 'sid=sid-value; Path=/; HttpOnly\ntheme=dark; Path=/',
  },
  responseBody: '{"ok":true}',
};

/**
 * Build a HAR of the given requests.
 *
 * @param requests - Captured requests
 * @param includeSensitive - Keep credentials
 * @returns HAR
 */
function build(requests: NetworkRequest[], includeSensitive?: boolean): HAR {
  return buildHAR(
    requests,
    { version: '0.0.0-test' },
    includeSensitive === undefined ? undefined : { includeSensitive }
  );
}

/**
 * The only entry of a one-request HAR.
 *
 * @param req - Captured request
 * @param includeSensitive - Keep credentials
 * @returns HAR entry
 */
function entryFor(req: NetworkRequest, includeSensitive?: boolean): Entry {
  const entry = build([req], includeSensitive).log.entries[0];
  assert.ok(entry);
  return entry;
}

/**
 * Header value by name, case-insensitively.
 *
 * @param headers - HAR headers
 * @param name - Header name
 * @returns Value, if present
 */
function header(headers: Array<{ name: string; value: string }>, name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

void describe('HAR sanitization (default)', () => {
  test('contains none of the secret values', () => {
    const text = JSON.stringify(build([LOGIN_REQUEST]));
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `HAR should not contain ${secret}`);
    }
  });

  test('keeps credential header names with the value [redacted]', () => {
    const { request, response } = entryFor(LOGIN_REQUEST);
    for (const name of [
      'Authorization',
      'Proxy-Authorization',
      'Cookie',
      'X-Api-Key',
      'x-auth-token',
      'X-CSRF-Token',
      'api-key',
    ]) {
      assert.equal(header(request.headers, name), REDACTED, name);
    }
    assert.equal(header(response.headers, 'Set-Cookie'), REDACTED);
  });

  test('leaves other headers alone', () => {
    const { request, response } = entryFor(LOGIN_REQUEST);
    assert.equal(header(request.headers, 'Accept'), 'application/json');
    assert.equal(header(request.headers, 'Content-Type'), 'application/json');
    assert.equal(header(response.headers, 'Content-Type'), 'application/json');
  });

  test('keeps cookie names and attributes, redacts their values', () => {
    const { request, response } = entryFor(LOGIN_REQUEST);
    assert.deepEqual(request.cookies, [
      { name: 'sid', value: REDACTED },
      { name: 'theme', value: REDACTED },
    ]);
    assert.deepEqual(
      response.cookies.map((c) => [c.name, c.value, c.httpOnly ?? false]),
      [
        ['sid', REDACTED, true],
        ['theme', REDACTED, false],
      ]
    );
  });

  test('keeps header sizes of the captured request', () => {
    const sanitized = entryFor(LOGIN_REQUEST);
    const full = entryFor(LOGIN_REQUEST, true);
    assert.equal(sanitized.request.headersSize, full.request.headersSize);
    assert.equal(sanitized.response.headersSize, full.response.headersSize);
    assert.equal(sanitized.request.bodySize, full.request.bodySize);
  });

  test('redacts password- and token-like fields of a JSON body, at any depth', () => {
    const text = entryFor(LOGIN_REQUEST).request.postData?.text ?? '';
    assert.deepEqual(JSON.parse(text), {
      user: 'ann',
      password: REDACTED,
      nested: { access_token: REDACTED },
      n: 1,
    });
  });

  test('redacts password- and token-like fields of a form-urlencoded body', () => {
    const entry = entryFor({
      ...LOGIN_REQUEST,
      requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
      requestBody: 'user=ann&pwd=hunter2&client_secret=SECRET&apiKey=xk-123&remember=on',
    });
    assert.equal(
      entry.request.postData?.text,
      `user=ann&pwd=${REDACTED}&client_secret=${REDACTED}&apiKey=${REDACTED}&remember=on`
    );
  });

  test('leaves a body without sensitive fields byte for byte', () => {
    const body = '{ "query": "shoes",  "page": 2 }';
    const entry = entryFor({ ...LOGIN_REQUEST, requestBody: body });
    assert.equal(entry.request.postData?.text, body);
  });

  test('leaves a body that is not JSON or a form alone', () => {
    const entry = entryFor({
      ...LOGIN_REQUEST,
      requestHeaders: { 'Content-Type': 'text/plain' },
      requestBody: 'password is not a field here',
    });
    assert.equal(entry.request.postData?.text, 'password is not a field here');
  });

  test('says in the log comment that the HAR was sanitized', () => {
    assert.match(build([LOGIN_REQUEST]).log.comment ?? '', /sanitized.*--include-sensitive/i);
  });
});

void describe('HAR with includeSensitive', () => {
  test('keeps every captured value', () => {
    const { request, response } = entryFor(LOGIN_REQUEST, true);
    for (const [name, value] of Object.entries(LOGIN_REQUEST.requestHeaders ?? {})) {
      assert.equal(header(request.headers, name), value, name);
    }
    assert.equal(
      header(response.headers, 'Set-Cookie'),
      LOGIN_REQUEST.responseHeaders?.['Set-Cookie']
    );
    assert.deepEqual(request.cookies, [
      { name: 'sid', value: 'sid-value' },
      { name: 'theme', value: 'dark' },
    ]);
    assert.equal(response.cookies[0]?.value, 'sid-value');
    assert.equal(request.postData?.text, LOGIN_REQUEST.requestBody);
  });

  test('has no sanitized comment', () => {
    assert.equal(build([LOGIN_REQUEST], true).log.comment, undefined);
  });
});
