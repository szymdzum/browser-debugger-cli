/**
 * Test cleanup utilities for bdg integration tests
 *
 * Provides reusable cleanup functions to ensure Chrome processes and
 * session files are properly cleaned up between tests.
 */

import { execSync } from 'child_process';

/**
 * Clean up bdg session and Chrome processes using production cleanup code.
 *
 * This function uses bdg's own cleanup mechanisms to ensure tests clean up
 * the same way production code does. Falls back to aggressive Chrome cleanup
 * if bdg cleanup fails.
 *
 * @remarks
 * Use this in afterEach() hooks to prevent test pollution and port conflicts.
 *
 * @example
 * ```typescript
 * import { cleanupBdgTest } from '@/__testutils__/testCleanup.js';
 *
 * afterEach(async () => {
 *   await cleanupBdgTest();
 * });
 * ```
 */
export async function cleanupBdgTest(): Promise<void> {
  try {
    // First, try normal cleanup
    execSync('node dist/index.js cleanup --force', {
      stdio: 'ignore',
      timeout: 10000,
    });
  } catch {
    // If normal cleanup fails, try aggressive cleanup
    try {
      execSync('node dist/index.js cleanup --aggressive', {
        stdio: 'ignore',
        timeout: 10000,
      });
    } catch {
      // Last resort: import and use cleanup function directly
      try {
        const { cleanupStaleChrome } = await import('@/commands/shared/sessionController.js');
        await cleanupStaleChrome();
      } catch {
        // Cleanup failed - log but don't throw to avoid breaking test runner
        console.error('[testCleanup] All cleanup methods failed');
      }
    }
  }
}

/**
 * Clean up specific port by killing any process using it.
 *
 * Platform-specific implementation using lsof (macOS/Linux) or
 * netstat (Windows - not yet implemented).
 *
 * @param port - Port number to free
 *
 * @example
 * ```typescript
 * import { cleanupPort } from '@/__testutils__/testCleanup.js';
 *
 * beforeEach(async () => {
 *   await cleanupPort(9222); // Ensure port is free before test
 * });
 * ```
 */
export function cleanupPort(port: number): void {
  try {
    // Platform-specific cleanup (macOS/Linux only for now)
    if (process.platform !== 'win32') {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
        stdio: 'ignore',
        timeout: 5000,
      });
    }
  } catch {
    // Ignore errors - port may already be free
  }
}
