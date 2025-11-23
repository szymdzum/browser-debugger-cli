import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CleanupCommandOptions } from '@/commands/shared/optionTypes.js';
import type { CleanupResult } from '@/commands/types.js';
import { performSessionCleanup } from '@/session/cleanup.js';
import { readPid } from '@/session/pid.js';
import { joinLines } from '@/ui/formatting.js';
import {
  sessionFilesCleanedMessage,
  sessionOutputRemovedMessage,
  sessionDirectoryCleanMessage,
  noSessionFilesMessage,
  sessionStillActiveError,
  warningMessage,
} from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { isProcessAlive } from '@/utils/process.js';

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
    .option('-f, --force', 'Force cleanup even if session appears active', false)
    .option('--remove-output', 'Also remove session.json output file', false)
    .option('--aggressive', 'Kill orphaned daemon processes and all stale Chrome instances', false)
    .addOption(jsonOption())
    .action(async (options: CleanupCommandOptions) => {
      await runCommand<CleanupCommandOptions, CleanupResult>(
        async (opts) => {
          const pid = readPid();
          if (pid) {
            const isAlive = isProcessAlive(pid);
            if (isAlive && !opts.force) {
              return {
                success: false,
                error: sessionStillActiveError(pid),
                exitCode: EXIT_CODES.RESOURCE_BUSY,
                errorContext: {
                  suggestions: ['Stop gracefully: bdg stop', 'Force cleanup: bdg cleanup --force'],
                  warning:
                    'Force cleanup will remove session files but will NOT kill the running process',
                },
              };
            }
          }

          const cleanupResult = await performSessionCleanup({
            force: opts.force,
            aggressive: opts.aggressive,
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
