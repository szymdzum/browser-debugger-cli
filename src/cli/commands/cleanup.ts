import * as fs from 'fs';

import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { readPid, isProcessAlive, cleanupSession, getOutputFilePath } from '@/utils/session.js';

/**
 * Flags consumed by the `bdg cleanup` command.
 * @property force      Force removal even if the tracked process is alive.
 * @property all        Also delete the persisted `session.json` artifact.
 * @property aggressive Aggressively kill all Chrome processes (uses chrome-launcher killAll).
 * @property json       Output result as JSON.
 */
interface CleanupOptions {
  force?: boolean;
  all?: boolean;
  aggressive?: boolean;
  json?: boolean;
}

/**
 * Register cleanup command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up stale session files')
    .option('-f, --force', 'Force cleanup even if session appears active')
    .option('-a, --all', 'Also remove session.json output file')
    .option('--aggressive', 'Kill all Chrome processes (uses chrome-launcher killAll)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: CleanupOptions) => {
      try {
        // Import cleanupStaleChrome dynamically
        const { cleanupStaleChrome } = await import('@/cli/handlers/sessionController.js');

        const pid = readPid();
        let didCleanup = false;
        let cleanedSession = false;
        let cleanedOutput = false;
        let cleanedChrome = false;
        const warnings: string[] = [];

        // Handle aggressive Chrome cleanup first if requested
        if (options.aggressive) {
          const errorCount = await cleanupStaleChrome();
          cleanedChrome = true;
          if (errorCount > 0) {
            warnings.push('Some Chrome processes could not be killed');
            if (!options.json) {
              console.error('Warning: Some Chrome processes could not be killed');
            }
          }
          didCleanup = true;
        }

        if (!pid) {
          // No session files to clean up
          // Fall through to check --all flag for session.json removal
        } else {
          // PID file exists - handle session cleanup
          const isAlive = isProcessAlive(pid);

          if (isAlive && !options.force) {
            const errorMsg = `Session is still active (PID ${pid})`;
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError(errorMsg, {
                    suggestions: [
                      'Stop gracefully: bdg stop',
                      'Force cleanup: bdg cleanup --force',
                    ],
                    warning:
                      'Force cleanup will remove session files but will NOT kill the running process',
                  }),
                  null,
                  2
                )
              );
            } else {
              console.error(errorMsg);
              console.error('\nOptions:');
              console.error('  Stop gracefully:       bdg stop');
              console.error('  Force cleanup:         bdg cleanup --force');
              console.error('\nWarning: Force cleanup will remove session files');
              console.error('   but will NOT kill the running process.');
            }
            process.exit(EXIT_CODES.RESOURCE_BUSY);
          }

          if (isAlive && options.force) {
            warnings.push(`Process ${pid} is still running but forcing cleanup anyway`);
            if (!options.json) {
              console.error(`Warning: Process ${pid} is still running!`);
              console.error('Forcing cleanup anyway...');
              console.error('(The process will continue running but lose session tracking)');
            }
          } else {
            if (!options.json) {
              console.error(`Found stale session (PID ${pid} not running)`);
            }
          }

          cleanupSession();
          cleanedSession = true;
          if (!options.json) {
            console.error('Session files cleaned up');
          }
          didCleanup = true;
        }

        // Also remove session.json output file if --all flag is specified
        if (options.all) {
          const outputPath = getOutputFilePath();
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
              cleanedOutput = true;
              if (!options.json) {
                console.error('Session output file removed');
              }
              didCleanup = true;
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              warnings.push(`Could not remove session.json: ${errorMessage}`);
              if (!options.json) {
                console.error(`Warning: Could not remove session.json: ${errorMessage}`);
              }
            }
          }
        }

        // Check if any cleanup was performed
        if (!didCleanup) {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonSuccess({
                  cleaned: { session: false, output: false, chrome: false },
                  message: 'No session files found. Session directory is already clean',
                }),
                null,
                2
              )
            );
          } else {
            console.error('No session files found');
            console.error('Session directory is already clean');
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonSuccess({
                cleaned: { session: cleanedSession, output: cleanedOutput, chrome: cleanedChrome },
                message: 'Session directory is now clean',
                ...(warnings.length > 0 && { warnings }),
              }),
              null,
              2
            )
          );
        } else {
          console.error('');
          console.error('Session directory is now clean');
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonError(error instanceof Error ? error.message : String(error)),
              null,
              2
            )
          );
        } else {
          console.error(
            `Error during cleanup: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
