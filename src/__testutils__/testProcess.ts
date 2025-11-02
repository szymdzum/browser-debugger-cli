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

  process.kill = ((pid: number, signal?: number | NodeJS.Signals) => {
    // Signal 0 is used to check if process exists (doesn't actually send signal)
    if (signal === 0 || signal === undefined) {
      if (alivePidSet.has(pid)) {
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
    // For other signals, delegate to original implementation
    return (originalKill as typeof process.kill)(pid, signal);
  }) as typeof process.kill;
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
