/**
 * Lock contract tests - Test behavior, not implementation
 *
 * Focus: Concurrency control, stale lock detection, race conditions
 */

import * as fs from 'fs';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import {
  acquireSessionLock,
  releaseSessionLock,
  acquireDaemonLock,
  releaseDaemonLock,
} from '@/session/lock.js';

describe('Session Lock Contract', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-lock-test-'));
    process.env['BDG_SESSION_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('prevents concurrent session locks', () => {
    const first = acquireSessionLock();
    const second = acquireSessionLock();

    assert.strictEqual(first, true, 'First lock should succeed');
    assert.strictEqual(second, false, 'Second lock should fail');

    releaseSessionLock();
  });

  it('allows reacquisition after release', () => {
    acquireSessionLock();
    releaseSessionLock();

    const reacquired = acquireSessionLock();
    assert.strictEqual(reacquired, true, 'Should reacquire after release');

    releaseSessionLock();
  });

  it('removes stale lock from dead process', () => {
    const lockPath = path.join(testDir, 'session.lock');
    fs.writeFileSync(lockPath, '99999999');

    const acquired = acquireSessionLock();
    assert.strictEqual(acquired, true, 'Should acquire after removing stale lock');

    releaseSessionLock();
  });

  it('handles corrupt lock file', () => {
    const lockPath = path.join(testDir, 'session.lock');
    fs.writeFileSync(lockPath, 'not-a-number');

    const acquired = acquireSessionLock();
    assert.strictEqual(acquired, true, 'Should acquire after removing corrupt lock');

    releaseSessionLock();
  });

  it('prevents concurrent daemon locks', () => {
    const first = acquireDaemonLock();
    const second = acquireDaemonLock();

    assert.strictEqual(first, true, 'First daemon lock should succeed');
    assert.strictEqual(second, false, 'Second daemon lock should fail');

    releaseDaemonLock();
  });

  it('session and daemon locks are independent', () => {
    const sessionLock = acquireSessionLock();
    const daemonLock = acquireDaemonLock();

    assert.strictEqual(sessionLock, true, 'Session lock should succeed');
    assert.strictEqual(daemonLock, true, 'Daemon lock should succeed');

    releaseSessionLock();
    releaseDaemonLock();
  });

  it('is idempotent on release', () => {
    acquireSessionLock();
    releaseSessionLock();
    releaseSessionLock();
    releaseSessionLock();

    const acquired = acquireSessionLock();
    assert.strictEqual(acquired, true, 'Multiple releases should not break lock');

    releaseSessionLock();
  });
});
