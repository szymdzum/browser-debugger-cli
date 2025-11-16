import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { StopResult } from '@/commands/types.js';
import { getErrorMessage } from '@/connection/errors.js';
import { stopSession } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/index.js';
import { clearChromePid } from '@/session/chrome.js';
import { cleanupOrphanedDaemons } from '@/session/cleanup.js';
import { getSessionFilePath } from '@/session/paths.js';
import { killChromeProcess } from '@/session/process.js';
import { joinLines } from '@/ui/formatting.js';
import {
  chromeKilledMessage,
  orphanedDaemonsCleanedMessage,
  warningMessage,
} from '@/ui/messages/commands.js';
import { sessionStopped, STOP_MESSAGES, stopFailedError } from '@/ui/messages/session.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Flags supported by `bdg stop`.
 */
interface StopOptions extends BaseCommandOptions {
  /** Kill the associated Chrome process after stopping bdg. */
  killChrome?: boolean;
}

/**
 * Format stop result for human-readable output.
 *
 * @param data - Stop result data
 */
function formatStop(data: StopResult): string {
  const outputLine = data.stopped.bdg ? sessionStopped(getSessionFilePath('OUTPUT')) : undefined;
  const daemonsLine =
    data.stopped.daemons && data.orphanedDaemonsCount
      ? orphanedDaemonsCleanedMessage(data.orphanedDaemonsCount)
      : undefined;

  return joinLines(
    outputLine,
    data.stopped.chrome && chromeKilledMessage(),
    daemonsLine,
    ...(data.warnings ?? []).map((warning) => warningMessage(warning))
  );
}

/**
 * Map daemon error codes to appropriate exit codes.
 *
 * Only NO_SESSION has special handling (RESOURCE_NOT_FOUND).
 * All other error codes map to UNHANDLED_EXCEPTION.
 *
 * @param errorCode - IPC error code from daemon response
 * @returns Semantic exit code
 */
function getExitCodeForDaemonError(errorCode?: IPCErrorCode): number {
  return errorCode === IPCErrorCode.NO_SESSION
    ? EXIT_CODES.RESOURCE_NOT_FOUND
    : EXIT_CODES.UNHANDLED_EXCEPTION;
}

/**
 * Register stop command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop daemon and write collected telemetry to session.json')
    .option('--kill-chrome', 'Also kill Chrome browser process', false)
    .addOption(jsonOption)
    .action(async (options: StopOptions) => {
      await runCommand<StopOptions, StopResult>(
        async (opts) => {
          try {
            // Try to stop session via IPC (daemon)
            const response = await stopSession();

            if (response.status === 'ok') {
              // Session stopped successfully via daemon
              let chromeStopped = false;
              let orphanedDaemonsCount = 0;
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

              // Automatically cleanup orphaned daemon processes
              orphanedDaemonsCount = cleanupOrphanedDaemons();

              return {
                success: true,
                data: {
                  stopped: { bdg: true, chrome: chromeStopped, daemons: orphanedDaemonsCount > 0 },
                  orphanedDaemonsCount,
                  message: response.message ?? STOP_MESSAGES.SUCCESS,
                  ...(warnings.length > 0 && { warnings }),
                },
              };
            } else {
              // Daemon returned error
              // Special case: NO_SESSION should fail with helpful error message
              if (response.errorCode === IPCErrorCode.NO_SESSION) {
                return {
                  success: false,
                  error: response.message ?? STOP_MESSAGES.NO_SESSION,
                  exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
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
