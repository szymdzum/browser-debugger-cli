import { Command } from 'commander';
import { startSession } from '../handlers/sessionController.js';
import { CollectorType } from '../../types.js';

/**
 * Common action handler for collector commands
 */
async function collectorAction(
  url: string,
  options: any,
  collectors: CollectorType[]
) {
  const port = parseInt(options.port);
  const timeout = options.timeout ? parseInt(options.timeout) : undefined;
  const reuseTab = options.reuseTab ?? false;
  const userDataDir = options.userDataDir;
  await startSession(url, { port, timeout, reuseTab, userDataDir }, collectors);
}

/**
 * Register all start/collector commands
 */
export function registerStartCommands(program: Command) {
  // IMPORTANT: Register subcommands FIRST, before default command
  // This prevents Commander.js from treating subcommand names as arguments

  // DOM only
  program
    .command('dom')
    .description('Collect DOM only')
    .argument('<url>', 'Target URL')
    .option('-p, --port <number>', 'Chrome debugging port', '9222')
    .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
    .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
    .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
    .action(async (url: string, options) => {
      await collectorAction(url, options, ['dom']);
    });

  // Network only
  program
    .command('network')
    .description('Collect network requests only')
    .argument('<url>', 'Target URL')
    .option('-p, --port <number>', 'Chrome debugging port', '9222')
    .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
    .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
    .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
    .action(async (url: string, options) => {
      await collectorAction(url, options, ['network']);
    });

  // Console only
  program
    .command('console')
    .description('Collect console logs only')
    .argument('<url>', 'Target URL')
    .option('-p, --port <number>', 'Chrome debugging port', '9222')
    .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
    .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
    .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
    .action(async (url: string, options) => {
      await collectorAction(url, options, ['console']);
    });

  // Default command: collect all data
  // MUST be registered AFTER subcommands
  program
    .argument('<url>', 'Target URL (example.com or localhost:3000)')
    .option('-p, --port <number>', 'Chrome debugging port', '9222')
    .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
    .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
    .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
    .action(async (url: string, options) => {
      await collectorAction(url, options, ['dom', 'network', 'console']);
    });
}
