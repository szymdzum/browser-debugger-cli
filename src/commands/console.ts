/**
 * Console command for inspecting and filtering console messages.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { fetchConsoleMessages, createErrorResult } from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { ConsoleCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import type { ConsoleMessage } from '@/types.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollow,
  LEVEL_MAP,
  type ConsoleFormatOptions,
  type ConsoleLevel,
} from '@/ui/formatters/console.js';
import {
  followingConsoleMessage,
  stoppedFollowingConsoleMessage,
} from '@/ui/messages/consoleMessages.js';

const MIN_LAST = 0;
const MAX_LAST = 10000;
const DEFAULT_LAST = 100;
const FOLLOW_LIMIT = 20;
const VALID_LEVELS: ConsoleLevel[] = ['error', 'warning', 'info', 'debug'];

const consoleLastOption = new Option(
  '--last <n>',
  `Show last N console messages (0 = all, default: ${DEFAULT_LAST})`
).default(String(DEFAULT_LAST));

export function filterByCurrentNavigation(messages: ConsoleMessage[]): ConsoleMessage[] {
  if (messages.length === 0) return messages;
  const maxNavId = Math.max(...messages.map((m) => m.navigationId ?? 0));
  return messages.filter((m) => m.navigationId === maxNavId);
}

export function filterByLevel(messages: ConsoleMessage[], level: ConsoleLevel): ConsoleMessage[] {
  return messages.filter((m) => LEVEL_MAP[m.type] === level);
}

function applyFilters(
  messages: ConsoleMessage[],
  options: Pick<ConsoleCommandOptions, 'history' | 'level'>
): ConsoleMessage[] {
  let filtered = options.history ? messages : filterByCurrentNavigation(messages);
  if (options.level) filtered = filterByLevel(filtered, options.level);
  return filtered;
}

function buildFormatOptions(options: ConsoleCommandOptions, lastN: number): ConsoleFormatOptions {
  return {
    json: options.json,
    list: options.list,
    follow: options.follow,
    last: lastN,
    history: options.history,
    level: options.level,
  };
}

async function runFollowMode(options: ConsoleCommandOptions): Promise<void> {
  const showConsole = async (): Promise<void> => {
    const result = await fetchConsoleMessages();

    if (!result.success) {
      const errorResult = handleDaemonConnectionError(result.error, {
        json: options.json,
        follow: true,
        retryIntervalMs: 1000,
        exitCode: result.exitCode,
      });
      if (errorResult.shouldExit) process.exit(errorResult.exitCode);
      return;
    }

    const filtered = applyFilters(result.data, options);
    console.clear();
    console.log(formatConsoleFollow(filtered.slice(-FOLLOW_LIMIT)));
  };

  await setupFollowMode(showConsole, {
    startMessage: followingConsoleMessage,
    stopMessage: stoppedFollowingConsoleMessage,
    intervalMs: 1000,
  });
}

interface ConsoleResult {
  messages: ConsoleMessage[];
  filtered: ConsoleMessage[];
}

export function registerConsoleCommand(program: Command): void {
  program
    .command('console')
    .description('Console message inspection and analysis')
    .addOption(new Option('-l, --list', 'List all messages chronologically').default(false))
    .addOption(new Option('-f, --follow', 'Stream console messages in real-time').default(false))
    .addOption(
      new Option(
        '-H, --history',
        'Show messages from all page loads (default: current only)'
      ).default(false)
    )
    .addOption(
      new Option(
        '--level <level>',
        'Filter by message level (error, warning, info, debug)'
      ).choices(VALID_LEVELS)
    )
    .addOption(consoleLastOption)
    .addOption(jsonOption())
    .action(async (options: ConsoleCommandOptions) => {
      let lastN: number;

      try {
        lastN = positiveIntRule({ min: MIN_LAST, max: MAX_LAST, default: DEFAULT_LAST }).validate(
          options.last
        );
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      if (options.follow) {
        await runFollowMode(options);
        return;
      }

      await runCommand<ConsoleCommandOptions, unknown>(
        async () => {
          const result = await fetchConsoleMessages();
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode);
          }
          const filtered = applyFilters(result.data, options);
          if (options.json) {
            return {
              success: true,
              data: buildConsoleJsonOutput(filtered, buildFormatOptions(options, lastN)),
            };
          }
          return { success: true, data: { messages: result.data, filtered } };
        },
        options,
        (data) => {
          const { filtered } = data as ConsoleResult;
          return formatConsole(filtered, buildFormatOptions(options, lastN));
        }
      );
    });
}
