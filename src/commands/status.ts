import type { Command } from 'commander';

import { runCommand, type BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { getStatus } from '@/ipc/client.js';
import type { SessionActivity, PageState } from '@/ipc/index.js';
import { cleanupStaleDaemonPid } from '@/session/cleanup.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { getErrorMessage, isDaemonConnectionError } from '@/ui/errors/index.js';
import {
  formatSessionStatus,
  formatStatusAsJson,
  formatNoSessionMessage,
  type StatusData,
} from '@/ui/formatters/status.js';
import { invalidResponseError, daemonNotRunningError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for the `bdg status` command.
 */
interface StatusOptions extends BaseCommandOptions {
  /** Print structured JSON instead of the default human output. */
  json?: boolean;
  /** Show detailed Chrome diagnostics (binary path, port, PID). */
  verbose?: boolean;
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
    .option('-v, --verbose', 'Show detailed Chrome diagnostics', false)
    .action(async (options: StatusOptions) => {
      let latestMetadata: SessionMetadata | null = null;
      let latestSessionPid: number | null = null;
      let latestActivity: SessionActivity | undefined;
      let latestPageState: PageState | undefined;

      await runCommand(
        async () => {
          try {
            const response = await getStatus();
            if (response.status === 'error') {
              return {
                success: false,
                error: `Daemon error: ${response.error ?? 'Unknown error'}`,
                exitCode: EXIT_CODES.UNHANDLED_EXCEPTION,
              };
            }

            const data = response.data;
            if (!data) {
              return {
                success: false,
                error: invalidResponseError('missing data'),
                exitCode: EXIT_CODES.UNHANDLED_EXCEPTION,
              };
            }

            latestActivity = data.activity;
            latestPageState = data.pageState;

            if (!data.sessionPid || !data.sessionMetadata) {
              latestMetadata = null;
              latestSessionPid = null;
              const jsonOutput = formatStatusAsJson(null, null);
              if (data.activity) {
                jsonOutput.activity = data.activity;
              }
              if (data.pageState) {
                jsonOutput.pageState = data.pageState;
              }
              return { success: true, data: jsonOutput };
            }

            const metadata: SessionMetadata = {
              bdgPid: data.sessionMetadata.bdgPid,
              chromePid: data.sessionMetadata.chromePid,
              startTime: data.sessionMetadata.startTime,
              port: data.sessionMetadata.port,
              targetId: data.sessionMetadata.targetId,
              webSocketDebuggerUrl: data.sessionMetadata.webSocketDebuggerUrl,
              activeTelemetry: data.sessionMetadata.activeTelemetry,
            };

            latestMetadata = metadata;
            latestSessionPid = data.sessionPid;

            const jsonOutput = formatStatusAsJson(metadata, data.sessionPid);
            if (data.activity) {
              jsonOutput.activity = data.activity;
            }
            if (data.pageState) {
              jsonOutput.pageState = data.pageState;
            }

            return { success: true, data: jsonOutput };
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            if (isDaemonConnectionError(error)) {
              const cleaned = cleanupStaleDaemonPid();
              // Use unified daemon error helper to keep messaging consistent
              // across commands.
              return {
                success: false,
                error: daemonNotRunningError({ staleCleanedUp: cleaned }),
                exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              };
            }

            return {
              success: false,
              error: `Error checking status: ${errorMessage}`,
              exitCode: EXIT_CODES.UNHANDLED_EXCEPTION,
            };
          }
        },
        options,
        (data: StatusData) => {
          if (!data.active) {
            return formatNoSessionMessage();
          }

          if (!latestMetadata || latestSessionPid === null) {
            return formatNoSessionMessage();
          }

          return formatSessionStatus(
            latestMetadata,
            latestSessionPid,
            latestActivity,
            latestPageState,
            options.verbose ?? false
          );
        }
      );
    });
}
