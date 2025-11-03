import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { stopSession } from '@/ipc/client.js';
import type { IPCErrorCode } from '@/ipc/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { clearChromePid, killChromeProcess } from '@/utils/session.js';

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
 * Map daemon error codes to appropriate exit codes.
 *
 * @param errorCode - IPC error code from daemon response
 * @returns Semantic exit code
 */
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  switch (errorCode) {
    case IPCErrorCode.NO_SESSION:
      return EXIT_CODES.RESOURCE_NOT_FOUND;
    case IPCErrorCode.SESSION_KILL_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.DAEMON_ERROR:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
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
        // Try to stop session via IPC (daemon)
        const response = await stopSession();

        if (response.status === 'ok') {
          // Session stopped successfully via daemon
          if (!options.json) {
            console.error('Session stopped successfully');
          }

          // Handle Chrome if requested (daemon captured Chrome PID before cleanup)
          let chromeStopped = false;
          const warnings: string[] = [];

          if (options.killChrome) {
            // Use chromePid from daemon response (captured before cleanup)
            const chromePid = response.chromePid;
            if (chromePid) {
              try {
                killChromeProcess(chromePid, 'SIGTERM');
                chromeStopped = true;
                if (!options.json) {
                  console.error(`Killed Chrome (PID ${chromePid})`);
                }
                clearChromePid();
              } catch (chromeError: unknown) {
                const errorMessage =
                  chromeError instanceof Error ? chromeError.message : String(chromeError);
                warnings.push(`Could not kill Chrome: ${errorMessage}`);
                if (!options.json) {
                  console.error(`Warning: Could not kill Chrome:`, errorMessage);
                }
              }
            } else {
              warnings.push('Chrome PID not found (Chrome was not launched by bdg)');
              if (!options.json) {
                console.error('Warning: Chrome PID not found (Chrome was not launched by bdg)');
              }
            }
          }

          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonSuccess({
                  stopped: { bdg: true, chrome: chromeStopped },
                  message: response.message ?? 'Session stopped successfully',
                  ...(warnings.length > 0 && { warnings }),
                }),
                null,
                2
              )
            );
          }

          process.exit(EXIT_CODES.SUCCESS);
        } else {
          // Daemon returned error (e.g., no active session)
          // Map error codes to appropriate exit codes
          const exitCode = getExitCodeForDaemonError(response.errorCode);

          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(response.message ?? 'Failed to stop session'),
                null,
                2
              )
            );
          } else {
            console.error(response.message ?? 'Failed to stop session');
          }
          process.exit(exitCode);
        }
      } catch (error: unknown) {
        // IPC transport failure (ENOENT, ECONNREFUSED, timeout, etc.)
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it's a connection error (daemon not running)
        if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(
                  'Daemon not running. Start a session first with: bdg <url>'
                ),
                null,
                2
              )
            );
          } else {
            console.error('Daemon not running');
            console.error('Start a session first with: bdg <url>');
          }
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        // Other errors (timeout, parse failures, etc.)
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonError(`Stop session failed: ${errorMessage}`),
              null,
              2
            )
          );
        } else {
          console.error(`Error stopping session: ${errorMessage}`);
        }
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
