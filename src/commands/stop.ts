import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { StopCommandOptions } from '@/commands/shared/optionTypes.js';
import type { StopResult } from '@/commands/types.js';
import { getErrorMessage } from '@/connection/errors.js';
import { stopSession } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/index.js';
import { performSessionCleanup } from '@/session/cleanup.js';
import { getSessionFilePath } from '@/session/paths.js';
import { joinLines } from '@/ui/formatting.js';
import {
  chromeKilledMessage,
  orphanedDaemonsCleanedMessage,
  warningMessage,
} from '@/ui/messages/commands.js';
import { sessionStopped, STOP_MESSAGES, stopFailedError } from '@/ui/messages/session.js';
import { getExitCodeForIPCError, isDaemonNotRunningError } from '@/utils/errorMapping.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
 * Register stop command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop daemon and write collected telemetry to ~/.bdg/session.json')
    .option('--kill-chrome', 'Also kill Chrome browser process', false)
    .addOption(jsonOption)
    .addHelpText(
      'after',
      '\nOutput Location:\n  Default: ~/.bdg/session.json\n  Tip: Copy to custom location with: cp ~/.bdg/session.json /path/to/output.json'
    )
    .action(async (options: StopCommandOptions) => {
      await runCommand<StopCommandOptions, StopResult>(
        async (opts) => {
          try {
            const response = await stopSession();

            if (response.status === 'ok') {
              const cleanupResult = await performSessionCleanup({
                killChrome: opts.killChrome,
                chromePid: response.chromePid,
              });

              if (cleanupResult.cleaned.chrome) {
                console.error(chromeKilledMessage(response.chromePid));
              }

              return {
                success: true,
                data: {
                  stopped: {
                    bdg: true,
                    chrome: cleanupResult.cleaned.chrome,
                    daemons: cleanupResult.cleaned.daemons,
                  },
                  orphanedDaemonsCount: cleanupResult.orphanedDaemonsCount,
                  message: response.message ?? STOP_MESSAGES.SUCCESS,
                  ...(cleanupResult.warnings.length > 0 && { warnings: cleanupResult.warnings }),
                },
              };
            } else {
              if (response.errorCode === IPCErrorCode.NO_SESSION) {
                return {
                  success: false,
                  error: response.message ?? STOP_MESSAGES.NO_SESSION,
                  exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
                };
              }

              const exitCode = getExitCodeForIPCError(response.errorCode);
              return {
                success: false,
                error: response.message ?? STOP_MESSAGES.FAILED,
                exitCode,
              };
            }
          } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);

            if (isDaemonNotRunningError(errorMessage)) {
              return {
                success: false,
                error: STOP_MESSAGES.DAEMON_NOT_RUNNING,
                exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
                errorContext: {
                  suggestion: 'Start a session first with: bdg <url>',
                },
              };
            }

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
