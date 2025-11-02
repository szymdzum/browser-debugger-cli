import type { Command } from 'commander';

import {
  readPid,
  isProcessAlive,
  cleanupSession,
  clearChromePid,
  killChromeProcess,
} from '@/utils/session.js';

/**
 * Flags supported by `bdg stop`.
 * @property killChrome Kill the associated Chrome process after stopping bdg.
 */
interface StopOptions {
  killChrome?: boolean;
}

/**
 * Register stop command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop all active sessions and free ports (does not capture output)')
    .option('--kill-chrome', 'Also kill Chrome browser')
    .action(async (options: StopOptions) => {
      try {
        const { readSessionMetadata } = await import('../../utils/session.js');

        // Read PID
        const pid = readPid();
        if (!pid) {
          console.error('No active session found');
          console.error('All ports should be free');
          process.exit(0);
        }

        console.error(`Stopping session (PID ${pid})...`);

        // Read metadata BEFORE killing the process (so we can get Chrome PID)
        const metadata = readSessionMetadata();

        // Kill the bdg process (use SIGKILL for immediate termination)
        if (isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
            console.error(`✓ Killed bdg session (PID ${pid})`);
          } catch (killError: unknown) {
            const errorMessage = killError instanceof Error ? killError.message : String(killError);
            console.error(`Warning: Could not kill process ${pid}:`, errorMessage);
          }
        } else {
          console.error(`Process ${pid} already stopped`);
        }

        // Kill Chrome if requested
        if (options.killChrome) {
          if (metadata?.chromePid) {
            try {
              if (isProcessAlive(metadata.chromePid)) {
                // Use SIGTERM for graceful shutdown (cross-platform via killChromeProcess)
                killChromeProcess(metadata.chromePid, 'SIGTERM');
                console.error(`✓ Killed Chrome (PID ${metadata.chromePid})`);

                // Clear Chrome PID cache after successful kill
                clearChromePid();
              } else {
                console.error(`Chrome process (PID ${metadata.chromePid}) already stopped`);
                // Clear stale cache
                clearChromePid();
              }
            } catch (chromeError: unknown) {
              const errorMessage =
                chromeError instanceof Error ? chromeError.message : String(chromeError);
              console.error(`Warning: Could not kill Chrome:`, errorMessage);
            }
          } else {
            console.error('Warning: Chrome PID not found in session metadata');
          }
        } else {
          console.error('Leaving Chrome running (use --kill-chrome to close it)');
        }

        // Clean up session files
        cleanupSession();
        console.error('✓ Cleaned up session files');
        console.error('\nAll sessions stopped and ports freed');

        process.exit(0);
      } catch (error) {
        console.error(
          `Error stopping session: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
