/**
 * Cleanup contract tests - Test behavior, not implementation
 *
 * Focus: Stale session detection, idempotency, resource cleanup
 */

import * as fs from 'fs';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { cleanupStaleSession, cleanupSession, cleanupStaleDaemonPid } from '@/session/cleanup.js';
import { acquireSessionLock, releaseSessionLock } from '@/session/lock.js';

describe('Cleanup Contract', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-cleanup-test-'));
    process.env['BDG_SESSION_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('cleans up when no active session exists', () => {
    const pidPath = path.join(testDir, 'session.pid');
    const metaPath = path.join(testDir, 'session.meta.json');

    fs.writeFileSync(pidPath, '99999999');
    fs.writeFileSync(metaPath, '{}');

    const cleaned = cleanupStaleSession();

    assert.strictEqual(cleaned, true, 'Should clean up stale session');
    assert.strictEqual(fs.existsSync(pidPath), false, 'PID file should be removed');
    assert.strictEqual(fs.existsSync(metaPath), false, 'Metadata file should be removed');
  });

  it('skips cleanup when lock is held', () => {
    acquireSessionLock();

    const cleaned = cleanupStaleSession();

    assert.strictEqual(cleaned, false, 'Should not clean up when lock is held');

    releaseSessionLock();
  });

  it('is idempotent', () => {
    const pidPath = path.join(testDir, 'session.pid');
    fs.writeFileSync(pidPath, '99999999');

    cleanupStaleSession();
    cleanupStaleSession();
    cleanupStaleSession();

    assert.strictEqual(fs.existsSync(pidPath), false, 'Multiple cleanups should not error');
  });

  it('handles missing files gracefully', () => {
    const cleaned = cleanupStaleSession();
    assert.strictEqual(cleaned, true, 'Should handle empty session dir');
  });

  it('removes stale daemon files', () => {
    const daemonPidPath = path.join(testDir, 'daemon.pid');
    const daemonSocketPath = path.join(testDir, 'daemon.sock');
    const daemonLockPath = path.join(testDir, 'daemon.lock');

    fs.writeFileSync(daemonPidPath, '99999999');
    fs.writeFileSync(daemonSocketPath, '');
    fs.writeFileSync(daemonLockPath, '99999999');

    const cleaned = cleanupStaleDaemonPid();

    assert.strictEqual(cleaned, true, 'Should clean up stale daemon');
    assert.strictEqual(fs.existsSync(daemonPidPath), false, 'Daemon PID should be removed');
    assert.strictEqual(fs.existsSync(daemonSocketPath), false, 'Daemon socket should be removed');
    assert.strictEqual(fs.existsSync(daemonLockPath), false, 'Daemon lock should be removed');
  });

  it('preserves running daemon', () => {
    const daemonPidPath = path.join(testDir, 'daemon.pid');
    fs.writeFileSync(daemonPidPath, process.pid.toString());

    const cleaned = cleanupStaleDaemonPid();

    assert.strictEqual(cleaned, false, 'Should not clean up running daemon');
    assert.strictEqual(fs.existsSync(daemonPidPath), true, 'Daemon PID should still exist');
  });

  it('cleanupSession removes session files', () => {
    const metaPath = path.join(testDir, 'session.meta.json');
    fs.writeFileSync(metaPath, '{}');
    acquireSessionLock();

    cleanupSession();

    assert.strictEqual(fs.existsSync(metaPath), false, 'Metadata should be removed');
    const lockAcquired = acquireSessionLock();
    assert.strictEqual(lockAcquired, true, 'Lock should be released');
    releaseSessionLock();
  });
});
