/**
 * testProcess - Helpers for stubbing process-related operations in tests
 *
 * Provides utilities to mock process.kill for testing process alive checks
 * without actually sending signals.
 *
 * ⚠️ CRITICAL: Always call restoreProcessAlive() in afterEach() to prevent
 * cross-suite pollution.
 *
 * Usage:
 * ```typescript
 * describe('my test', () => {
 *   afterEach(() => {
 *     restoreProcessAlive(); // REQUIRED
 *   });
 *
 *   it('should check if process is alive', () => {
 *     mockProcessAlive([1234, 5678]);
 *     // Now process.kill(1234, 0) returns true
 *     // And process.kill(9999, 0) returns false
 *   });
 * });
 * ```
 */

import { hasArgument } from '@/session/cleanup/staleSession.js';
import { getProcessCommand } from '@/utils/process.js';

let originalKill: typeof process.kill | null = null;

/**
 * Mock process.kill to simulate alive/dead processes
 *
 * When signal is 0 (alive check), returns true if PID is in alivePids array,
 * or throws ESRCH error if PID is dead.
 * For other signals, delegates to original process.kill.
 *
 * @param alivePids - Array of PIDs that should be considered "alive"
 */
export function mockProcessAlive(alivePids: number[]): void {
  // Capture original process.kill if not already saved (bind to avoid unbound-method)
  originalKill ??= process.kill.bind(process);

  const alivePidSet = new Set(alivePids);

  process.kill = (pid: number, signal?: number | NodeJS.Signals) => {
    const normalizedPid = Math.abs(pid);
    // Signal 0 is used to check if process exists (doesn't actually send signal)
    if (signal === 0 || signal === undefined) {
      if (alivePidSet.has(normalizedPid)) {
        // Process is alive - return true
        return true;
      } else {
        // Process is dead - throw ESRCH error (like real process.kill)
        const err = new Error(`kill ESRCH`) as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        err.errno = -3;
        err.syscall = 'kill';
        throw err;
      }
    }

    if (!alivePidSet.has(normalizedPid)) {
      const err = new Error(`kill ESRCH`) as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      err.errno = -3;
      err.syscall = 'kill';
      throw err;
    }

    alivePidSet.delete(normalizedPid);
    return true;
  };
}

/**
 * Restore original process.kill implementation
 *
 * ⚠️ CRITICAL: Always call this in afterEach() to prevent test pollution
 */
export function restoreProcessAlive(): void {
  if (originalKill !== null) {
    process.kill = originalKill;
    originalKill = null;
  }
}

/**
 * Check if process.kill is currently mocked
 * (Useful for debugging test cleanup issues)
 */
export function isProcessMocked(): boolean {
  return originalKill !== null;
}

/**
 * Poll until a spawned process's command line carries a text as an argument, matched as the product does (up to 2 s).
 *
 * A pid is alive from the fork, but on Linux its command line still shows the
 * parent's until the exec: the product matches sessions by command line, so a
 * test that lists sessions must wait for the same signal, not for the pid.
 *
 * @param pid - Process ID
 * @param text - Marker the command line must contain (daemon script path, session marker flag)
 * @throws Error if the command line never shows the text
 */
export async function waitForCommand(pid: number, text: string): Promise<void> {
  let command: string | null = null;
  for (let i = 0; i < 100; i++) {
    command = getProcessCommand(pid);
    if (hasArgument(command, text)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const seen = command === null ? 'nothing' : `"${command}"`;
  throw new Error(`process ${pid} never showed ${text}, got ${seen}`);
}
