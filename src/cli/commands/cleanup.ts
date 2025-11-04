import * as fs from 'fs';

import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/cli/handlers/CommandRunner.js';
import { runCommand } from '@/cli/handlers/CommandRunner.js';
import { jsonOption } from '@/cli/handlers/commonOptions.js';
import { cleanupSession } from '@/session/cleanup.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Flags consumed by the `bdg cleanup` command.
 */
interface CleanupOptions extends BaseCommandOptions {
  /** Force removal even if the tracked process is alive. */
  force?: boolean;
  /** Also delete the persisted `session.json` artifact. */
  all?: boolean;
  /** Aggressively kill all Chrome processes (uses chrome-launcher killAll). */
  aggressive?: boolean;
}

/**
 * Result data for cleanup operation.
 */
interface CleanupResult {
  /** What was cleaned up */
  cleaned: {
    session: boolean;
    output: boolean;
    chrome: boolean;
  };
  /** Success message */
  message: string;
  /** Optional warnings */
  warnings?: string[];
}

/**
 * Format cleanup result for human-readable output.
 *
 * @param data - Cleanup result data
 */
function formatCleanup(data: CleanupResult): void {
  const { cleaned } = data;

  if (cleaned.session) {
    console.error('Session files cleaned up');
  }
  if (cleaned.output) {
    console.error('Session output file removed');
  }
  if (data.warnings && data.warnings.length > 0) {
    data.warnings.forEach((warning) => {
      console.error(`Warning: ${warning}`);
    });
  }

  console.error('');
  console.error(data.message);
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
    .option('-f, --force', 'Force cleanup even if session appears active')
    .option('-a, --all', 'Also remove session.json output file')
    .option('--aggressive', 'Kill all Chrome processes (uses chrome-launcher killAll)')
    .addOption(jsonOption)
    .action(async (options: CleanupOptions) => {
      await runCommand(
        async (opts) => {
          // Import cleanupStaleChrome dynamically
          const { cleanupStaleChrome } = await import('@/cli/handlers/sessionController.js');

          const pid = readPid();
          let didCleanup = false;
          let cleanedSession = false;
          let cleanedOutput = false;
          let cleanedChrome = false;
          const warnings: string[] = [];

          // Handle aggressive Chrome cleanup first if requested
          if (opts.aggressive) {
            const errorCount = await cleanupStaleChrome();
            cleanedChrome = true;
            if (errorCount > 0) {
              warnings.push('Some Chrome processes could not be killed');
            }
            didCleanup = true;
          }

          if (!pid) {
            // No session files to clean up
            // Fall through to check --all flag for session.json removal
          } else {
            // PID file exists - handle session cleanup
            const isAlive = isProcessAlive(pid);

            if (isAlive && !opts.force) {
              return {
                success: false,
                error: `Session is still active (PID ${pid})`,
                exitCode: EXIT_CODES.RESOURCE_BUSY,
                errorContext: {
                  suggestions: ['Stop gracefully: bdg stop', 'Force cleanup: bdg cleanup --force'],
                  warning:
                    'Force cleanup will remove session files but will NOT kill the running process',
                },
              };
            }

            if (isAlive && opts.force) {
              warnings.push(`Process ${pid} is still running but forcing cleanup anyway`);
              console.error(`Warning: Process ${pid} is still running!`);
              console.error('Forcing cleanup anyway...');
              console.error('(The process will continue running but lose session tracking)');
            } else {
              console.error(`Found stale session (PID ${pid} not running)`);
            }

            cleanupSession();
            cleanedSession = true;
            didCleanup = true;
          }

          // Also remove session.json output file if --all flag is specified
          if (opts.all) {
            const outputPath = getSessionFilePath('OUTPUT');
            if (fs.existsSync(outputPath)) {
              try {
                fs.unlinkSync(outputPath);
                cleanedOutput = true;
                didCleanup = true;
              } catch (error: unknown) {
                const errorMessage = getErrorMessage(error);
                warnings.push(`Could not remove session.json: ${errorMessage}`);
              }
            }
          }

          // Check if any cleanup was performed
          if (!didCleanup) {
            return {
              success: true,
              data: {
                cleaned: { session: false, output: false, chrome: false },
                message: 'No session files found. Session directory is already clean',
              },
            };
          }

          return {
            success: true,
            data: {
              cleaned: { session: cleanedSession, output: cleanedOutput, chrome: cleanedChrome },
              message: 'Session directory is now clean',
              ...(warnings.length > 0 && { warnings }),
            },
          };
        },
        options,
        formatCleanup
      );
    });
}
