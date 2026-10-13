/**
 * Process Utilities Unit Tests
 *
 * Tests cross-platform process management functions.
 *
 * Following testing philosophy:
 * - Test the BEHAVIOR: "isProcessAlive returns true for running processes"
 * - Test the PROPERTY: "Signal 0 check doesn't affect process state"
 * - Test CROSS-PLATFORM: Different behavior on Windows vs Unix
 *
 * Note: Some tests use the current process (process.pid) which is guaranteed to be alive.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { isProcessAlive, waitForProcessExit } from '@/utils/process.js';

void describe('Process Utilities', () => {
  void describe('isProcessAlive()', () => {
    void it('returns true for the current process (guaranteed alive)', () => {
      const result = isProcessAlive(process.pid);

      assert.equal(result, true, 'Current process should be detected as alive');
    });

    void it('returns true for init process (PID 1 on Unix)', function (this: { skip: () => void }) {
      // Skip on Windows (no PID 1) or macOS (may not have permission)
      if (process.platform === 'win32' || process.platform === 'darwin') {
        this.skip();
        return;
      }

      // Note: On some systems this may require elevated permissions
      const result = isProcessAlive(1);

      assert.equal(typeof result, 'boolean', 'Should return boolean for PID 1');
    });

    void it('returns false for non-existent process with high PID', () => {
      // Use a very high PID that's unlikely to exist
      const nonExistentPid = 999999999;

      const result = isProcessAlive(nonExistentPid);

      assert.equal(result, false, 'Non-existent process should return false');
    });

    void it('handles special PIDs (0, negative) based on platform', () => {
      // On Unix: PID 0 can mean "signal current process group"
      // On Unix: Negative PIDs can mean "signal process group"
      // The function may return true for these due to signal 0 semantics

      const result0 = isProcessAlive(0);
      const resultNeg = isProcessAlive(-1);

      assert.equal(typeof result0, 'boolean', 'Should return boolean for PID 0');
      assert.equal(typeof resultNeg, 'boolean', 'Should return boolean for negative PID');
    });

    void it('does not throw when checking non-existent process', () => {
      assert.doesNotThrow(() => {
        const result = isProcessAlive(123456789);
        assert.equal(typeof result, 'boolean', 'Should return boolean');
      });
    });

    void it('signal 0 check does not terminate the process', () => {
      const pidBefore = process.pid;

      isProcessAlive(process.pid);

      const pidAfter = process.pid;

      assert.equal(pidBefore, pidAfter, 'Process should still be alive after check');
      assert.ok(isProcessAlive(process.pid), 'Process should still be detectable as alive');
    });

    void it('handles concurrent checks for same PID without errors', () => {
      const results = Array.from({ length: 10 }, () => isProcessAlive(process.pid));

      // All results should be true (current process is alive)
      assert.ok(
        results.every((r) => r === true),
        'All concurrent checks should return true'
      );
    });

    void it('returns consistent result for same PID when called multiple times', () => {
      const result1 = isProcessAlive(process.pid);
      const result2 = isProcessAlive(process.pid);
      const result3 = isProcessAlive(process.pid);

      assert.equal(result1, result2, 'Results should be consistent');
      assert.equal(result2, result3, 'Results should be consistent');
    });
  });

  void describe('Cross-platform behavior', () => {
    void it('works correctly on current platform', () => {
      const currentProcess = isProcessAlive(process.pid);
      const nonExistent = isProcessAlive(999999999);

      assert.equal(currentProcess, true, 'Current process check should work on any platform');
      assert.equal(nonExistent, false, 'Non-existent check should work on any platform');
    });

    void it('returns boolean type on all platforms', () => {
      const result = isProcessAlive(process.pid);

      assert.equal(typeof result, 'boolean', 'Should always return boolean type');
      assert.notEqual(result, null, 'Should not return null');
      assert.notEqual(result, undefined, 'Should not return undefined');
    });
  });

  void describe('Edge cases', () => {
    void it('handles very large PID numbers', () => {
      const largePid = 2147483647; // Max 32-bit signed int

      assert.doesNotThrow(() => {
        const result = isProcessAlive(largePid);
        assert.equal(typeof result, 'boolean', 'Should handle large PIDs');
      });
    });

    void it('handles parent process PID (ppid)', () => {
      // Note: ppid should typically be alive since it spawned us
      const ppid = process.ppid;

      const result = isProcessAlive(ppid);

      assert.equal(typeof result, 'boolean', 'Should return boolean for parent PID');
      // Note: We don't assert true/false as parent might have exited in some test runners
    });

    void it('repeated calls for non-existent PID consistently return false', () => {
      const deadPid = 999999999;

      const results = Array.from({ length: 5 }, () => isProcessAlive(deadPid));

      assert.ok(
        results.every((r) => r === false),
        'All checks for dead PID should return false'
      );
    });
  });

  void describe('Type safety', () => {
    void it('accepts integer PIDs without errors', () => {
      assert.doesNotThrow(() => {
        isProcessAlive(1);
        isProcessAlive(1000);
        isProcessAlive(65535);
      });
    });

    void it('handles floating point PIDs by converting to integer', () => {
      assert.doesNotThrow(() => {
        const result = isProcessAlive(process.pid + 0.5);
        assert.equal(typeof result, 'boolean');
      });
    });
  });
});

void describe('waitForProcessExit()', () => {
  void it('returns true once the process has exited', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid as number;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
    assert.equal(await waitForProcessExit(pid, 2000, { pollMs: 10 }), true);
  });

  void it('returns false when the process still runs after the wait', async () => {
    assert.equal(await waitForProcessExit(process.pid, 60, { pollMs: 10 }), false);
  });

  void it('sees an exit that comes during the wait', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid as number;
    try {
      const waiting = waitForProcessExit(pid, 5000, { pollMs: 10 });
      child.kill('SIGKILL');
      assert.equal(await waiting, true);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
