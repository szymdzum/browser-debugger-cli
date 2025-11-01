import * as fs from 'fs';

import type { Command } from 'commander';

import { readPid, isProcessAlive, cleanupSession, getOutputFilePath } from '@/utils/session.js';

/**
 * Flags consumed by the `bdg cleanup` command.
 * @property force      Force removal even if the tracked process is alive.
 * @property all        Also delete the persisted `session.json` artifact.
 * @property aggressive Aggressively kill all Chrome processes (uses chrome-launcher killAll).
 */
interface CleanupOptions {
  force?: boolean;
  all?: boolean;
  aggressive?: boolean;
}

/**
 * Register cleanup command
 */
export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up stale session files')
    .option('-f, --force', 'Force cleanup even if session appears active')
    .option('-a, --all', 'Also remove session.json output file')
    .option('--aggressive', 'Kill all Chrome processes (uses chrome-launcher killAll)')
    .action(async (options: CleanupOptions) => {
      try {
        // Import cleanupStaleChrome dynamically
        const { cleanupStaleChrome } = await import('@/cli/handlers/sessionController.js');

        const pid = readPid();
        let didCleanup = false;

        // Handle aggressive Chrome cleanup first if requested
        if (options.aggressive) {
          const errorCount = cleanupStaleChrome();
          if (errorCount > 0) {
            console.error('⚠️  Warning: Some Chrome processes could not be killed');
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
            console.error(`Session is still active (PID ${pid})`);
            console.error('\n💡 Options:');
            console.error('  Stop gracefully:       bdg stop');
            console.error('  Force cleanup:         bdg cleanup --force');
            console.error('\n⚠️  Warning: Force cleanup will remove session files');
            console.error('   but will NOT kill the running process.');
            process.exit(1);
          }

          if (isAlive && options.force) {
            console.error(`⚠️  Warning: Process ${pid} is still running!`);
            console.error('Forcing cleanup anyway...');
            console.error('(The process will continue running but lose session tracking)');
          } else {
            console.error(`Found stale session (PID ${pid} not running)`);
          }

          cleanupSession();
          console.error('✓ Session files cleaned up');
          didCleanup = true;
        }

        // Also remove session.json output file if --all flag is specified
        if (options.all) {
          const outputPath = getOutputFilePath();
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
              console.error('✓ Session output file removed');
              didCleanup = true;
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`Warning: Could not remove session.json: ${errorMessage}`);
            }
          }
        }

        // Check if any cleanup was performed
        if (!didCleanup) {
          console.error('No session files found');
          console.error('Session directory is already clean');
          process.exit(0);
        }

        console.error('');
        console.error('Session directory is now clean');

        process.exit(0);
      } catch (error) {
        console.error(
          `Error during cleanup: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
