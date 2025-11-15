/**
 * Chrome PID cache contract tests - Test behavior, not implementation
 *
 * Focus: Persistent cache, process lifecycle, automatic cleanup
 */

import * as fs from 'fs';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { writeChromePid, readChromePid, clearChromePid } from '@/session/chrome.js';

describe('Chrome PID Cache Contract', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-chrome-test-'));
    process.env['BDG_SESSION_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('writes and reads Chrome PID', () => {
    const testPid = process.pid;
    writeChromePid(testPid);

    const readPid = readChromePid();
    assert.strictEqual(readPid, testPid, 'Should read what was written');
  });

  it('returns null for non-existent cache', () => {
    const pid = readChromePid();
    assert.strictEqual(pid, null, 'Should return null when cache does not exist');
  });

  it('returns null for dead process', () => {
    const deadPid = 99999999;
    writeChromePid(deadPid);

    const pid = readChromePid();
    assert.strictEqual(pid, null, 'Should return null for dead process');
  });

  it('auto-cleans stale PID on read', () => {
    const cachePath = path.join(testDir, 'chrome.pid');
    writeChromePid(99999999);

    readChromePid();

    assert.strictEqual(fs.existsSync(cachePath), false, 'Should remove stale cache');
  });

  it('handles corrupt PID file', () => {
    const cachePath = path.join(testDir, 'chrome.pid');
    fs.writeFileSync(cachePath, 'not-a-number');

    const pid = readChromePid();
    assert.strictEqual(pid, null, 'Should return null for corrupt file');
    assert.strictEqual(fs.existsSync(cachePath), false, 'Should remove corrupt cache');
  });

  it('clearChromePid removes cache', () => {
    const cachePath = path.join(testDir, 'chrome.pid');
    writeChromePid(process.pid);

    clearChromePid();

    assert.strictEqual(fs.existsSync(cachePath), false, 'Should remove cache file');
  });

  it('clearChromePid is idempotent', () => {
    writeChromePid(process.pid);

    clearChromePid();
    clearChromePid();
    clearChromePid();

    const pid = readChromePid();
    assert.strictEqual(pid, null, 'Multiple clears should not error');
  });

  it('survives concurrent reads', () => {
    writeChromePid(process.pid);

    const pid1 = readChromePid();
    const pid2 = readChromePid();
    const pid3 = readChromePid();

    assert.strictEqual(pid1, process.pid);
    assert.strictEqual(pid2, process.pid);
    assert.strictEqual(pid3, process.pid);
  });
});
