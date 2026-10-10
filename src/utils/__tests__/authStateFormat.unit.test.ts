/**
 * The state file format (#454): what `bdg state save` writes and what
 * `bdg state load` / `bdg <url> --state` accept. Invalid files exit 81 with
 * a suggestion and never echo a value from the file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError } from '@/errors/index.js';
import { cookieParam } from '@/runtime/page/authState.js';
import {
  buildStateFile,
  httpOrigin,
  parseStateFile,
  summarizeState,
} from '@/utils/authStateFormat.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** A value that must never appear in an error */
const SECRET = 'SECRET-VALUE-123';

/** A session cookie as Network.getAllCookies reports it */
const SESSION_COOKIE = {
  name: 'sid',
  value: SECRET,
  domain: '127.0.0.1',
  path: '/',
  expires: -1,
  size: 6,
  httpOnly: true,
  secure: false,
  session: true,
  priority: 'Medium',
  sourceScheme: 'NonSecure',
  sourcePort: 47111,
};

/**
 * A state file's text.
 *
 * @param fields - Fields replacing the defaults
 * @returns JSON text
 */
function fileText(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    savedAt: '2026-10-10T00:00:00.000Z',
    cookies: [SESSION_COOKIE],
    origins: [
      {
        origin: 'http://127.0.0.1:47111',
        localStorage: { token: SECRET },
        sessionStorage: { tab: SECRET },
      },
    ],
    ...fields,
  });
}

/**
 * Assert that parsing fails with exit 81, a suggestion, and no value.
 *
 * @param text - File text
 * @param message - Pattern the message must match
 */
function assertInvalid(text: string, message: RegExp): void {
  assert.throws(
    () => parseStateFile(text, 's.json'),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
      assert.match(error.message, message);
      assert.match(error.message, /s\.json/);
      assert.ok(error.metadata.suggestion, 'has a suggestion');
      assert.ok(!error.message.includes(SECRET), 'no value in the message');
      assert.ok(!String(error.metadata.suggestion).includes(SECRET), 'no value in the suggestion');
      return true;
    }
  );
}

void describe('state file format', () => {
  it('round-trips what save writes', () => {
    const content = parseStateFile(fileText(), 's.json');
    const file = buildStateFile(content, new Date('2026-10-10T12:00:00Z'));
    assert.equal(file.version, 1);
    assert.equal(file.savedAt, '2026-10-10T12:00:00.000Z');
    assert.deepEqual(parseStateFile(JSON.stringify(file), 's.json'), content);
    assert.equal(content.cookies[0]?.value, SECRET);
    assert.deepEqual(content.origins[0]?.localStorage, { token: SECRET });
  });

  it('defaults missing storage maps and origins to empty', () => {
    const content = parseStateFile(
      JSON.stringify({ version: 1, cookies: [], origins: [{ origin: 'https://a.example' }] }),
      's.json'
    );
    assert.deepEqual(content.origins, [
      { origin: 'https://a.example', localStorage: {}, sessionStorage: {} },
    ]);
    assert.deepEqual(parseStateFile('{"version":1,"cookies":[]}', 's.json').origins, []);
  });

  it('keeps a key named __proto__ as an item', () => {
    const text = fileText({
      origins: [
        { origin: 'https://a.example', localStorage: JSON.parse('{"__proto__":"x"}') as unknown },
      ],
    });
    const items = parseStateFile(text, 's.json').origins[0]?.localStorage ?? {};
    assert.deepEqual(Object.entries(items), [['__proto__', 'x']]);
  });

  it('rejects text that is not JSON without quoting it', () => {
    assertInvalid(`{"cookies": [${SECRET}`, /not valid JSON/);
  });

  it('rejects JSON that is not a state file', () => {
    assertInvalid('[]', /not a JSON object/);
    assertInvalid('{"cookies":[]}', /no version/);
    assertInvalid(fileText({ version: SECRET }), /version must be the number 1/);
  });

  it('suggests saving in a session where you are logged in, not the selected one', () => {
    const previous = process.env['BDG_SESSION'];
    process.env['BDG_SESSION'] = 'n2';
    try {
      for (const text of ['{', fileText({ version: 2 })]) {
        assert.throws(
          () => parseStateFile(text, 's.json'),
          (error: unknown) => {
            assert.ok(error instanceof CommandError);
            const suggestion = String(error.metadata.suggestion);
            assert.ok(!suggestion.includes('--session'), suggestion);
            assert.match(suggestion, /bdg state save <file> in a session where you are logged in/);
            return true;
          }
        );
      }
    } finally {
      if (previous === undefined) delete process.env['BDG_SESSION'];
      else process.env['BDG_SESSION'] = previous;
    }
  });

  it('rejects another version, naming the one it reads', () => {
    assertInvalid(
      fileText({ version: 2 }),
      /version 2 is not supported \(this bdg reads version 1\)/
    );
  });

  it('names the bad cookie and field', () => {
    assertInvalid(fileText({ cookies: 'x' }), /cookies must be an array/);
    assertInvalid(fileText({ cookies: [SESSION_COOKIE, { name: 'a' }] }), /cookies\[1\]: value/);
    assertInvalid(
      fileText({ cookies: [{ ...SESSION_COOKIE, httpOnly: 'yes' }] }),
      /cookies\[0\]: httpOnly must be true or false/
    );
    assertInvalid(
      fileText({ cookies: [{ ...SESSION_COOKIE, sameSite: SECRET }] }),
      /cookies\[0\]: sameSite must be one of Strict, Lax, None/
    );
    assertInvalid(
      fileText({ cookies: [{ ...SESSION_COOKIE, expires: '1' }] }),
      /expires must be a number/
    );
  });

  it('names the bad origin and field', () => {
    assertInvalid(fileText({ origins: {} }), /origins must be an array/);
    assertInvalid(
      fileText({ origins: [{ origin: 'file:///etc' }] }),
      /origins\[0\]: origin must be an http\(s\) origin/
    );
    assertInvalid(
      fileText({ origins: [{ origin: 'https://a.example/path' }] }),
      /origins\[0\]: origin must be/
    );
    assertInvalid(
      fileText({ origins: [{ origin: 'https://a.example', localStorage: { k: 1 } }] }),
      /origins\[0\]: localStorage must be an object of string values/
    );
    assertInvalid(
      fileText({ origins: [{ origin: 'https://a.example', sessionStorage: [SECRET] }] }),
      /origins\[0\]: sessionStorage must be/
    );
  });

  it('summarizes counts only', () => {
    const summary = summarizeState(parseStateFile(fileText(), 's.json'), [
      { origin: 'http://localhost:1', reason: 'partitioned' },
    ]);
    assert.deepEqual(summary, {
      cookies: 1,
      origins: [{ origin: 'http://127.0.0.1:47111', localStorage: 1, sessionStorage: 1 }],
      skipped: [{ origin: 'http://localhost:1', reason: 'partitioned' }],
    });
    assert.ok(!JSON.stringify(summary).includes(SECRET));
  });

  it('reads the origin of http(s) URLs only', () => {
    assert.equal(httpOrigin('https://app.example.com/login?x=1'), 'https://app.example.com');
    assert.equal(httpOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.equal(httpOrigin('about:blank'), undefined);
    assert.equal(httpOrigin('example.com'), undefined);
  });
});

void describe('cookieParam', () => {
  it('keeps a session cookie a session cookie (no expiry)', () => {
    const param = cookieParam(SESSION_COOKIE);
    assert.equal('expires' in param, false);
    assert.equal(param.httpOnly, true);
    assert.equal(param.sourcePort, 47111);
    assert.equal(param.domain, '127.0.0.1');
    assert.equal('size' in param, false);
    assert.equal('session' in param, false);
  });

  it('keeps the expiry of a persistent cookie', () => {
    const param = cookieParam({ ...SESSION_COOKIE, session: false, expires: 2000000000 });
    assert.equal(param.expires, 2000000000);
  });

  it('passes a partition key object only', () => {
    const key = { topLevelSite: 'https://a.example', hasCrossSiteAncestor: false };
    assert.deepEqual(cookieParam({ ...SESSION_COOKIE, partitionKey: key }).partitionKey, key);
    assert.equal(
      'partitionKey' in cookieParam({ ...SESSION_COOKIE, partitionKey: 'https://a.example' }),
      false
    );
  });
});
