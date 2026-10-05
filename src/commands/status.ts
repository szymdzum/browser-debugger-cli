import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { StatusCommandOptions } from '@/commands/shared/optionTypes.js';
import type { StatusResult } from '@/commands/types.js';
import { isDaemonConnectionError } from '@/errors/index.js';
import { invalidResponseError, sessionNotRespondingError } from '@/errors/messages.js';
import { getStatus } from '@/ipc/client.js';
import type { SessionActivity, PageState } from '@/ipc/index.js';
import { IPCTimeoutError } from '@/ipc/transport/IPCError.js';
import { describeRunningChrome } from '@/session/chrome.js';
import { findOrphanedChrome, removeStaleDaemonFiles } from '@/session/cleanup/staleSession.js';
import { readLastSessionEnd } from '@/session/lastSession.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { getSessionName } from '@/session/paths.js';
import {
  formatSessionStatus,
  formatStatusAsJson,
  formatNoSessionMessage,
  type StatusData,
} from '@/ui/formatters/status.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Status without a running session: a start in progress, or a Chrome left
 * running by an earlier session.
 *
 * @param starting - Start in progress, as reported by the daemon
 * @param ending - Whether the daemon is shutting the session down
 * @returns Status data (inactive)
 */
function inactiveStatus(starting?: StatusData['starting'], ending?: boolean): StatusData {
  if (starting) return { active: false, starting };
  if (ending) return { active: false, ending: true };
  const orphanedChromePid = findOrphanedChrome();
  const lastSession = readLastSessionEnd();
  return {
    active: false,
    ...(orphanedChromePid !== null && { orphanedChromePid }),
    ...(lastSession && { lastSession }),
  };
}

/**
 * Add the selected session's name (named sessions only).
 *
 * @param data - Status data
 * @returns Status data with `session` for a named session
 */
function withSessionName(data: StatusData): StatusData {
  const session = getSessionName();
  return session === null ? data : { session, ...data };
}

/**
 * Force-clean the selected session and start it again.
 *
 * @returns Command line
 */
function resetCommand(): string {
  return `${sessionCommand('bdg cleanup --force')} && ${sessionCommand('bdg <url>')}`;
}

/**
 * Register status command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show active session status and collection statistics')
    .option('-j, --json', 'Output as JSON', false)
    .option('-v, --verbose', "Also show the session's Chrome executable, mode and profile", false)
    .action(async (options: StatusCommandOptions) => {
      let latestMetadata: SessionMetadata | undefined;
      let latestSessionPid: number | undefined;
      let latestActivity: SessionActivity | undefined;
      let latestPageState: PageState | undefined;

      await runCommand<StatusCommandOptions, StatusResult>(
        async () => {
          try {
            const response = await getStatus();
            if (response.status === 'error') {
              return {
                success: false,
                error: `Daemon error: ${response.error ?? 'Unknown error'}`,
                exitCode: EXIT_CODES.SOFTWARE_ERROR,
                errorContext: {
                  suggestion: `Try: ${resetCommand()}`,
                },
              };
            }

            const data = response.data;
            if (!data) {
              return {
                success: false,
                error: invalidResponseError('missing data'),
                exitCode: EXIT_CODES.SOFTWARE_ERROR,
                errorContext: {
                  suggestion: `This is unexpected. Try: ${resetCommand()}`,
                },
              };
            }

            latestActivity = data.activity;
            latestPageState = data.pageState;

            if (!data.sessionPid || !data.sessionMetadata) {
              latestMetadata = undefined;
              latestSessionPid = undefined;
              const jsonOutput = inactiveStatus(data.starting, data.ending);
              if (data.activity) {
                jsonOutput.activity = data.activity;
              }
              if (data.pageState) {
                jsonOutput.pageState = data.pageState;
              }
              return { success: true, data: withSessionName(jsonOutput) };
            }

            const metadata: SessionMetadata = {
              bdgPid: data.sessionMetadata.bdgPid,
              chromePid: data.sessionMetadata.chromePid,
              startTime: data.sessionMetadata.startTime,
              port: data.sessionMetadata.port,
              targetId: data.sessionMetadata.targetId,
              webSocketDebuggerUrl: data.sessionMetadata.webSocketDebuggerUrl,
              activeTelemetry: data.sessionMetadata.activeTelemetry,
              autoStopAt: data.sessionMetadata.autoStopAt,
            };

            latestMetadata = metadata;
            latestSessionPid = data.sessionPid;

            const jsonOutput = formatStatusAsJson(metadata, data.sessionPid);
            const chrome =
              options.verbose && metadata.chromePid
                ? describeRunningChrome(metadata.chromePid)
                : null;
            if (chrome) jsonOutput.chrome = chrome;
            if (data.activity) {
              jsonOutput.activity = data.activity;
            }
            if (data.pageState) {
              jsonOutput.pageState = data.pageState;
            }

            return { success: true, data: withSessionName(jsonOutput) };
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            if (error instanceof IPCTimeoutError) {
              const err = sessionNotRespondingError(error.timeoutMs / 1000);
              return {
                success: false,
                error: err.message,
                exitCode: EXIT_CODES.CDP_TIMEOUT,
                errorContext: { suggestion: err.suggestion },
              };
            }
            if (isDaemonConnectionError(error)) {
              await removeStaleDaemonFiles();
              latestMetadata = undefined;
              latestSessionPid = undefined;
              return { success: true, data: withSessionName(inactiveStatus()) };
            }

            return {
              success: false,
              error: `Error checking status: ${errorMessage}`,
              exitCode: EXIT_CODES.SOFTWARE_ERROR,
              errorContext: {
                suggestion: `Try: ${sessionCommand('bdg cleanup --force')} to reset session state`,
              },
            };
          }
        },
        options,
        (data: StatusData) => {
          if (!data.active) {
            return formatNoSessionMessage(data);
          }

          if (!latestMetadata || latestSessionPid === undefined) {
            return formatNoSessionMessage();
          }

          return formatSessionStatus(
            latestMetadata,
            latestSessionPid,
            latestActivity,
            latestPageState,
            options.verbose ?? false,
            data.session
          );
        }
      );
    });
}
