/**
 * IPC Server Cleanup Unit Tests
 *
 * Tests error handling in daemon cleanup paths.
 * Verifies graceful handling of cleanup errors during shutdown.
 *
 * Following testing philosophy:
 * - Test the BEHAVIOR: "Cleanup should be defensive and not throw"
 * - Test the INVARIANT: "Stop is idempotent - multiple calls are safe"
 * - Test the PROPERTY: "Cleanup attempts all files even if some fail"
 *
 * Note: We test cleanup behavior without heavy mocking to avoid interfering
 * with the daemon's internal operations. The key behaviors we verify are:
 * 1. Stop() doesn't throw even if files are missing
 * 2. Stop() is idempotent (can be called multiple times)
 * 3. Stop() attempts cleanup in correct order
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { IPCServer } from '@/daemon/ipcServer.js';
import { getSessionFilePath } from '@/session/paths.js';

void describe('IPC Server Cleanup Behavior', () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    // Create temp directory for test session files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-cleanup-test-'));

    // Override HOME to use temp directory
    originalHome = process.env['HOME'];
    originalUserProfile = process.env['USERPROFILE'];
    process.env['HOME'] = tmpDir;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = tmpDir;
    }

    // Create .bdg directory
    const bdgDir = path.join(tmpDir, '.bdg');
    fs.mkdirSync(bdgDir, { recursive: true });
  });

  afterEach(() => {
    // Restore environment
    if (originalHome !== undefined) {
      process.env['HOME'] = originalHome;
    } else {
      delete process.env['HOME'];
    }
    if (originalUserProfile !== undefined) {
      process.env['USERPROFILE'] = originalUserProfile;
    } else {
      delete process.env['USERPROFILE'];
    }

    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  void describe('stop() idempotent behavior', () => {
    void it('completes without throwing when called before start()', async () => {
      const server = new IPCServer();

      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Stop should not throw when called before start');
    });

    void it('completes without throwing when called multiple times', async () => {
      const server = new IPCServer();

      await server.start();

      // First stop
      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'First stop should not throw');

      // Second stop (files already cleaned up)
      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Second stop should not throw (idempotent)');

      // Third stop
      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Third stop should not throw (idempotent)');
    });

    void it('removes both socket and PID files on successful cleanup', async () => {
      const server = new IPCServer();
      await server.start();

      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      assert.ok(fs.existsSync(socketPath), 'Socket file should exist after start');
      assert.ok(fs.existsSync(pidPath), 'PID file should exist after start');

      // Stop and verify cleanup
      await server.stop();

      assert.ok(!fs.existsSync(socketPath), 'Socket file should be removed after stop');
      assert.ok(!fs.existsSync(pidPath), 'PID file should be removed after stop');
    });
  });

  void describe('stop() defensive behavior with missing files', () => {
    void it('completes without throwing when socket file is already deleted', async () => {
      const server = new IPCServer();
      await server.start();

      const socketPath = getSessionFilePath('DAEMON_SOCKET');

      // Manually delete socket file before stop
      fs.unlinkSync(socketPath);

      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Stop should not throw when socket is already deleted');
    });

    void it('completes without throwing when PID file is already deleted', async () => {
      const server = new IPCServer();
      await server.start();

      const pidPath = getSessionFilePath('DAEMON_PID');

      // Manually delete PID file before stop
      fs.unlinkSync(pidPath);

      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Stop should not throw when PID file is already deleted');
    });

    void it('completes without throwing when both files are already deleted', async () => {
      const server = new IPCServer();
      await server.start();

      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      // Manually delete both files before stop
      fs.unlinkSync(socketPath);
      fs.unlinkSync(pidPath);

      await assert.doesNotReject(async () => {
        await server.stop();
      }, 'Stop should not throw when both files are already deleted');
    });
  });

  void describe('stop() attempts cleanup for all files', () => {
    void it('attempts to remove PID file even if socket is already gone', async () => {
      const server = new IPCServer();
      await server.start();

      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      // Delete socket but leave PID
      fs.unlinkSync(socketPath);

      assert.ok(fs.existsSync(pidPath), 'PID file should still exist');

      await server.stop();

      assert.ok(!fs.existsSync(pidPath), 'PID file should be removed despite socket being missing');
    });

    void it('attempts to remove socket file even if PID is already gone', async () => {
      const server = new IPCServer();
      await server.start();

      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      // Delete PID but leave socket
      fs.unlinkSync(pidPath);

      assert.ok(fs.existsSync(socketPath), 'Socket file should still exist');

      await server.stop();

      assert.ok(
        !fs.existsSync(socketPath),
        'Socket file should be removed despite PID being missing'
      );
    });
  });

  void describe('stop() cleanup with read-only directory simulation', () => {
    void it('handles cleanup gracefully when directory permissions prevent deletion', async function (this: {
      skip: () => void;
    }) {
      // Skip on Windows (chmod behavior differs)
      if (process.platform === 'win32') {
        this.skip();
        return;
      }

      const server = new IPCServer();
      await server.start();

      const bdgDir = path.join(tmpDir, '.bdg');
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      // Make directory read-only (prevents deletion)
      fs.chmodSync(bdgDir, 0o555);

      try {
        await assert.doesNotReject(async () => {
          await server.stop();
        }, 'Stop should not throw when file deletion fails due to permissions');

        // Files should still exist (couldn't be deleted)
        assert.ok(
          fs.existsSync(socketPath) || fs.existsSync(pidPath),
          'At least one file should still exist due to permission denial'
        );
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(bdgDir, 0o755);
      }
    });
  });

  void describe('Defensive error handling invariants', () => {
    void it('stop() never throws - always completes successfully', async () => {
      const server = new IPCServer();

      // Test multiple scenarios - none should throw
      const scenarios = [
        async () => {
          // Scenario 1: Stop before start
          await server.stop();
        },
        async () => {
          // Scenario 2: Start then stop
          await server.start();
          await server.stop();
        },
        async () => {
          // Scenario 3: Multiple stops
          await server.stop();
          await server.stop();
        },
      ];

      for (const scenario of scenarios) {
        await assert.doesNotReject(scenario, 'Stop should never throw in any scenario');
      }
    });
  });
});
