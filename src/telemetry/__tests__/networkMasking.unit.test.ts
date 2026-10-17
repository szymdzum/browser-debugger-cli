/**
 * Masked network output unit tests (#615).
 *
 * `network details` and `network headers` show the
 * credentials the HAR sanitiser redacts as `••••`: header values (keeping
 * cookie names, `Set-Cookie` attributes and auth schemes), URL credentials,
 * secret fields of bodies and WebSocket messages. Everything else stays as
 * captured, and `masked` says whether anything was replaced.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { maskHeaderFields, maskNetworkRequest } from '@/telemetry/networkMasking.js';
import type { NetworkRequest } from '@/types.js';

const MASK = '••••';

/** A plain request with nothing secret in it */
const PLAIN: NetworkRequest = {
  requestId: '1.1',
  url: 'https://example.com/search?q=shoes&page=2',
  method: 'GET',
  timestamp: 1,
  status: 200,
  mimeType: 'application/json',
  requestHeaders: { Accept: 'application/json', 'User-Agent': 'test' },
  responseHeaders: { 'Content-Type': 'application/json', 'Content-Length': '42' },
  responseBody: '{"results":[{"id":1,"name":"Boot"}],"total":1}',
};

/**
 * Mask a request built from {@link PLAIN} with some fields replaced.
 *
 * @param fields - Fields to replace
 * @returns Masked request and flag
 */
function mask(fields: Partial<NetworkRequest>): { value: NetworkRequest; masked: boolean } {
  return maskNetworkRequest({ ...PLAIN, ...fields });
}

void describe('maskNetworkRequest', () => {
  test('leaves a request without credentials as captured', () => {
    const { value, masked } = maskNetworkRequest(PLAIN);
    assert.deepEqual(value, PLAIN);
    assert.equal(masked, false);
  });

  test('masks cookie values and keeps names and Set-Cookie attributes', () => {
    const { value, masked } = mask({
      requestHeaders: { Cookie: 'sid=LIVE42; theme=dark; empty=' },
      responseHeaders: { 'Set-Cookie': 'sid=LIVE42; Path=/; HttpOnly\nlang=en; Max-Age=60' },
    });
    assert.equal(masked, true);
    assert.equal(value.requestHeaders?.['Cookie'], `sid=${MASK}; theme=${MASK}; empty=`);
    assert.equal(
      value.responseHeaders?.['Set-Cookie'],
      `sid=${MASK}; Path=/; HttpOnly\nlang=${MASK}; Max-Age=60`
    );
  });

  test('keeps the scheme of Authorization and Proxy-Authorization', () => {
    const { value } = mask({
      requestHeaders: {
        authorization: 'Bearer JWTXYZ1',
        'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        Authentication: 'raw-token',
      },
    });
    assert.equal(value.requestHeaders?.['authorization'], `Bearer ${MASK}`);
    assert.equal(value.requestHeaders?.['Proxy-Authorization'], `Basic ${MASK}`);
    assert.equal(value.requestHeaders?.['Authentication'], MASK);
  });

  test('masks a token without a scheme whole', () => {
    const { value } = mask({ requestHeaders: { Authorization: 'abc123' } });
    assert.equal(value.requestHeaders?.['Authorization'], MASK);
  });

  test('masks API key, token and CSRF headers and keeps the others', () => {
    const { value } = mask({
      requestHeaders: {
        'X-API-Key': 'k1',
        'X-CSRF-Token': 'c1',
        'private-token': 'p1',
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Bearer realm="api"',
      },
    });
    assert.deepEqual(value.requestHeaders, {
      'X-API-Key': MASK,
      'X-CSRF-Token': MASK,
      'private-token': MASK,
      'Content-Type': 'text/plain',
      'WWW-Authenticate': 'Bearer realm="api"',
    });
  });

  test('masks headers named like a secret field and keeps the CORS credentials flag', () => {
    const { value } = mask({
      requestHeaders: {
        Password: 'p1',
        'X-Password': 'p2',
        'X-Pass': 'p3',
        Sid: 's1',
        'X-Credential': 'c1',
        Cookie2: 'k1',
      },
      responseHeaders: { 'Access-Control-Allow-Credentials': 'true' },
    });
    assert.deepEqual(value.requestHeaders, {
      Password: MASK,
      'X-Password': MASK,
      'X-Pass': MASK,
      Sid: MASK,
      'X-Credential': MASK,
      Cookie2: MASK,
    });
    assert.deepEqual(value.responseHeaders, { 'Access-Control-Allow-Credentials': 'true' });
  });

  test('masks credential parameters of Link, Refresh and Content-Location', () => {
    const { value } = mask({
      responseHeaders: {
        Link: '</a?token=T1&page=2>; rel="next", </b>; rel="prev"',
        Refresh: '5; url=/cb?code=C1&state=ok',
        'Content-Location': '/doc?access_token=T2',
      },
    });
    assert.deepEqual(value.responseHeaders, {
      Link: `</a?token=${MASK}&page=2>; rel="next", </b>; rel="prev"`,
      Refresh: `5; url=/cb?code=${MASK}&state=ok`,
      'Content-Location': `/doc?access_token=${MASK}`,
    });
  });

  test('masks a JWT in any header value', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const { value, masked } = mask({ requestHeaders: { 'X-Debug': `user ${jwt}`, Accept: '*/*' } });
    assert.equal(masked, true);
    assert.deepEqual(value.requestHeaders, { 'X-Debug': `user ${MASK}`, Accept: '*/*' });
  });

  test('masks credentials of the URL, redirect URL, Location, Referer and :path', () => {
    const callback = 'https://bob:pw@app.example.com/cb?code=C1&state=ok#access_token=T1&scope=r';
    const expected = `https://app.example.com/cb?code=${MASK}&state=ok#access_token=${MASK}&scope=r`;
    const { value, masked } = mask({
      url: callback,
      redirectURL: callback,
      requestHeaders: { Referer: callback, ':path': '/cb?code=C1&state=ok' },
      responseHeaders: { Location: callback },
    });
    assert.equal(masked, true);
    assert.equal(value.url, expected);
    assert.equal(value.redirectURL, expected);
    assert.equal(value.requestHeaders?.['Referer'], expected);
    assert.equal(value.requestHeaders?.[':path'], `/cb?code=${MASK}&state=ok`);
    assert.equal(value.responseHeaders?.['Location'], expected);
  });

  test('masks secret fields of urlencoded, JSON and multipart request bodies', () => {
    const form = mask({
      requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
      requestBody: 'user=tom&password=Hunter2Secret%21',
    });
    assert.equal(form.value.requestBody, `user=tom&password=${MASK}`);

    const json = mask({
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"user":"tom","profile":{"api_key":"K","pin":1234,"city":"Leeds"}}',
    });
    assert.equal(
      json.value.requestBody,
      `{"user":"tom","profile":{"api_key":"${MASK}","pin":"${MASK}","city":"Leeds"}}`
    );

    const part = (name: string, value: string): string =>
      `--b\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const multipart = mask({
      requestHeaders: { 'Content-Type': 'multipart/form-data; boundary=b' },
      requestBody: `${part('note', 'keep')}${part('password', 'P1')}--b--\r\n`,
    });
    assert.equal(
      multipart.value.requestBody,
      `${part('note', 'keep')}${part('password', MASK)}--b--\r\n`
    );
  });

  test('masks tokens of a JSON response body, also base64', () => {
    const body = '{"access_token":"A1","id_token":"I1","expires_in":3600}';
    const masked = `{"access_token":"${MASK}","id_token":"${MASK}","expires_in":3600}`;
    assert.equal(mask({ responseBody: body }).value.responseBody, masked);
    const base64 = mask({
      mimeType: 'application/octet-stream',
      responseBody: Buffer.from(body).toString('base64'),
      responseBodyBase64: true,
    });
    assert.equal(Buffer.from(base64.value.responseBody ?? '', 'base64').toString(), masked);
  });

  test('masks a JWT in a text body under any name', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const { value } = mask({ mimeType: 'text/plain', responseBody: `token is ${jwt} ok` });
    assert.equal(value.responseBody, `token is ${MASK} ok`);
  });

  test('leaves a body bdg did not keep as it is', () => {
    const body = '[SKIPPED: binary content]';
    const { value, masked } = mask({ responseBody: body });
    assert.equal(value.responseBody, body);
    assert.equal(masked, false);
  });

  test('masks tokens of WebSocket text and binary messages', () => {
    const text = '{"type":"auth","token":"W1","room":"lobby"}';
    const { value, masked } = mask({
      webSocket: {
        frames: [
          { timestamp: 1, direction: 'sent', opcode: 1, payloadData: text },
          {
            timestamp: 2,
            direction: 'received',
            opcode: 2,
            payloadData: Buffer.from(text).toString('base64'),
          },
          { timestamp: 3, direction: 'sent', opcode: 1, payloadData: 'ping' },
        ],
      },
    });
    const expected = `{"type":"auth","token":"${MASK}","room":"lobby"}`;
    assert.equal(masked, true);
    const frames = value.webSocket?.frames ?? [];
    assert.equal(frames[0]?.payloadData, expected);
    assert.equal(Buffer.from(frames[1]?.payloadData ?? '', 'base64').toString(), expected);
    assert.equal(frames[2]?.payloadData, 'ping');
  });

  test('masks Bearer and Basic credentials in plain-text WebSocket messages', () => {
    const { value, masked } = mask({
      webSocket: {
        frames: [
          { timestamp: 1, direction: 'sent', opcode: 1, payloadData: 'AUTH Bearer WB1-S615 now' },
          {
            timestamp: 2,
            direction: 'sent',
            opcode: 2,
            payloadData: Buffer.from('login Basic dXNlcjpwYXNz').toString('base64'),
          },
          {
            timestamp: 3,
            direction: 'sent',
            opcode: 1,
            payloadData: 'the basic plan, bearer of news',
          },
          {
            timestamp: 4,
            direction: 'sent',
            opcode: 1,
            payloadData: 'bearer abc123; BEARER Xy_99zz',
          },
        ],
      },
    });
    assert.equal(masked, true);
    const frames = value.webSocket?.frames ?? [];
    assert.equal(frames[0]?.payloadData, `AUTH Bearer ${MASK} now`);
    assert.equal(
      Buffer.from(frames[1]?.payloadData ?? '', 'base64').toString(),
      `login Basic ${MASK}`
    );
    assert.equal(frames[2]?.payloadData, 'the basic plan, bearer of news');
    assert.equal(frames[3]?.payloadData, `bearer ${MASK}; BEARER ${MASK}`);
  });

  test('keeps HTTP message signature metadata and masks the signature', () => {
    const { value } = mask({
      requestHeaders: {
        'Signature-Input': 'sig1=("@method")',
        'Accept-Signature': 'sig1=()',
        Signature: 'sig1=:abc:',
      },
    });
    assert.deepEqual(value.requestHeaders, {
      'Signature-Input': 'sig1=("@method")',
      'Accept-Signature': 'sig1=()',
      Signature: MASK,
    });
  });

  test('does not change the captured request', () => {
    const request: NetworkRequest = { ...PLAIN, requestHeaders: { Cookie: 'sid=LIVE42' } };
    maskNetworkRequest(request);
    assert.equal(request.requestHeaders?.['Cookie'], 'sid=LIVE42');
  });
});

void describe('maskHeaderFields', () => {
  test('masks the URL and headers and keeps the other fields', () => {
    const data = {
      url: 'https://example.com/cb?code=C1',
      requestId: '1.1',
      method: 'GET',
      requestHeaders: { Cookie: 'sid=S1', Accept: '*/*' },
      responseHeaders: { 'Set-Cookie': 'sid=S2; HttpOnly' },
    };
    const { value, masked } = maskHeaderFields(data);
    assert.equal(masked, true);
    assert.deepEqual(value, {
      url: `https://example.com/cb?code=${MASK}`,
      requestId: '1.1',
      method: 'GET',
      requestHeaders: { Cookie: `sid=${MASK}`, Accept: '*/*' },
      responseHeaders: { 'Set-Cookie': `sid=${MASK}; HttpOnly` },
    });
  });

  test('says nothing was masked when nothing was', () => {
    const data = {
      url: 'https://example.com/',
      requestHeaders: { Accept: '*/*' },
      responseHeaders: {},
    };
    assert.deepEqual(maskHeaderFields(data), { value: data, masked: false });
  });
});
