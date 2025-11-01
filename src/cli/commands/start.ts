import type { Command } from 'commander';

import { startSession } from '@/cli/handlers/sessionController.js';
import {
  DEFAULT_DEBUG_PORT,
  PORT_OPTION_DESCRIPTION,
  TIMEOUT_OPTION_DESCRIPTION,
  REUSE_TAB_OPTION_DESCRIPTION,
  USER_DATA_DIR_OPTION_DESCRIPTION
} from '@/constants';
import type { CollectorType } from '@/types';

/**
 * Apply shared collector options to a command
 */
function applyCollectorOptions(command: Command): Command {
  return command
    .option('-p, --port <number>', PORT_OPTION_DESCRIPTION, DEFAULT_DEBUG_PORT)
    .option('-t, --timeout <seconds>', TIMEOUT_OPTION_DESCRIPTION)
    .option('-r, --reuse-tab', REUSE_TAB_OPTION_DESCRIPTION)
    .option('-u, --user-data-dir <path>', USER_DATA_DIR_OPTION_DESCRIPTION)
    .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)');
}

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
  const includeAll = options.all ?? false;
  await startSession(url, { port, timeout, reuseTab, userDataDir, includeAll }, collectors);
}

/**
 * Register all start/collector commands
 */
export function registerStartCommands(program: Command) {
  // IMPORTANT: Register subcommands FIRST, before default command
  // This prevents Commander.js from treating subcommand names as arguments

  // DOM only
  applyCollectorOptions(
    program
      .command('dom')
      .description('Collect DOM only')
      .argument('<url>', 'Target URL')
  ).action(async (url: string, options) => {
    await collectorAction(url, options, ['dom']);
  });

  // Network only
  applyCollectorOptions(
    program
      .command('network')
      .description('Collect network requests only')
      .argument('<url>', 'Target URL')
  ).action(async (url: string, options) => {
    await collectorAction(url, options, ['network']);
  });

  // Console only
  applyCollectorOptions(
    program
      .command('console')
      .description('Collect console logs only')
      .argument('<url>', 'Target URL')
  ).action(async (url: string, options) => {
    await collectorAction(url, options, ['console']);
  });

  // Default command: collect all data
  // MUST be registered AFTER subcommands
  applyCollectorOptions(
    program
      .argument('<url>', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string, options) => {
    await collectorAction(url, options, ['dom', 'network', 'console']);
  });
}
