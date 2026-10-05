/**
 * Profile preferences: dotted names become nested paths, merged into an
 * existing profile's Preferences file without losing what Chrome stored.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  mergePreferences,
  profileInUse,
  writeProfilePreferences,
} from '@/connection/launcher/profilePreferences.js';
import { resolveChromePrefs } from '@/connection/launcher.js';
import type { Logger } from '@/connection/types.js';
import { BDG_CHROME_PREFS } from '@/constants.js';

const silentLogger: Logger = { info: () => {}, debug: () => {} };

/**
 * Logger recording info messages.
 *
 * @returns Logger and its messages
 */
function recordingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  return { logger: { info: (message) => messages.push(message), debug: () => {} }, messages };
}

void describe('resolveChromePrefs', () => {
  void it('uses bdg defaults for profiles bdg manages', () => {
    const prefs = resolveChromePrefs({});
    assert.equal(prefs['profile.password_manager_leak_detection'], false);
    assert.equal(prefs['credentials_enable_service'], false);
  });

  void it('leaves a user-chosen profile alone unless the caller passes preferences', () => {
    assert.deepEqual(resolveChromePrefs({ userDataDir: '/tmp/mine' }), {});
    assert.deepEqual(resolveChromePrefs({ userDataDir: '/tmp/mine', prefs: { a: 1 } }), { a: 1 });
  });
});

void describe('mergePreferences', () => {
  void it('expands dotted names into nested paths and keeps sibling values', () => {
    const merged = mergePreferences(
      { profile: { name: 'Person 1', exit_type: 'Crashed' } },
      { 'profile.exit_type': 'Normal', 'profile.password_manager_enabled': false }
    );
    assert.deepEqual(merged, {
      profile: { name: 'Person 1', exit_type: 'Normal', password_manager_enabled: false },
    });
  });

  void it('removes literal dotted keys left by earlier versions', () => {
    const merged = mergePreferences(
      { 'translate.enabled': false, translate: { enabled: true } },
      { 'translate.enabled': false }
    );
    assert.deepEqual(merged, { translate: { enabled: false } });
  });

  void it('merges nested objects and replaces non-object values', () => {
    const merged = mergePreferences(
      { profile: { content_settings: { a: 1 } }, list: [1] },
      { profile: { content_settings: { b: 2 } }, list: ['*'] }
    );
    assert.deepEqual(merged, { profile: { content_settings: { a: 1, b: 2 } }, list: ['*'] });
  });

  void it('does not modify the existing object', () => {
    const existing = { profile: { name: 'Person 1' } };
    mergePreferences(existing, { 'profile.exit_type': 'Normal' });
    assert.deepEqual(existing, { profile: { name: 'Person 1' } });
  });
});

void describe('writeProfilePreferences', () => {
  let userDataDir: string;
  let prefsFile: string;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-prefs-'));
    prefsFile = path.join(userDataDir, 'Default', 'Preferences');
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  /**
   * Parsed Preferences file.
   *
   * @returns File content
   */
  function readPrefs(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(prefsFile, 'utf8')) as Record<string, unknown>;
  }

  void it('turns off the password manager and leak check in a new profile', () => {
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, silentLogger);
    const prefs = readPrefs();
    assert.equal(prefs['credentials_enable_service'], false);
    assert.deepEqual(prefs['profile'], {
      exit_type: 'Normal',
      password_manager_enabled: false,
      password_manager_leak_detection: false,
    });
  });

  void it('applies them to an existing profile, keeping its other preferences', () => {
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    fs.writeFileSync(
      prefsFile,
      JSON.stringify({
        'profile.exit_type': 'Normal',
        profile: { exit_type: 'Crashed', password_manager_leak_detection: true, name: 'Person 1' },
        session: { restore_on_startup: 1 },
      })
    );
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, silentLogger);
    const prefs = readPrefs();
    assert.equal(prefs['profile.exit_type'], undefined);
    assert.deepEqual(prefs['session'], { restore_on_startup: 1 });
    assert.deepEqual(prefs['profile'], {
      exit_type: 'Normal',
      password_manager_leak_detection: false,
      name: 'Person 1',
      password_manager_enabled: false,
    });
  });

  void it('leaves an unreadable Preferences file alone and says so', () => {
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    fs.writeFileSync(prefsFile, '{not json');
    const { logger, messages } = recordingLogger();
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, logger);
    assert.equal(fs.readFileSync(prefsFile, 'utf8'), '{not json');
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? '', /not applied/);
  });

  void it('replaces the file without leaving a temporary file behind', () => {
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, silentLogger);
    assert.deepEqual(fs.readdirSync(path.dirname(prefsFile)), ['Preferences']);
  });

  void it('does not rewrite the file when nothing changes', () => {
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, silentLogger);
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(prefsFile, past, past);
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, silentLogger);
    assert.equal(fs.statSync(prefsFile).mtimeMs, past.getTime());
  });

  void it('skips a profile that a running Chrome has open', () => {
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(userDataDir, 'SingletonLock'));
    const { logger, messages } = recordingLogger();
    writeProfilePreferences(userDataDir, BDG_CHROME_PREFS, logger);
    assert.equal(fs.existsSync(prefsFile), false);
    assert.match(messages[0] ?? '', /in use/);
  });
});

void describe('profileInUse', () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-lock-'));
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  void it('is false without a lock, or when the lock names a dead process or another host', () => {
    assert.equal(profileInUse(userDataDir), false);
    const lock = path.join(userDataDir, 'SingletonLock');
    fs.symlinkSync(`${os.hostname()}-999999999`, lock);
    assert.equal(profileInUse(userDataDir), false);
    fs.rmSync(lock);
    fs.symlinkSync(`other-host-${process.pid}`, lock);
    assert.equal(profileInUse(userDataDir), false);
  });
});
