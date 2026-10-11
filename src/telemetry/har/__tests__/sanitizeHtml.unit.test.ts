/**
 * Form-control values in HTML bodies (#634): the default HAR and
 * `details network --body` mask the `value` of secret-named, hidden and
 * password inputs and the text of a secret-named textarea, keep every other
 * value and inline scripts, and `--include-sensitive` keeps everything; the
 * same text under a non-HTML type is left alone.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HTML_SECRET_ROWS } from '@/__testutils__/fixturePages/htmlSecretFixtures.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import { redactHtmlFields } from '@/telemetry/har/sanitizeBody.js';
import { maskNetworkRequest } from '@/telemetry/networkMasking.js';
import type { NetworkRequest } from '@/types.js';

const REDACTED = '[redacted]';
const MASK = '••••';

/**
 * A document request answered with the given HTML.
 *
 * @param body - Response body
 * @param mimeType - Content-Type of the response (default `text/html`)
 * @returns Captured request
 */
function documentRequest(body: string, mimeType = 'text/html'): NetworkRequest {
  return {
    requestId: 'doc',
    url: 'https://example.com/',
    method: 'GET',
    timestamp: 1,
    status: 200,
    mimeType,
    requestHeaders: {},
    responseHeaders: { 'Content-Type': mimeType },
    responseBody: body,
  };
}

/**
 * The response body of the request as the HAR holds it.
 *
 * @param request - Captured request
 * @param includeSensitive - Keep credentials
 * @returns `content.text`
 */
function harBody(request: NetworkRequest, includeSensitive = false): string | undefined {
  return buildHAR([request], { version: '0.0.0-test' }, { includeSensitive }).log.entries[0]
    ?.response.content.text;
}

/**
 * The HTML of a row as a page.
 *
 * @param html - Row HTML
 * @returns A document
 */
function page(html: string): string {
  return `<!doctype html><title>t</title>\n<form>\n${html}\n</form>`;
}

/**
 * What a row's page looks like with its value replaced, when it is masked.
 *
 * @param row - Matrix row
 * @param placeholder - Text written instead
 * @returns Expected text
 */
function expected(row: (typeof HTML_SECRET_ROWS)[number], placeholder: string): string {
  return row.kept ? page(row.html) : page(row.html).replace(row.secret, placeholder);
}

void describe('HTML bodies: redactHtmlFields', () => {
  for (const row of HTML_SECRET_ROWS) {
    test(`${row.kept ? 'keeps' : 'masks'} ${row.name}`, () => {
      assert.equal(redactHtmlFields(page(row.html), REDACTED), expected(row, REDACTED));
      assert.equal(redactHtmlFields(page(row.html), MASK), expected(row, MASK));
    });
  }

  test('keeps an empty value and a value-less input', () => {
    const html = page(
      '<input name="pin" value=""><input name="pw"><input type="hidden" name="csrf">'
    );
    assert.equal(redactHtmlFields(html, REDACTED), html);
  });

  test('keeps an empty secret textarea', () => {
    const html = page('<textarea name="secret"></textarea>');
    assert.equal(redactHtmlFields(html, REDACTED), html);
  });

  test('masks every secret control of a page and nothing else', () => {
    const html = page(HTML_SECRET_ROWS.map((row) => row.html).join('\n'));
    let want = html;
    for (const row of HTML_SECRET_ROWS) if (!row.kept) want = want.replace(row.secret, REDACTED);
    assert.equal(redactHtmlFields(html, REDACTED), want);
  });

  test('keeps a tag broken by an unclosed quote or a < and judges the next one', () => {
    const html = page(
      '<input name="token" value="BROKEN-H634 <input name="token" value="NEXT-H634">'
    );
    assert.equal(
      redactHtmlFields(html, REDACTED),
      page(`<input name="token" value="BROKEN-H634 <input name="token" value="${REDACTED}">`)
    );
    const unclosed = page(`<input name="token" value='OPEN-H634 <input name=pw value=X-H634>`);
    assert.equal(
      redactHtmlFields(unclosed, REDACTED),
      page(`<input name="token" value='OPEN-H634 <input name=pw value=${REDACTED}>`)
    );
  });

  for (const [name, piece] of [
    ['tag starts', '<input '],
    ['unclosed quotes', '<input a="'],
    ['textarea starts', '<textarea>'],
    ['unclosed textareas', '<textarea name=pw>x'],
  ] as const) {
    test(`redacts 1 MB of ${name} in one pass`, () => {
      const body = piece.repeat(Math.ceil((1024 * 1024) / piece.length));
      const started = performance.now();
      assert.equal(redactHtmlFields(body, REDACTED), body);
      assert.ok(performance.now() - started < 2000, `${name} took over 2 s`);
    });
  }

  test('also redacts a JWT in the HTML', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const html = page(`<p>${jwt}</p><input name="q" value="${jwt}">`);
    assert.equal(
      harBody(documentRequest(html)),
      page(`<p>${REDACTED}</p><input name="q" value="${REDACTED}">`)
    );
  });
});

void describe('HTML bodies: default HAR', () => {
  for (const row of HTML_SECRET_ROWS) {
    test(`${row.kept ? 'keeps' : 'redacts'} ${row.name}`, () => {
      assert.equal(harBody(documentRequest(page(row.html))), expected(row, REDACTED));
    });
  }

  test('redacts an application/xhtml+xml body and one with a charset parameter', () => {
    const html = page('<input name="token" value="X-H634"/>');
    const want = page(`<input name="token" value="${REDACTED}"/>`);
    assert.equal(harBody(documentRequest(html, 'application/xhtml+xml')), want);
    assert.equal(harBody(documentRequest(html, 'text/html; charset=utf-8')), want);
  });
});

void describe('HTML bodies: HAR with --include-sensitive', () => {
  for (const row of HTML_SECRET_ROWS) {
    test(`keeps ${row.name}`, () => {
      assert.equal(harBody(documentRequest(page(row.html)), true), page(row.html));
    });
  }
});

void describe('HTML bodies: details network --body', () => {
  for (const row of HTML_SECRET_ROWS) {
    test(`${row.kept ? 'keeps' : 'masks'} ${row.name}`, () => {
      const { value, masked } = maskNetworkRequest(documentRequest(page(row.html)));
      assert.equal(value.responseBody, expected(row, MASK));
      assert.equal(masked, row.kept !== true);
    });
  }
});

void describe('HTML bodies: the same text under a non-HTML type', () => {
  for (const row of HTML_SECRET_ROWS) {
    test(`keeps ${row.name} as text/plain`, () => {
      const request = documentRequest(page(row.html), 'text/plain');
      assert.equal(harBody(request), page(row.html));
      assert.equal(maskNetworkRequest(request).value.responseBody, page(row.html));
    });
  }
});
