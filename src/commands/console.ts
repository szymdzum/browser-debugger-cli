/**
 * Console command for inspecting and filtering console messages.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import {
  handleDaemonConnectionError,
  noteFollowConnected,
} from '@/commands/shared/daemonErrorHandler.js';
import { fetchConsoleMessages, createErrorResult } from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { ConsoleCommandOptions } from '@/commands/shared/optionTypes.js';
import { consoleLevelOption, positiveIntRule } from '@/commands/shared/validation.js';
import type { ConsoleMessage } from '@/types.js';
import { buildSuccessResponse } from '@/ui/OutputBuilder.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollowLines,
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

const consoleLastOption = new Option(
  '--last <n>',
  'Show last N console messages (0 = all)'
).default(String(DEFAULT_LAST));

/**
 * Keep the messages of the page currently loaded.
 *
 * @param messages - All captured messages
 * @param currentNavigationId - Navigation id of the current page; when unknown,
 *   the newest navigation id among the messages is used
 * @returns Messages of the current page (empty if it logged nothing)
 */
export function filterByCurrentNavigation(
  messages: ConsoleMessage[],
  currentNavigationId?: number
): ConsoleMessage[] {
  if (messages.length === 0) return messages;
  const navId = currentNavigationId ?? Math.max(...messages.map((m) => m.navigationId ?? 0));
  return messages.filter((m) => (m.navigationId ?? 0) === navId);
}

export function filterByLevel(messages: ConsoleMessage[], level: ConsoleLevel): ConsoleMessage[] {
  return messages.filter((m) => LEVEL_MAP[m.type] === level);
}

function applyFilters(
  messages: ConsoleMessage[],
  options: Pick<ConsoleCommandOptions, 'history' | 'level'>,
  currentNavigationId?: number
): ConsoleMessage[] {
  let filtered = options.history
    ? messages
    : filterByCurrentNavigation(messages, currentNavigationId);
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

/**
 * Stream console messages: the last `lastN` at start, then each new message
 * once (like `tail -f`), with a separator when the page navigates.
 *
 * @param options - Command options
 * @param lastN - Messages to show at start (0 = all)
 */
async function runFollowMode(options: ConsoleCommandOptions, lastN: number): Promise<void> {
  const shown = new Set<string>();
  let navigationId: number | undefined;
  let started = false;
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
    noteFollowConnected();

    const { messages, currentNavigationId } = result.data;
    const matching = applyFilters(messages, options, currentNavigationId);
    const keys = messageKeys(matching);
    const fresh = matching.filter((_message, i) => !shown.has(keys[i] as string));
    const backlog = started || lastN === 0 ? fresh : fresh.slice(-lastN);
    shown.clear();
    keys.forEach((key) => shown.add(key));
    const navigated = started && navigationId !== currentNavigationId;
    navigationId = currentNavigationId;
    if (options.json) {
      if (!started || backlog.length > 0) {
        const data = buildConsoleJsonOutput(backlog, { list: true, last: 0 });
        console.log(JSON.stringify(buildSuccessResponse(data), null, 2));
      }
    } else {
      const text = formatConsoleFollowLines(backlog, {
        header: !started,
        ...(navigated &&
          currentNavigationId !== undefined && { navigationId: currentNavigationId }),
      });
      if (text) console.log(text);
    }
    started = true;
  };

  await setupFollowMode(showConsole, {
    startMessage: followingConsoleMessage,
    stopMessage: stoppedFollowingConsoleMessage,
    intervalMs: 1000,
  });
}

/**
 * Identity of each message across polls (its index can shift when an earlier
 * message is inserted late). Identical messages logged in the same
 * millisecond are told apart by their order.
 *
 * @param messages - Messages in order
 * @returns One key per message
 */
export function messageKeys(messages: ConsoleMessage[]): string[] {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const base = `${message.timestamp}|${message.type}|${message.navigationId ?? ''}|${message.text}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return `${base}#${occurrence}`;
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
        'Filter by message level: error, warning, info (includes log), debug; any case'
      ).argParser(consoleLevelOption)
    )
    .addOption(consoleLastOption)
    .addOption(jsonOption())
    .action(async (options: ConsoleCommandOptions) => {
      let lastN: number;

      try {
        lastN = positiveIntRule({
          name: '--last',
          min: MIN_LAST,
          max: MAX_LAST,
          default: DEFAULT_LAST,
        }).validate(options.last);
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      if (options.follow) {
        await runFollowMode(options, lastN);
        return;
      }

      await runCommand<ConsoleCommandOptions, unknown>(
        async () => {
          const result = await fetchConsoleMessages();
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode, result.suggestion);
          }
          const { messages, currentNavigationId } = result.data;
          const filtered = applyFilters(messages, options, currentNavigationId);
          if (options.json) {
            return {
              success: true,
              data: buildConsoleJsonOutput(filtered, buildFormatOptions(options, lastN)),
            };
          }
          return { success: true, data: { messages, filtered } };
        },
        options,
        (data) => {
          const { filtered } = data as ConsoleResult;
          return formatConsole(filtered, buildFormatOptions(options, lastN));
        }
      );
    });
}
