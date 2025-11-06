import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { stopSession } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/types.js';
import { clearChromePid } from '@/session/chrome.js';
import { getSessionFilePath } from '@/session/paths.js';
import { killChromeProcess } from '@/session/process.js';
import { chromeKilledMessage, warningMessage } from '@/ui/messages/commands.js';
import { sessionStopped, STOP_MESSAGES, stopFailedError } from '@/ui/messages/session.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Flags supported by `bdg stop`.
 */
interface StopOptions extends BaseCommandOptions {
  /** Kill the associated Chrome process after stopping bdg. */
  killChrome?: boolean;
}

/**
 * Result data for stop operation.
 */
interface StopResult {
  /** What was stopped */
  stopped: {
    bdg: boolean;
    chrome: boolean;
  };
  /** Success message */
  message: string;
  /** Optional warnings */
  warnings?: string[];
}

/**
 * Format stop result for human-readable output.
 *
 * @param data - Stop result data
 */
function formatStop(data: StopResult): void {
  if (data.stopped.bdg) {
    const outputPath = getSessionFilePath('OUTPUT');
    console.error(sessionStopped(outputPath));
  }
  if (data.stopped.chrome) {
    console.error(chromeKilledMessage());
  }
  if (data.warnings && data.warnings.length > 0) {
    data.warnings.forEach((warning) => {
      console.error(warningMessage(warning));
    });
  }
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
    case IPCErrorCode.SESSION_ALREADY_RUNNING:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.WORKER_START_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.CHROME_LAUNCH_FAILED:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case IPCErrorCode.CDP_TIMEOUT:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
}

/**
 * Register stop command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop all active sessions and free ports (does not capture output)')
    .option('--kill-chrome', 'Also kill Chrome browser')
    .addOption(jsonOption)
    .action(async (options: StopOptions) => {
      await runCommand(
        async (opts) => {
          try {
            // Try to stop session via IPC (daemon)
            const response = await stopSession();

            if (response.status === 'ok') {
              // Session stopped successfully via daemon
              let chromeStopped = false;
              const warnings: string[] = [];

              // Handle Chrome if requested (daemon captured Chrome PID before cleanup)
              if (opts.killChrome) {
                const chromePid = response.chromePid;
                if (chromePid) {
                  try {
                    killChromeProcess(chromePid, 'SIGTERM');
                    chromeStopped = true;
                    console.error(chromeKilledMessage(chromePid));
                    clearChromePid();
                  } catch (chromeError: unknown) {
                    const errorMessage =
                      chromeError instanceof Error ? chromeError.message : String(chromeError);
                    warnings.push(`Could not kill Chrome: ${errorMessage}`);
                  }
                } else {
                  warnings.push('Chrome PID not found (Chrome was not launched by bdg)');
                }
              }

              return {
                success: true,
                data: {
                  stopped: { bdg: true, chrome: chromeStopped },
                  message: response.message ?? STOP_MESSAGES.SUCCESS,
                  ...(warnings.length > 0 && { warnings }),
                },
              };
            } else {
              // Daemon returned error
              // Special case: NO_SESSION is not really an error - it's a success (desired state achieved)
              if (response.errorCode === IPCErrorCode.NO_SESSION) {
                return {
                  success: true,
                  data: {
                    stopped: { bdg: false, chrome: false },
                    message: response.message ?? STOP_MESSAGES.NO_SESSION,
                  },
                };
              }

              // Other errors are actual failures
              const exitCode = getExitCodeForDaemonError(response.errorCode);
              return {
                success: false,
                error: response.message ?? STOP_MESSAGES.FAILED,
                exitCode,
              };
            }
          } catch (error: unknown) {
            // IPC transport failure (ENOENT, ECONNREFUSED, timeout, etc.)
            const errorMessage = getErrorMessage(error);

            // Check if it's a connection error (daemon not running)
            if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
              return {
                success: false,
                error: STOP_MESSAGES.DAEMON_NOT_RUNNING,
                exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
                errorContext: {
                  suggestion: 'Start a session first with: bdg <url>',
                },
              };
            }

            // Other errors (timeout, parse failures, etc.)
            return {
              success: false,
              error: stopFailedError(errorMessage),
              exitCode: EXIT_CODES.UNHANDLED_EXCEPTION,
            };
          }
        },
        options,
        formatStop
      );
    });
}
