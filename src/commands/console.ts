import { Option } from 'commander';

import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import type { ConsoleCommandOptions } from '@/commands/shared/optionTypes.js';
import { getErrorMessage } from '@/connection/errors.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { BdgOutput, ConsoleMessage } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatConsole,
  formatConsoleFollow,
  type ConsoleFormatOptions,
} from '@/ui/formatters/console.js';
import {
  followingConsoleMessage,
  stoppedFollowingConsoleMessage,
  noConsoleDataMessage,
} from '@/ui/messages/consoleMessages.js';
import { invalidLastRangeError } from '@/ui/messages/validation.js';
import { getExitCodeForConnectionError } from '@/utils/errorMapping.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Validation limits for --last option.
 */
const MIN_LAST_ITEMS = 0;
const MAX_LAST_ITEMS = 10000;
const DEFAULT_LAST_ITEMS = 100;
const FOLLOW_MODE_MESSAGE_LIMIT = 20;

/**
 * Console-specific --last option.
 */
const consoleLastOption = new Option(
  '--last <n>',
  `Show last N console messages (0 = all, default: ${DEFAULT_LAST_ITEMS})`
)
  .default(DEFAULT_LAST_ITEMS)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < MIN_LAST_ITEMS || n > MAX_LAST_ITEMS) {
      throw new CommandError(
        invalidLastRangeError(MIN_LAST_ITEMS, MAX_LAST_ITEMS),
        {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    return n;
  });

/**
 * --list option for showing all messages chronologically.
 * Note: Named differently from --all to avoid conflict with program-level -a/--all (start command).
 */
const listOption = new Option('-l, --list', 'List all messages chronologically').default(false);

/**
 * --follow option for live streaming.
 */
const followOption = new Option('-f, --follow', 'Stream console messages in real-time').default(
  false
);

/**
 * --history option to show messages from all page loads.
 * By default, only current navigation messages are shown.
 */
const historyOption = new Option(
  '-H, --history',
  'Show messages from all page loads (default: current only)'
).default(false);

/**
 * Fetch console messages from the daemon.
 *
 * @param options - Command options for error handling context
 * @returns Console messages array or null if error handled
 */
async function fetchConsoleMessages(
  options: ConsoleCommandOptions
): Promise<ConsoleMessage[] | null> {
  try {
    const response = await getPeek();

    try {
      validateIPCResponse(response);
    } catch (validationError) {
      const errorMsg = getErrorMessage(validationError);
      const exitCode = getExitCodeForConnectionError(errorMsg);
      const result = handleDaemonConnectionError(errorMsg, {
        json: options.json,
        follow: options.follow,
        retryIntervalMs: 1000,
        exitCode,
      });
      if (result.shouldExit) {
        process.exit(result.exitCode);
      }
      return null;
    }

    const output = response.data?.preview as BdgOutput | undefined;
    if (!output?.data.console) {
      if (options.json) {
        console.log(
          JSON.stringify({
            success: false,
            error: noConsoleDataMessage(),
          })
        );
      } else {
        console.error(noConsoleDataMessage());
      }
      process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
    }

    return output.data.console;
  } catch {
    const result = handleDaemonConnectionError('Daemon not running', {
      json: options.json,
      follow: options.follow,
      retryIntervalMs: 1000,
    });
    if (result.shouldExit) {
      process.exit(result.exitCode);
    }
    return null;
  }
}

/**
 * Filter messages to only include those from the current (most recent) navigation.
 *
 * Finds the highest navigationId (most recent page load) and returns only
 * messages from that navigation. Messages without navigationId are excluded.
 *
 * @param messages - All console messages
 * @returns Messages from the current page load only
 */
export function filterByCurrentNavigation(messages: ConsoleMessage[]): ConsoleMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  // Find the maximum navigationId (current page load)
  const maxNavigationId = Math.max(
    ...messages.map((m) => m.navigationId ?? 0).filter((id) => id !== undefined)
  );

  // Filter to only messages from current navigation
  return messages.filter((m) => m.navigationId === maxNavigationId);
}

/**
 * Display console output based on options.
 *
 * @param messages - Console messages to display
 * @param options - Command options
 */
function displayConsole(messages: ConsoleMessage[], options: ConsoleCommandOptions): void {
  let filteredMessages = messages;

  // Default: show only current navigation. Use --history for all.
  if (!options.history) {
    filteredMessages = filterByCurrentNavigation(messages);
  }

  const formatOptions: ConsoleFormatOptions = {
    json: options.json,
    list: options.list,
    follow: options.follow,
    last: options.last,
    history: options.history,
  };

  if (options.follow) {
    console.clear();
  }

  console.log(formatConsole(filteredMessages, formatOptions));
}

/**
 * Display console in follow mode with streaming updates.
 *
 * @param messages - Console messages to display
 * @param options - Command options (for --history flag)
 */
function displayConsoleStreaming(messages: ConsoleMessage[], options: ConsoleCommandOptions): void {
  let filteredMessages = messages;

  // Default: show only current navigation. Use --history for all.
  if (!options.history) {
    filteredMessages = filterByCurrentNavigation(messages);
  }

  const lastMessages = filteredMessages.slice(-FOLLOW_MODE_MESSAGE_LIMIT);
  console.clear();
  console.log(formatConsoleFollow(lastMessages));
}

/**
 * Register console command.
 *
 * Provides smart console message inspection with:
 * - Default: Problem-focused summary (errors + warnings deduplicated)
 * - --list: Chronological view of all messages
 * - --follow: Live streaming mode
 * - --json: Machine-readable output with summary stats
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerConsoleCommand(program: Command): void {
  program
    .command('console')
    .description('Console message inspection and analysis')
    .addOption(listOption)
    .addOption(followOption)
    .addOption(historyOption)
    .addOption(consoleLastOption)
    .addOption(jsonOption)
    .action(async (options: ConsoleCommandOptions) => {
      if (options.follow) {
        console.error(followingConsoleMessage());

        const showConsole = async (): Promise<void> => {
          const messages = await fetchConsoleMessages(options);
          if (messages) {
            displayConsoleStreaming(messages, options);
          }
        };

        await showConsole();
        const followInterval = setInterval(() => {
          void showConsole();
        }, 1000);

        process.on('SIGINT', () => {
          clearInterval(followInterval);
          console.error(stoppedFollowingConsoleMessage());
          process.exit(EXIT_CODES.SUCCESS);
        });
      } else {
        const messages = await fetchConsoleMessages(options);
        if (messages) {
          displayConsole(messages, options);
        }
      }
    });
}
