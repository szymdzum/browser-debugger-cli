import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { StopCommandOptions } from '@/commands/shared/optionTypes.js';
import type { StopResult } from '@/commands/types.js';
import { stopSession } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/index.js';
import { IPCTimeoutError } from '@/ipc/transport/index.js';
import { readLiveDaemonPid } from '@/session/cleanup/staleSession.js';
import { joinLines } from '@/ui/formatting.js';
import {
  chromeClosedMessage,
  orphanedDaemonsCleanedMessage,
  warningMessage,
} from '@/ui/messages/commands.js';
import {
  daemonStillExitingHint,
  daemonStillExitingSuggestion,
  sessionStopped,
  STOP_MESSAGES,
  stopFailedError,
} from '@/ui/messages/session.js';
import {
  noActiveSessionMessage,
  sessionCommand,
  startSessionSuggestion,
} from '@/ui/messages/sessionCommand.js';
import { waitUntil } from '@/utils/async.js';
import { getExitCodeForIPCError, isDaemonNotRunningError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { isProcessAlive } from '@/utils/process.js';

/** How long `bdg stop` waits for the session's daemon to exit */
const DAEMON_EXIT_WAIT_MS = 3000;

/**
 * Wait until the stopped session's daemon has exited: it removes the
 * session's files on the way out, and a command run right after (`bdg
 * sessions`, a new start) would otherwise still see the session. The wait is
 * bounded, as after a failed start.
 *
 * @param pid - Daemon PID read before the stop, or null when unknown
 * @param waitMs - Milliseconds to wait at most
 * @returns Warning when the daemon still runs after the wait
 */
export async function waitForDaemonExit(
  pid: number | null,
  waitMs = DAEMON_EXIT_WAIT_MS
): Promise<string | undefined> {
  if (pid === null || (await waitUntil(() => !isProcessAlive(pid), waitMs))) return undefined;
  return `${daemonStillExitingHint(pid, waitMs)}; ${daemonStillExitingSuggestion()}`;
}

/**
 * Format stop result for human-readable output.
 *
 * @param data - Stop result data
 */
function formatStop(data: StopResult): string {
  const outputLine = data.stopped.bdg ? sessionStopped() : undefined;
  const daemonsLine =
    data.stopped.daemons && data.orphanedDaemonsCount
      ? orphanedDaemonsCleanedMessage(data.orphanedDaemonsCount)
      : undefined;

  return joinLines(
    outputLine,
    data.stopped.chrome && chromeClosedMessage(),
    daemonsLine,
    ...(data.warnings ?? []).map((warning) => warningMessage(warning))
  );
}

/**
 * Register stop command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop daemon and close browser session')
    .option(
      '--kill-chrome',
      'Kept for compatibility: Chrome launched by bdg is always closed on stop',
      false
    )
    .addOption(jsonOption())
    .action(async (options: StopCommandOptions) => {
      await runCommand<StopCommandOptions, StopResult>(
        async () => {
          try {
            const daemonPid = readLiveDaemonPid();
            const response = await stopSession();

            if (response.status === 'ok') {
              const warning = await waitForDaemonExit(daemonPid);
              return {
                success: true,
                data: {
                  stopped: {
                    bdg: true,
                    chrome: Boolean(response.chromePid),
                    daemons: false,
                  },
                  orphanedDaemonsCount: 0,
                  message: response.message ?? STOP_MESSAGES.SUCCESS,
                  ...(warning && { warnings: [warning] }),
                },
              };
            } else {
              if (response.errorCode === IPCErrorCode.NO_SESSION) {
                return {
                  success: false,
                  error: response.message ?? noActiveSessionMessage(),
                  exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
                  errorContext: {
                    suggestion: startSessionSuggestion(),
                  },
                };
              }

              const exitCode = getExitCodeForIPCError(response.errorCode);
              return {
                success: false,
                error: response.message ?? STOP_MESSAGES.FAILED,
                exitCode,
                errorContext: {
                  suggestion: `Check session status with: ${sessionCommand('bdg status')}`,
                },
              };
            }
          } catch (error: unknown) {
            if (error instanceof IPCTimeoutError) throw error;
            const errorMessage = getErrorMessage(error);

            if (isDaemonNotRunningError(errorMessage)) {
              return {
                success: false,
                error: noActiveSessionMessage(),
                exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
                errorContext: {
                  suggestion: startSessionSuggestion(),
                },
              };
            }

            return {
              success: false,
              error: stopFailedError(errorMessage),
              exitCode: EXIT_CODES.SOFTWARE_ERROR,
              errorContext: {
                suggestion: `Try: ${sessionCommand('bdg cleanup --force')} to reset session state`,
              },
            };
          }
        },
        options,
        formatStop
      );
    });
}
