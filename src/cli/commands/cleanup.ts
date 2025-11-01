import { Command } from 'commander';
import { readPid, isProcessAlive, cleanupSession, getOutputFilePath } from '../../utils/session.js';
import * as fs from 'fs';

/**
 * Register cleanup command
 */
export function registerCleanupCommand(program: Command) {
  program
    .command('cleanup')
    .description('Clean up stale session files')
    .option('-f, --force', 'Force cleanup even if session appears active')
    .option('-a, --all', 'Also remove session.json output file')
    .action(async (options) => {
      try {
        const pid = readPid();
        let didCleanup = false;

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
            } catch (error) {
              console.error(`Warning: Could not remove session.json: ${error}`);
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
        console.error(`Error during cleanup: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
