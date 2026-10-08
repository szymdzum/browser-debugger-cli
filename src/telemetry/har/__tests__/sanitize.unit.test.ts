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

/**
 * Request body as exported, for a POST with the given body and Content-Type.
 *
 * @param requestBody - Captured body
 * @param contentType - Content-Type header, if any
 * @returns Exported postData text
 */
function exportedBody(requestBody: string, contentType?: string): string | undefined {
  return entryFor({
    ...LOGIN_REQUEST,
    requestHeaders: contentType === undefined ? {} : { 'Content-Type': contentType },
    requestBody,
  }).request.postData?.text;
}

void describe('HAR sanitization: headers', () => {
  const cases: Array<[string, boolean]> = [
    ['Authentication', true],
    ['x-api-key', true],
    ['apikey', true],
    ['cf-access-jwt-assertion', true],
    ['cf-access-client-secret', true],
    ['private-token', true],
    ['ocp-apim-subscription-key', true],
    ['access-token', true],
    ['auth-token', true],
    ['session-id', true],
    ['x-amz-security-token', true],
    ['www-authenticate', false],
    ['proxy-authenticate', false],
    ['content-type', false],
    ['x-request-id', false],
    ['accept-language', false],
  ];
  for (const [name, redacted] of cases) {
    test(`${name}: ${redacted ? 'redacted' : 'kept'}`, () => {
      const entry = entryFor({
        ...LOGIN_REQUEST,
        requestHeaders: { [name]: 'value-1' },
        responseHeaders: { [name]: 'value-1' },
      });
      const expected = redacted ? REDACTED : 'value-1';
      assert.equal(header(entry.request.headers, name), expected);
      assert.equal(header(entry.response.headers, name), expected);
    });
  }
});

void describe('HAR sanitization: bodies', () => {
  test('redacts a form body sent as text/plain or without Content-Type', () => {
    assert.equal(
      exportedBody('user=ann&password=hunter2', 'text/plain'),
      `user=ann&password=${REDACTED}`
    );
    assert.equal(exportedBody('user=ann&token=tok-456'), `user=ann&token=${REDACTED}`);
  });

  test('leaves text that only contains "=" alone', () => {
    assert.equal(exportedBody('password = hunter2', 'text/plain'), 'password = hunter2');
  });

  test('redacts sensitive parts of a multipart body, other parts byte for byte', () => {
    const body = [
      '------b0undary',
      'Content-Disposition: form-data; name="user"',
      '',
      'ann',
      '------b0undary',
      'Content-Disposition: form-data; name="password"',
      '',
      'hunter2',
      '------b0undary',
      'Content-Disposition: form-data; name="note"',
      '',
      'line one',
      'line two',
      '------b0undary--',
      '',
    ].join('\r\n');
    const expected = body.replace('\r\nhunter2\r\n', `\r\n${REDACTED}\r\n`);
    assert.equal(exportedBody(body, 'multipart/form-data; boundary=----b0undary'), expected);
    assert.equal(exportedBody(body, 'multipart/form-data; boundary="----b0undary"'), expected);
  });

  test('keeps the structure under a sensitive key, redacting its primitives', () => {
    const text = exportedBody(
      '{"tokens":{"count":5,"list":["a",{"id":"b"}],"none":null},"page":{"size":10}}',
      'application/json'
    );
    assert.deepEqual(JSON.parse(text ?? ''), {
      tokens: { count: REDACTED, list: [REDACTED, { id: REDACTED }], none: null },
      page: { size: 10 },
    });
  });

  test('over-redacts primitives under names that only look sensitive', () => {
    const text = exportedBody('{"tokenCount":5,"sessionLength":3,"q":"x"}', 'application/json');
    assert.deepEqual(JSON.parse(text ?? ''), {
      tokenCount: REDACTED,
      sessionLength: REDACTED,
      q: 'x',
    });
  });

  test('redacts jwt, private key, access key, session and signature fields', () => {
    const text = exportedBody(
      '{"jwt":"j","private_key":"p","accessKey":"a","session":"s","signature":"g","ok":1}',
      'application/json'
    );
    assert.deepEqual(JSON.parse(text ?? ''), {
      jwt: REDACTED,
      private_key: REDACTED,
      accessKey: REDACTED,
      session: REDACTED,
      signature: REDACTED,
      ok: 1,
    });
  });

  test('redacts a password nested 100000 levels deep in place', () => {
    const depth = 100000;
    const body = `${'['.repeat(depth)}{"password":"hunter2"}${']'.repeat(depth)}`;
    assert.equal(
      exportedBody(body, 'application/json'),
      body.replace('"hunter2"', `"${REDACTED}"`)
    );
  });
});

void describe('HAR sanitization: URLs', () => {
  const OAUTH_CALLBACK =
    'https://app.example.com/callback?code=abc123&state=xyz&id_token=it-1#access_token=at-2&scope=read';

  test('redacts sensitive query values in the request URL and queryString', () => {
    const entry = entryFor({
      ...LOGIN_REQUEST,
      url: 'https://example.com/api?q=shoes&access_token=at-1&sig=s1&api_key=k1&page=2',
    });
    assert.equal(
      entry.request.url,
      'https://example.com/api?q=shoes&access_token=%5Bredacted%5D&sig=%5Bredacted%5D&api_key=%5Bredacted%5D&page=2'
    );
    assert.deepEqual(entry.request.queryString, [
      { name: 'q', value: 'shoes' },
      { name: 'access_token', value: REDACTED },
      { name: 'sig', value: REDACTED },
      { name: 'api_key', value: REDACTED },
      { name: 'page', value: '2' },
    ]);
  });

  test('redacts an OAuth code in a redirect target, Location and Referer', () => {
    const entry = entryFor({
      ...LOGIN_REQUEST,
      requestHeaders: { Referer: OAUTH_CALLBACK },
      status: 302,
      redirectURL: OAUTH_CALLBACK,
      responseHeaders: { Location: OAUTH_CALLBACK },
    });
    const expected =
      'https://app.example.com/callback?code=%5Bredacted%5D&state=xyz&id_token=%5Bredacted%5D#access_token=%5Bredacted%5D&scope=read';
    assert.equal(entry.response.redirectURL, expected);
    assert.equal(header(entry.response.headers, 'Location'), expected);
    assert.equal(header(entry.request.headers, 'Referer'), expected);
  });

  test('leaves URLs without sensitive parameters alone', () => {
    const url = 'https://example.com/search?q=zipcode&keyword=a%20b';
    assert.equal(entryFor({ ...LOGIN_REQUEST, url }).request.url, url);
  });
});

/** A token endpoint's response: the credentials of a login flow */
const TOKEN_RESPONSE: NetworkRequest = {
  ...LOGIN_REQUEST,
  requestId: 'token',
  mimeType: 'application/json',
  decodedBodyLength: 4242,
  responseBody: JSON.stringify({
    access_token: 'at-SECRET',
    refresh_token: 'rt-SECRET',
    id_token: 'it-SECRET',
    expires_in: 3600,
    user: { name: 'ann', password: 'hunter2', client_secret: 'cs-SECRET' },
  }),
};

/** A WebSocket connection whose frames carry tokens */
const SOCKET: NetworkRequest = {
  requestId: 'ws',
  url: 'wss://example.com/ws',
  method: 'GET',
  timestamp: 2,
  status: 101,
  resourceType: 'WebSocket',
  webSocket: {
    frames: [
      {
        timestamp: 3,
        direction: 'sent',
        opcode: 1,
        payloadData: '{"type":"auth","token":"ws-SECRET"}',
      },
      { timestamp: 4, direction: 'received', opcode: 1, payloadData: 'token ws-plain' },
      {
        timestamp: 6,
        direction: 'received',
        opcode: 1,
        payloadData: '{"type":"auth","token":"ws-cut',
        truncatedFrom: 204800,
      },
      {
        timestamp: 5,
        direction: 'received',
        opcode: 2,
        payloadData: Buffer.from('{"token":"ws-binary"}').toString('base64'),
      },
    ],
  },
};

/**
 * Exported response content of a request.
 *
 * @param req - Captured request
 * @param includeSensitive - Keep credentials
 * @returns HAR content
 */
function contentFor(req: NetworkRequest, includeSensitive?: boolean): Entry['response']['content'] {
  return entryFor(req, includeSensitive).response.content;
}

void describe('HAR sanitization: response bodies', () => {
  test('redacts token and password fields of a JSON response, keeping its structure', () => {
    assert.deepEqual(JSON.parse(contentFor(TOKEN_RESPONSE).text ?? ''), {
      access_token: REDACTED,
      refresh_token: REDACTED,
      id_token: REDACTED,
      expires_in: 3600,
      user: { name: 'ann', password: REDACTED, client_secret: REDACTED },
    });
  });

  test('exports a login response {"access_token":…,"expires_in":3600} redacted', () => {
    const content = contentFor({
      ...TOKEN_RESPONSE,
      responseBody: '{"access_token":"at-SECRET","expires_in":3600}',
    });
    assert.equal(content.text, '{"access_token":"[redacted]","expires_in":3600}');
  });

  test('redacts credential fields of a form-urlencoded response', () => {
    const content = contentFor({
      ...TOKEN_RESPONSE,
      mimeType: 'application/x-www-form-urlencoded',
      responseBody: 'access_token=at-SECRET&scope=repo&token_type=bearer',
    });
    assert.equal(content.text, `access_token=${REDACTED}&scope=repo&token_type=${REDACTED}`);
  });

  test('keeps content.size as captured', () => {
    assert.equal(contentFor(TOKEN_RESPONSE).size, 4242);
  });

  test('leaves a body that is not JSON or a form as is', () => {
    const body = '<p>"token": "kept"</p>';
    const content = contentFor({ ...TOKEN_RESPONSE, mimeType: 'text/html', responseBody: body });
    assert.equal(content.text, body);
    assert.equal(content.comment, undefined);
  });

  test('redacts a 5 MB body without a comment', () => {
    const pad = 'x'.repeat(5 * 1024 * 1024);
    const content = contentFor({
      ...TOKEN_RESPONSE,
      responseBody: JSON.stringify({ pad, access_token: 'at-SECRET' }),
    });
    assert.equal(content.text, JSON.stringify({ pad, access_token: REDACTED }));
    assert.equal(content.comment, undefined);
  });

  test('decodes a base64 JSON body of a generic type, redacts it and re-encodes it', () => {
    const encode = (text: string): string => Buffer.from(text).toString('base64');
    for (const mimeType of ['application/octet-stream', '']) {
      const content = contentFor({
        ...TOKEN_RESPONSE,
        mimeType,
        responseBody: encode('{"access_token":"at-SECRET","n":1}'),
        responseBodyBase64: true,
      });
      assert.equal(content.text, encode(`{"access_token":"${REDACTED}","n":1}`), String(mimeType));
      assert.equal(content.encoding, 'base64');
    }
  });

  test('leaves a base64 body that is an image or not UTF-8 as is', () => {
    const json = Buffer.from('{"access_token":"at-SECRET"}').toString('base64');
    const invalid = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]).toString('base64');
    const image = { ...TOKEN_RESPONSE, mimeType: 'image/png', responseBodyBase64: true };
    assert.equal(contentFor({ ...image, responseBody: json }).text, json);
    const octet = { ...image, mimeType: 'application/octet-stream', responseBody: invalid };
    assert.equal(contentFor(octet).text, invalid);
  });

  test('--include-sensitive keeps the response body as captured', () => {
    const content = contentFor(TOKEN_RESPONSE, true);
    assert.equal(content.text, TOKEN_RESPONSE.responseBody);
    assert.equal(content.comment, undefined);
  });
});

/**
 * Exported WebSocket messages of {@link SOCKET}.
 *
 * @param includeSensitive - Keep credentials
 * @returns Message payloads in order
 */
function socketData(includeSensitive?: boolean): string[] {
  return (entryFor(SOCKET, includeSensitive)._webSocketMessages ?? []).map((m) => m.data);
}

void describe('HAR sanitization: WebSocket messages', () => {
  test('redacts credential fields of JSON text frames', () => {
    assert.equal(socketData()[0], `{"type":"auth","token":"${REDACTED}"}`);
  });

  test('leaves non-JSON text frames and binary frames as is', () => {
    const frames = SOCKET.webSocket?.frames ?? [];
    const data = socketData();
    assert.deepEqual([data[1], data[3]], [frames[1]?.payloadData, frames[3]?.payloadData]);
  });

  test('redacts a frame cut at capture and keeps its truncation marker', () => {
    const message = entryFor(SOCKET)._webSocketMessages?.[2];
    assert.equal(message?.data, `{"type":"auth","token":"${REDACTED}"`);
    assert.equal(message?._truncatedFrom, 204800);
  });

  test('--include-sensitive keeps every frame as captured', () => {
    assert.deepEqual(
      socketData(true),
      (SOCKET.webSocket?.frames ?? []).map((f) => f.payloadData)
    );
  });
});

/**
 * Exported response text of a body.
 *
 * @param responseBody - Captured body
 * @param mimeType - Response MIME type
 * @returns Exported text
 */
function exportedResponse(responseBody: string, mimeType = 'application/json'): string | undefined {
  return contentFor({ ...TOKEN_RESPONSE, mimeType, responseBody }).text;
}

void describe('HAR sanitization: bodies keep their exact bytes', () => {
  const R = `"${REDACTED}"`;

  test('keeps 64-bit numbers, decimals and formatting, editing only the credential', () => {
    const body = '{ "id": 12345678901234567890,\n  "price": 1.50, "token" : "t-SECRET", "n": 1e2 }';
    const expected = body.replace('"t-SECRET"', R);
    assert.equal(exportedResponse(body), expected);
    assert.equal(exportedBody(body, 'application/json'), expected);
  });

  test('redacts every duplicate key', () => {
    assert.equal(exportedResponse('{"token":"a","token":"b"}'), `{"token":${R},"token":${R}}`);
  });

  test('redacts numbers, booleans and escaped strings, keeps null', () => {
    assert.equal(
      exportedResponse('{"passcode":1234,"session":true,"secret":"a\\"b\\\\","jwt":null}'),
      `{"passcode":${R},"session":${R},"secret":${R},"jwt":null}`
    );
  });

  test('matches an escaped key name', () => {
    assert.equal(exportedResponse('{"\\u0074oken":"x"}'), `{"\\u0074oken":${R}}`);
  });

  test('keeps a BOM and an XSSI prefix byte for byte', () => {
    assert.equal(
      exportedResponse('\uFEFF)]}\'\n{"token":"x","a":[1]}'),
      `\uFEFF)]}'\n{"token":${R},"a":[1]}`
    );
  });

  test('redacts a truncated JSON tail', () => {
    assert.equal(exportedResponse('{"a":1,"token":"abc'), `{"a":1,"token":${R}`);
  });

  test('redacts socket.io, server-sent event and NDJSON framing', () => {
    assert.equal(exportedResponse('42["auth",{"token":"X"}]', ''), `42["auth",{"token":${R}}]`);
    assert.equal(
      exportedResponse(
        'event: auth\ndata: {"token":"x"}\n\ndata: {"ok":1}\n\n',
        'text/event-stream'
      ),
      `event: auth\ndata: {"token":${R}}\n\ndata: {"ok":1}\n\n`
    );
    assert.equal(
      exportedResponse('{"token":"a"}\n{"token":"b","n":2}\n', 'application/x-ndjson'),
      `{"token":${R}}\n{"token":${R},"n":2}\n`
    );
  });

  test('scans in linear time: 5 MB and pathological inputs under 3 s each', () => {
    const big = `[${Array.from({ length: 100000 }, (_, i) => `{"id":${i},"token":"t${i}","note":"${'n'.repeat(30)}"}`).join(',')}]`;
    const inputs = [
      big + ' '.repeat(Math.max(0, 5 * 1024 * 1024 - big.length)),
      `{"a"${' '.repeat(5 * 1024 * 1024)}`,
      `["${'\\"'.repeat(2 * 1024 * 1024)}`,
      '"'.repeat(5 * 1024 * 1024),
      `{${'"token":'.repeat(500000)}`,
      `{"token":${'-1e'.repeat(1000000)}`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      exportedResponse(input);
      assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
    }
  });
});

void describe('HAR sanitization: log comment', () => {
  test('says response bodies and WebSocket messages are sanitized, and what is not', () => {
    const comment = build([LOGIN_REQUEST]).log.comment ?? '';
    assert.doesNotMatch(comment, /not sanitized\. Export/);
    assert.match(comment, /response bodies/i);
    assert.match(comment, /WebSocket/);
    assert.match(comment, /binary/i);
    assert.doesNotMatch(comment, /2 MB/);
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
