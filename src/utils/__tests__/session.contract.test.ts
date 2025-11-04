import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { mockProcessAlive, restoreProcessAlive } from '@/__testutils__/testProcess.js';
import {
  acquireSessionLock,
  cleanupStaleSession,
  getSessionFilePath,
  isProcessAlive,
  readPid,
  releaseSessionLock,
  writePid,
  writeSessionMetadata,
  getPartialFilePath,
  getFullFilePath,
} from '@/utils/session.js';

/**
 * Session Utilities Contract Tests
 *
 * Week 1 Note: Using real temp directories instead of FakeFileSystem
 * because mocking built-in Node modules is complex. This still validates
 * the contracts while keeping tests simple and fast.
 */
void describe('Session Utilities Contract Tests', () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalProcessPid: number;

  beforeEach(() => {
    // Create temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-test-'));

    // Mock process.pid for predictable tests
    originalProcessPid = process.pid;
    Object.defineProperty(process, 'pid', {
      value: 12345,
      writable: true,
      configurable: true,
    });

    // Override HOME environment variable to point to temp directory
    // os.homedir() uses this on Unix systems
    originalHome = process.env['HOME'];
    originalUserProfile = process.env['USERPROFILE'];
    process.env['HOME'] = tmpDir;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = tmpDir;
    }
  });

  afterEach(() => {
    // Restore process.pid
    Object.defineProperty(process, 'pid', {
      value: originalProcessPid,
      writable: true,
      configurable: true,
    });

    // Restore process.kill mock
    restoreProcessAlive();

    // Restore HOME environment variable
    process.env['HOME'] = originalHome;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = originalUserProfile;
    }

    // ⚠️ CRITICAL: Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  void describe('PID Management', () => {
    void it('should write PID to file with correct content', () => {
      writePid(12345);

      const pidPath = getSessionFilePath('PID');
      const content = fs.readFileSync(pidPath, 'utf-8');
      assert.equal(content, '12345');
    });

    void it('should read PID from existing file', () => {
      writePid(67890);

      const pid = readPid();
      assert.equal(pid, 67890);
    });

    void it('should return null when PID file does not exist', () => {
      const pid = readPid();
      assert.equal(pid, null);
    });
  });

  void describe('Lock Management', () => {
    void it('should create lock file with current process PID', () => {
      const acquired = acquireSessionLock();

      assert.equal(acquired, true);
      const lockPath = getSessionFilePath('LOCK');
      const content = fs.readFileSync(lockPath, 'utf-8');
      assert.equal(content, '12345'); // process.pid from beforeEach
    });

    void it('should return false if lock is held by alive process', () => {
      // Setup: Create lock file held by alive process
      const lockPath = getSessionFilePath('LOCK');
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(lockPath, '99999');

      // Mock process 99999 as alive
      mockProcessAlive([99999]);

      // Act
      const acquired = acquireSessionLock();

      // Assert
      assert.equal(acquired, false);
    });

    void it('should remove stale lock and acquire if holder PID is dead', () => {
      // Setup: Create lock file held by dead process
      const lockPath = getSessionFilePath('LOCK');
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(lockPath, '88888');

      // Mock process 88888 as dead (not in alive list)
      mockProcessAlive([]);

      // Act
      const acquired = acquireSessionLock();

      // Assert
      assert.equal(acquired, true, 'Should acquire lock after removing stale one');
      const newContent = fs.readFileSync(lockPath, 'utf-8');
      assert.equal(newContent, '12345', 'Should write current PID');
    });

    void it('should remove lock file when released', () => {
      // Setup: Acquire lock first
      acquireSessionLock();
      const lockPath = getSessionFilePath('LOCK');
      assert.equal(fs.existsSync(lockPath), true, 'Lock file should exist');

      // Act
      releaseSessionLock();

      // Assert
      assert.equal(fs.existsSync(lockPath), false, 'Lock file should be removed');
    });

    void it('should handle concurrent acquisition via exclusive create flag', () => {
      // Setup: Acquire lock first
      acquireSessionLock();

      // Mock current process as alive
      mockProcessAlive([12345]);

      // Act: Try to acquire again from same process (simulates race condition)
      const secondAttempt = acquireSessionLock();

      // Assert: Should fail because file exists and process is alive
      assert.equal(secondAttempt, false, 'Should not acquire lock twice');
    });
  });

  void describe('Process Alive Checks', () => {
    void it('should return true for alive process', () => {
      mockProcessAlive([12345, 67890]);

      assert.equal(isProcessAlive(12345), true);
      assert.equal(isProcessAlive(67890), true);
    });

    void it('should return false for dead process', () => {
      mockProcessAlive([12345]);

      assert.equal(isProcessAlive(99999), false);
    });
  });

  void describe('Stale Session Cleanup', () => {
    void it('should remove stale session files when process is dead', () => {
      // Setup: Create stale session files
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });

      writePid(88888);
      writeSessionMetadata({
        bdgPid: 88888,
        chromePid: 77777,
        startTime: Date.now(),
        port: 9222,
      });
      fs.writeFileSync(getSessionFilePath('DAEMON_PID'), '66666');
      fs.writeFileSync(getSessionFilePath('DAEMON_SOCKET'), '');
      fs.writeFileSync(getPartialFilePath(), JSON.stringify({ test: 'preview' }));
      fs.writeFileSync(getFullFilePath(), JSON.stringify({ test: 'full' }));

      // Mock all processes as dead
      mockProcessAlive([]);

      // Act
      const cleaned = cleanupStaleSession();

      // Assert
      assert.equal(cleaned, true, 'Should return true when cleanup was performed');
      assert.equal(fs.existsSync(getSessionFilePath('PID')), false, 'PID file should be removed');
      assert.equal(
        fs.existsSync(getSessionFilePath('DAEMON_PID')),
        false,
        'Daemon PID should be removed'
      );
      assert.equal(
        fs.existsSync(getSessionFilePath('DAEMON_SOCKET')),
        false,
        'Daemon socket should be removed'
      );
      assert.equal(fs.existsSync(getPartialFilePath()), false, 'Preview file should be removed');
      assert.equal(fs.existsSync(getFullFilePath()), false, 'Full file should be removed');
    });

    void it('should not remove files when session process is alive', () => {
      // Setup: Create session files with alive process
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });

      writePid(88888);
      writeSessionMetadata({
        bdgPid: 88888,
        chromePid: 77777,
        startTime: Date.now(),
        port: 9222,
      });

      // Mock process 88888 as alive
      mockProcessAlive([88888]);

      // Act
      const cleaned = cleanupStaleSession();

      // Assert
      assert.equal(cleaned, false, 'Should return false when session is active');
      assert.equal(fs.existsSync(getSessionFilePath('PID')), true, 'PID file should still exist');
    });

    void it('should not remove files when daemon process is alive', () => {
      // Setup: Create session files with dead session but alive daemon
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });

      writePid(88888);
      fs.writeFileSync(getSessionFilePath('DAEMON_PID'), '66666');

      // Mock only daemon as alive (session process is dead)
      mockProcessAlive([66666]);

      // Act
      const cleaned = cleanupStaleSession();

      // Assert
      assert.equal(cleaned, false, 'Should return false when daemon is still alive');
      assert.equal(fs.existsSync(getSessionFilePath('PID')), true, 'PID file should still exist');
      assert.equal(
        fs.existsSync(getSessionFilePath('DAEMON_PID')),
        true,
        'Daemon PID should still exist'
      );
    });

    void it('should cleanup daemon artifacts when daemon process is dead', () => {
      // Setup: Create daemon files with dead process
      const sessionDir = path.join(tmpDir, '.bdg');
      fs.mkdirSync(sessionDir, { recursive: true });

      fs.writeFileSync(getSessionFilePath('DAEMON_PID'), '66666');
      fs.writeFileSync(getSessionFilePath('DAEMON_SOCKET'), '');

      // Mock process as dead
      mockProcessAlive([]);

      // Act
      const cleaned = cleanupStaleSession();

      // Assert
      assert.equal(cleaned, true, 'Should cleanup when daemon is dead');
      assert.equal(
        fs.existsSync(getSessionFilePath('DAEMON_PID')),
        false,
        'Daemon PID should be removed'
      );
      assert.equal(
        fs.existsSync(getSessionFilePath('DAEMON_SOCKET')),
        false,
        'Daemon socket should be removed'
      );
    });

    void it('should handle missing files gracefully', () => {
      // Setup: No files exist
      mockProcessAlive([]);

      // Act - should not throw
      const cleaned = cleanupStaleSession();

      // Assert
      assert.equal(cleaned, true, 'Should succeed even with no files');
    });
  });
});
