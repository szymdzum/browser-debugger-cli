import * as fs from 'fs';

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CleanupCommandOptions } from '@/commands/shared/optionTypes.js';
import type { CleanupResult } from '@/commands/types.js';
import { sessionDirIsFileError } from '@/errors/messages.js';
import { performSessionCleanup } from '@/session/cleanup/userCommands.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import { getSessionDir, getSessionName } from '@/session/paths.js';
import { readDaemonPid } from '@/session/pid.js';
import { joinLines } from '@/ui/formatting.js';
import {
  sessionFilesCleanedMessage,
  sessionOutputRemovedMessage,
  sessionDirectoryCleanMessage,
  noSessionFilesMessage,
  sessionStillActiveError,
  sessionStillActiveSuggestion,
  warningMessage,
} from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Format cleanup result for human-readable output.
 *
 * @param data - Cleanup result data
 */
function formatCleanup(data: CleanupResult): string {
  const { cleaned } = data;

  return joinLines(
    cleaned.session && sessionFilesCleanedMessage(),
    cleaned.output && sessionOutputRemovedMessage(),
    ...(data.warnings ?? []).map((warning) => warningMessage(warning)),
    '',
    data.message
  );
}

/**
 * Register cleanup command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up stale session files')
    .option('-f, --force', 'Kill a running (possibly hung) session, then clean up', false)
    .option('--remove-output', 'Also remove session.json output file', false)
    .option('--aggressive', 'Alias for --force (kept for compatibility)', false)
    .addOption(jsonOption())
    .action(async (options: CleanupCommandOptions) => {
      await runCommand<CleanupCommandOptions, CleanupResult>(
        async (opts) => {
          const dir = getSessionDir();
          if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
            const err = sessionDirIsFileError(dir);
            return {
              success: false,
              error: err.message,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
              errorContext: { suggestion: err.suggestion },
            };
          }
          if (!opts.force && !opts.aggressive && (await isDaemonAlive())) {
            return {
              success: false,
              error: sessionStillActiveError(readDaemonPid() ?? 0),
              exitCode: EXIT_CODES.RESOURCE_BUSY,
              errorContext: {
                suggestion: sessionStillActiveSuggestion(getSessionName()),
                warning: 'Force cleanup kills the running daemon and its Chrome',
              },
            };
          }

          const cleanupResult = await performSessionCleanup({
            force: Boolean(opts.force) || Boolean(opts.aggressive),
            removeOutput: opts.removeOutput,
          });

          const didCleanup =
            cleanupResult.cleaned.session ||
            cleanupResult.cleaned.chrome ||
            cleanupResult.cleaned.daemons ||
            cleanupResult.cleaned.output;

          if (!didCleanup) {
            return {
              success: true,
              data: {
                cleaned: { session: false, output: false, chrome: false, daemons: false },
                message: noSessionFilesMessage(),
              },
            };
          }

          return {
            success: true,
            data: {
              cleaned: {
                session: cleanupResult.cleaned.session,
                output: cleanupResult.cleaned.output,
                chrome: cleanupResult.cleaned.chrome,
                daemons: cleanupResult.cleaned.daemons,
              },
              message: sessionDirectoryCleanMessage(),
              ...(cleanupResult.warnings.length > 0 && { warnings: cleanupResult.warnings }),
            },
          };
        },
        options,
        formatCleanup
      );
    });
}
