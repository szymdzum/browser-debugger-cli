/**
 * Console command for inspecting and filtering console messages.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { noteFollowConnected } from '@/commands/shared/daemonErrorHandler.js';
import { fetchConsoleMessages, createErrorResult } from '@/commands/shared/dataFetcher.js';
import {
  followFetchFailure,
  newPageCrashes,
  setupFollowMode,
  type FollowPoll,
} from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { ConsoleCommandOptions } from '@/commands/shared/optionTypes.js';
import { consoleLevelOption, positiveIntRule } from '@/commands/shared/validation.js';
import { MAX_CONSOLE_JSON_TEXT_LENGTH, MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { ConsoleMessage, PageIssue } from '@/types.js';
import { buildSuccessResponse } from '@/ui/OutputBuilder.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollowLines,
  LEVEL_MAP,
  lastMessages,
  type ConsoleFormatOptions,
  type ConsoleLevel,
  type ConsoleSkipped,
} from '@/ui/formatters/console.js';
import { pageCrashedNote } from '@/ui/messages/commands.js';
import {
  followingConsoleMessage,
  stoppedFollowingConsoleMessage,
} from '@/ui/messages/consoleMessages.js';

const MIN_LAST = 0;
const MAX_LAST = 10000;
const DEFAULT_LAST = 100;

const consoleLastOption = new Option(
  '--last <n>',
  `List the last N console messages (0 = all; default: ${DEFAULT_LAST} with --list or --follow)`
);

/**
 * Whether to list the messages instead of summarising them: with `--list`,
 * and when `--last` asks for a number of them.
 *
 * @param options - Command options
 * @returns True to list
 */
export function listsMessages(options: Pick<ConsoleCommandOptions, 'list' | 'last'>): boolean {
  return options.list === true || options.last !== undefined;
}

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
  const navId = shownNavigationId(messages, currentNavigationId);
  return messages.filter((m) => (m.navigationId ?? 0) === navId);
}

/**
 * Navigation id of the page whose messages are shown without `--history`.
 *
 * @param messages - All captured messages
 * @param currentNavigationId - Navigation id of the current page, if known
 * @returns That id, else the newest navigation id among the messages
 */
function shownNavigationId(messages: ConsoleMessage[], currentNavigationId?: number): number {
  return currentNavigationId ?? Math.max(...messages.map((m) => m.navigationId ?? 0));
}

/**
 * Dropped messages that could have been in the view: all of them with
 * `--history`; for the current page only while the oldest kept message is
 * that page's (else every dropped one came from an earlier page).
 *
 * @param messages - All kept messages, oldest first
 * @param dropped - Oldest messages the session dropped at its limit
 * @param options - `--history`
 * @param currentNavigationId - Navigation id of the current page, if known
 * @returns Dropped count to warn about (0: none of the view's)
 */
export function droppedInView(
  messages: ConsoleMessage[],
  dropped: number,
  options: Pick<ConsoleCommandOptions, 'history'>,
  currentNavigationId?: number
): number {
  if (dropped === 0 || options.history) return dropped;
  const oldest = messages[0];
  if (!oldest) return dropped;
  return (oldest.navigationId ?? 0) === shownNavigationId(messages, currentNavigationId)
    ? dropped
    : 0;
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

/**
 * Messages the filters left out between the first and the last listed
 * message (their session indices skip them), by why: logged by another page
 * load, or of another level.
 *
 * @param all - All messages of the session
 * @param listed - Messages listed
 * @returns Counts per reason
 */
export function skippedMessages(all: ConsoleMessage[], listed: ConsoleMessage[]): ConsoleSkipped {
  const shown = new Set(listed.map((message) => message.index));
  const indices = listed.map((message) => message.index).filter((index) => index !== undefined);
  const skipped = { otherPages: 0, otherLevels: 0 };
  if (indices.length < 2) return skipped;
  const [first, last] = [Math.min(...indices), Math.max(...indices)];
  const pages = new Set(listed.map((message) => message.navigationId));
  for (const { index, navigationId } of all) {
    if (index === undefined || index < first || index > last || shown.has(index)) continue;
    if (pages.has(navigationId)) skipped.otherLevels++;
    else skipped.otherPages++;
  }
  return skipped;
}

/**
 * Formatting options from the command options.
 *
 * @param options - Command options
 * @param lastN - `--last` value
 * @param skipped - Messages the filters left out between the listed ones
 * @param dropped - Oldest messages the session dropped at its limit
 * @param pageCrashedAt - When the page crashed, while it is not loaded again
 * @param issues - Chrome Issues of the page and how many were not kept
 * @returns Formatting options
 */
function buildFormatOptions(
  options: ConsoleCommandOptions,
  lastN: number,
  skipped?: ConsoleSkipped,
  dropped?: number,
  pageCrashedAt?: number,
  issues?: PageIssues
): ConsoleFormatOptions {
  return {
    ...(options.last !== undefined && { groupLimit: lastN }),
    ...(dropped && { dropped }),
    ...(pageCrashedAt !== undefined && { pageCrashedAt }),
    ...(issues && { issues: issues.issues, issuesDropped: issues.issuesDropped }),
    list: listsMessages(options),
    follow: options.follow,
    last: lastN,
    history: options.history,
    level: options.level,
    full: options.full,
    skipped,
  };
}

/**
 * Stream console messages: the last `lastN` at start, then each new message
 * once (like `tail -f`), with a separator when the page navigates and a
 * warning (JSON `pageCrashedAt`) once when the page crashes.
 *
 * @param options - Command options
 * @param lastN - Messages to show at start (0 = all)
 */
async function runFollowMode(options: ConsoleCommandOptions, lastN: number): Promise<void> {
  const shown = new Set<string>();
  const newCrash = newPageCrashes();
  let navigationId: number | undefined;
  let started = false;
  const showConsole = async (): Promise<FollowPoll> => {
    const result = await fetchConsoleMessages();
    if (!result.success) {
      return followFetchFailure(result, { json: options.json, retryIntervalMs: 1000 });
    }
    noteFollowConnected();

    const { messages, currentNavigationId } = result.data;
    const crashedAt = newCrash(result.data.pageCrashedAt);
    const matching = applyFilters(messages, options, currentNavigationId);
    const keys = messageKeys(matching);
    const fresh = matching.filter((_message, i) => !shown.has(keys[i] as string));
    const backlog = started || lastN === 0 ? fresh : fresh.slice(-lastN);
    shown.clear();
    keys.forEach((key) => shown.add(key));
    const navigated = started && navigationId !== currentNavigationId;
    navigationId = currentNavigationId;
    if (options.json) {
      if (!started || backlog.length > 0 || crashedAt !== undefined) {
        const data = buildConsoleJsonOutput(backlog, {
          list: true,
          last: 0,
          pageCrashedAt: crashedAt,
          full: options.full,
        });
        console.log(JSON.stringify(buildSuccessResponse(data)));
      }
    } else {
      const text = formatConsoleFollowLines(backlog, {
        header: !started,
        full: options.full,
        ...(navigated &&
          currentNavigationId !== undefined && { navigationId: currentNavigationId }),
      });
      if (text) console.log(text);
      if (crashedAt !== undefined) console.log(pageCrashedNote(crashedAt));
    }
    started = true;
    return undefined;
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

/** Chrome Issues of the page currently loaded */
interface PageIssues {
  issues: PageIssue[];
  /** Issues of the page not kept past the per-page limit */
  issuesDropped: number;
}

interface ConsoleResult extends PageIssues {
  messages: ConsoleMessage[];
  filtered: ConsoleMessage[];
  /** Dropped messages that could have been in the view (see {@link droppedInView}) */
  dropped: number;
  pageCrashedAt: number | undefined;
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
    .addOption(
      new Option(
        '--full',
        `Print message texts whole (default: the first ${MAX_CONSOLE_TEXT_LENGTH} characters, ${MAX_CONSOLE_JSON_TEXT_LENGTH} in JSON)`
      ).default(false)
    )
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
          const { messages, currentNavigationId, dropped, pageCrashedAt, issues, issuesDropped } =
            result.data;
          const filtered = applyFilters(messages, options, currentNavigationId);
          if (options.json) {
            return {
              success: true,
              data: buildConsoleJsonOutput(
                filtered,
                buildFormatOptions(options, lastN, undefined, dropped, pageCrashedAt, {
                  issues,
                  issuesDropped,
                })
              ),
            };
          }
          const droppedShown = droppedInView(messages, dropped, options, currentNavigationId);
          return {
            success: true,
            data: {
              messages,
              filtered,
              dropped: droppedShown,
              pageCrashedAt,
              issues,
              issuesDropped,
            },
          };
        },
        options,
        (data) => {
          const { messages, filtered, dropped, pageCrashedAt, issues, issuesDropped } =
            data as ConsoleResult;
          const skipped = skippedMessages(messages, lastMessages(filtered, lastN));
          return formatConsole(
            filtered,
            buildFormatOptions(options, lastN, skipped, dropped, pageCrashedAt, {
              issues,
              issuesDropped,
            })
          );
        }
      );
    });
}
