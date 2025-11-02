import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
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
 * @property json       Output result as JSON.
 */
interface StopOptions {
  killChrome?: boolean;
  json?: boolean;
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
    .option('-j, --json', 'Output as JSON')
    .action(async (options: StopOptions) => {
      try {
        const { readSessionMetadata } = await import('../../utils/session.js');

        // Read PID
        const pid = readPid();
        if (!pid) {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonSuccess({
                  stopped: { bdg: false, chrome: false },
                  message: 'No active session found. All ports should be free',
                }),
                null,
                2
              )
            );
          } else {
            console.error('No active session found');
            console.error('All ports should be free');
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (!options.json) {
          console.error(`Stopping session (PID ${pid})...`);
        }

        // Read metadata BEFORE killing the process (so we can get Chrome PID)
        const metadata = readSessionMetadata();

        let bdgStopped = false;
        let chromeStopped = false;
        const warnings: string[] = [];

        // Kill the bdg process (use SIGKILL for immediate termination)
        if (isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
            bdgStopped = true;
            if (!options.json) {
              console.error(`Killed bdg session (PID ${pid})`);
            }
          } catch (killError: unknown) {
            const errorMessage = killError instanceof Error ? killError.message : String(killError);
            warnings.push(`Could not kill process ${pid}: ${errorMessage}`);
            if (!options.json) {
              console.error(`Warning: Could not kill process ${pid}:`, errorMessage);
            }
          }
        } else {
          if (!options.json) {
            console.error(`Process ${pid} already stopped`);
          }
        }

        // Kill Chrome if requested
        if (options.killChrome) {
          if (metadata?.chromePid) {
            try {
              if (isProcessAlive(metadata.chromePid)) {
                // Use SIGTERM for graceful shutdown (cross-platform via killChromeProcess)
                killChromeProcess(metadata.chromePid, 'SIGTERM');
                chromeStopped = true;
                if (!options.json) {
                  console.error(`Killed Chrome (PID ${metadata.chromePid})`);
                }

                // Clear Chrome PID cache after successful kill
                clearChromePid();
              } else {
                if (!options.json) {
                  console.error(`Chrome process (PID ${metadata.chromePid}) already stopped`);
                }
                // Clear stale cache
                clearChromePid();
              }
            } catch (chromeError: unknown) {
              const errorMessage =
                chromeError instanceof Error ? chromeError.message : String(chromeError);
              warnings.push(`Could not kill Chrome: ${errorMessage}`);
              if (!options.json) {
                console.error(`Warning: Could not kill Chrome:`, errorMessage);
              }
            }
          } else {
            warnings.push('Chrome PID not found in session metadata');
            if (!options.json) {
              console.error('Warning: Chrome PID not found in session metadata');
            }
          }
        } else {
          if (!options.json) {
            console.error('Leaving Chrome running (use --kill-chrome to close it)');
          }
        }

        // Clean up session files
        cleanupSession();
        if (!options.json) {
          console.error('Cleaned up session files');
          console.error('\nAll sessions stopped and ports freed');
        }

        // Output JSON if requested
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonSuccess({
                stopped: { bdg: bdgStopped, chrome: chromeStopped },
                message: 'Session stopped successfully',
                ...(warnings.length > 0 && { warnings }),
              }),
              null,
              2
            )
          );
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonError(error instanceof Error ? error.message : String(error)),
              null,
              2
            )
          );
        } else {
          console.error(
            `Error stopping session: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
