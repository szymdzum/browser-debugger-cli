/**
 * `bdg attach` without `--chrome-ws-url` finds Chrome through the
 * `DevToolsActivePort` file of its user data dir (#473): the default dir of
 * Chrome stable per platform, the file's port and browser path turned into
 * the browser WebSocket URL without any HTTP call, and 83 naming the file
 * when it is missing or garbled. Never reads the real Chrome profile.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  defaultChromeUserDataDir,
  discoverBrowser,
  expandHome,
  isWsUrlRequired,
  parseDevToolsActivePort,
} from '@/connection/devToolsActivePort.js';
import { CommandError } from '@/errors/index.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-active-port-'));

/**
 * A user data dir holding a `DevToolsActivePort` file (or none).
 *
 * @param content - File content (undefined: no file)
 * @returns The directory
 */
function profile(content: string | undefined): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'p-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), content);
  return dir;
}

/**
 * Assert a discovery failure: 83, the file named, the way out suggested.
 *
 * @param dir - User data dir
 * @param message - Expected message pattern
 */
function assertNotFound(dir: string, message: RegExp): void {
  assert.throws(
    () => discoverBrowser(dir),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, 83);
      assert.match(error.message, message);
      assert.ok(error.message.includes(path.join(dir, 'DevToolsActivePort')), error.message);
      const suggestion = String(error.metadata.suggestion);
      assert.match(suggestion, /chrome:\/\/inspect\/#remote-debugging/);
      assert.match(suggestion, /--remote-debugging-port/);
      assert.match(suggestion, /--chrome-ws-url/);
      assert.match(suggestion, /--user-data-dir/);
      return true;
    }
  );
}

void describe('defaultChromeUserDataDir', () => {
  void it('is the Chrome stable profile of each platform', () => {
    const home = '/home/me';
    assert.equal(
      defaultChromeUserDataDir({ platform: 'darwin', home: '/Users/me', env: {} }),
      '/Users/me/Library/Application Support/Google/Chrome'
    );
    assert.equal(
      defaultChromeUserDataDir({ platform: 'linux', home, env: {} }),
      '/home/me/.config/google-chrome'
    );
    assert.equal(
      defaultChromeUserDataDir({ platform: 'linux', home, env: { XDG_CONFIG_HOME: '/xdg' } }),
      '/xdg/google-chrome'
    );
    assert.equal(
      defaultChromeUserDataDir({
        platform: 'linux',
        home,
        env: { XDG_CONFIG_HOME: '/xdg', CHROME_CONFIG_HOME: '/cch' },
      }),
      '/cch/google-chrome'
    );
    assert.equal(
      defaultChromeUserDataDir({
        platform: 'win32',
        home: 'C:\\Users\\me',
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
      'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data'
    );
    assert.equal(
      defaultChromeUserDataDir({ platform: 'win32', home: 'C:\\Users\\me', env: {} }),
      'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data'
    );
  });
});

void describe('expandHome', () => {
  void it('expands a leading ~ the shell left (--user-data-dir=~/x)', () => {
    assert.equal(expandHome('~', '/home/me'), '/home/me');
    assert.equal(expandHome('~/Library/x', '/home/me'), path.join('/home/me', 'Library/x'));
    assert.equal(expandHome('/abs/~/x', '/home/me'), '/abs/~/x');
    assert.equal(expandHome('~other/x', '/home/me'), '~other/x');
  });
});

void describe('parseDevToolsActivePort', () => {
  void it('reads the port and the browser path', () => {
    assert.deepEqual(parseDevToolsActivePort('9222\n/devtools/browser/abc-123\n'), {
      port: 9222,
      path: '/devtools/browser/abc-123',
    });
    assert.deepEqual(parseDevToolsActivePort('54321\r\n/devtools/browser/x'), {
      port: 54321,
      path: '/devtools/browser/x',
    });
  });

  void it('rejects anything else', () => {
    for (const text of [
      '',
      '9222',
      '9222\n',
      'abc\n/devtools/browser/x',
      '0\n/devtools/browser/x',
      '70000\n/devtools/browser/x',
      '9222\n/devtools/page/x',
      '9222\n/devtools/browser/',
      '9222\n/devtools/browser/x y',
    ]) {
      assert.equal(parseDevToolsActivePort(text), null, JSON.stringify(text));
    }
  });
});

void describe('discoverBrowser', () => {
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  void it('builds the browser WebSocket URL from the file, without HTTP', () => {
    const dir = profile('9333\n/devtools/browser/0f1e\n');
    assert.deepEqual(discoverBrowser(dir), {
      wsUrl: 'ws://127.0.0.1:9333/devtools/browser/0f1e',
      file: path.join(dir, 'DevToolsActivePort'),
    });
  });

  void it('exits 83 without the file', () => {
    assertNotFound(profile(undefined), /No DevToolsActivePort/);
  });

  void it('exits 83 naming a garbled file', () => {
    assertNotFound(profile('not a port file'), /could not be read.*: line 1 is not a port/);
    assertNotFound(profile(''), /could not be read.*: the file is empty/);
    assertNotFound(
      profile('9222\n'),
      /could not be read.*: line 2 \(the browser path\) is missing/
    );
    assertNotFound(profile('70000\n/devtools/browser/x'), /: line 1 is not a port/);
    assertNotFound(profile('9222\n/devtools/page/x'), /: line 2 is not \/devtools\/browser\/<id>/);
  });

  void it('exits 83 naming a file that cannot be read', () => {
    const dir = profile(undefined);
    fs.mkdirSync(path.join(dir, 'DevToolsActivePort'));
    assertNotFound(dir, /could not be read/);
  });
});

void describe('isWsUrlRequired (#878)', () => {
  const required = (value: string | undefined): boolean =>
    isWsUrlRequired({ BDG_ATTACH_REQUIRE_WS_URL: value });

  void it('is off when unset, empty, 0, false, no or off (any case)', () => {
    assert.equal(isWsUrlRequired({}), false);
    for (const value of ['', ' ', '0', 'false', 'FALSE', 'no', 'off', ' Off ']) {
      assert.equal(required(value), false, JSON.stringify(value));
    }
  });

  void it('is on for 1, true and any other value', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'enabled', 'treu']) {
      assert.equal(required(value), true, value);
    }
  });
});
