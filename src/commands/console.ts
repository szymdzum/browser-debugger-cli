/**
 * Console command for inspecting and filtering console messages.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { includeSensitiveOption, jsonOption } from '@/commands/shared/commonOptions.js';
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
import { CommandError } from '@/errors/index.js';
import type { TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
import type { ConsoleMessage, PageIssue } from '@/types.js';
import { buildSuccessResponse } from '@/ui/OutputBuilder.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  createConsoleNdjson,
  formatConsoleFollowLines,
  LEVEL_MAP,
  lastMessages,
  type ConsoleFormatOptions,
  type ConsoleLevel,
  type ConsoleSkipped,
  type HiddenByLevel,
} from '@/ui/formatters/console.js';
import { pageCrashedNote } from '@/ui/messages/commands.js';
import {
  followingConsoleMessage,
  ndjsonConflictsWithJson,
  ndjsonNeedsFollow,
  stoppedFollowingConsoleMessage,
} from '@/ui/messages/consoleMessages.js';
import { includeSensitiveWarning } from '@/ui/messages/networkMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
 * Messages of the page in view that `--level` hid, per level.
 *
 * @param messages - All messages of the session
 * @param options - `--history` and `--level`
 * @param currentNavigationId - Navigation id of the current page, if known
 * @returns Counts per level of the hidden messages (empty without `--level` or when none)
 */
export function hiddenByLevel(
  messages: ConsoleMessage[],
  options: Pick<ConsoleCommandOptions, 'history' | 'level'>,
  currentNavigationId?: number
): HiddenByLevel {
  const hidden: HiddenByLevel = {};
  if (!options.level) return hidden;
  const inView = options.history
    ? messages
    : filterByCurrentNavigation(messages, currentNavigationId);
  for (const { type } of inView) {
    const level = LEVEL_MAP[type];
    if (level !== options.level) hidden[level] = (hidden[level] ?? 0) + 1;
  }
  return hidden;
}

/**
 * Messages the filters left out between the first and the last listed
 * message (their session indices skip them), by why: logged by another page
 * load, or of another level. With `--history` every page load is listed, so
 * all of them are of another level.
 *
 * @param all - All messages of the session
 * @param listed - Messages listed
 * @param history - `--history`: messages of every page load were listed
 * @returns Counts per reason
 */
export function skippedMessages(
  all: ConsoleMessage[],
  listed: ConsoleMessage[],
  history = false
): ConsoleSkipped {
  const shown = new Set(listed.map((message) => message.index));
  const indices = listed.map((message) => message.index).filter((index) => index !== undefined);
  const skipped = { otherPages: 0, otherLevels: 0 };
  if (indices.length < 2) return skipped;
  const [first, last] = [Math.min(...indices), Math.max(...indices)];
  const pages = new Set(listed.map((message) => message.navigationId));
  for (const { index, navigationId } of all) {
    if (index === undefined || index < first || index > last || shown.has(index)) continue;
    if (history || pages.has(navigationId)) skipped.otherLevels++;
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
 * @param page - Chrome Issues of the page and how many were not kept, and
 *   the session's latest move to another tab
 * @returns Formatting options
 */
function buildFormatOptions(
  options: ConsoleCommandOptions,
  lastN: number,
  skipped?: ConsoleSkipped,
  dropped?: number,
  pageCrashedAt?: number,
  page?: PageNotes
): ConsoleFormatOptions {
  return {
    ...(page?.hidden && Object.keys(page.hidden).length > 0 && { hiddenByLevel: page.hidden }),
    ...(options.last !== undefined && { groupLimit: lastN }),
    ...(dropped && { dropped }),
    ...(pageCrashedAt !== undefined && { pageCrashedAt }),
    ...(page && { issues: page.issues, issuesDropped: page.issuesDropped }),
    ...(page?.tabSwitch && { tabSwitch: page.tabSwitch }),
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
 * Reject `--ndjson` without `--follow` (nothing to stream) and together with
 * `--json` (two output formats).
 *
 * @param options - Command options
 * @throws CommandError with exit code 81
 */
function checkNdjson(options: ConsoleCommandOptions): void {
  if (!options.ndjson) return;
  const problem = options.json ? ndjsonConflictsWithJson() : !options.follow && ndjsonNeedsFollow();
  if (!problem) return;
  throw new CommandError(
    problem.message,
    { suggestion: problem.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
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
  const cursor = createFollowCursor(options, lastN);
  const newCrash = newPageCrashes();
  const ndjson = options.ndjson ? createConsoleNdjson(options) : undefined;
  if (ndjson && options.includeSensitive) console.error(includeSensitiveWarning());
  let streamNavigationId: number | undefined;
  let started = false;
  const showConsole = async (): Promise<FollowPoll> => {
    const result = await fetchConsoleMessages();
    if (!result.success) {
      return followFetchFailure(result, {
        json: options.json === true || options.ndjson === true,
        retryIntervalMs: 1000,
      });
    }
    noteFollowConnected();

    const { messages, currentNavigationId, navigations } = result.data;
    const crashedAt = newCrash(result.data.pageCrashedAt);
    const backlog = cursor.next(messages, currentNavigationId, result.data.dropped);
    if (ndjson) {
      for (const line of ndjson.next(backlog, navigations, currentNavigationId)) console.log(line);
      if (crashedAt !== undefined) console.error(pageCrashedNote(crashedAt));
    } else if (options.json) {
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
        navigations,
        includeSensitive: options.includeSensitive,
        ...(streamNavigationId !== undefined && { streamNavigationId }),
        ...(currentNavigationId !== undefined && { currentNavigationId }),
      });
      if (text) console.log(text);
      if (crashedAt !== undefined) console.log(pageCrashedNote(crashedAt));
    }
    started = true;
    streamNavigationId = currentNavigationId;
    return undefined;
  };

  await setupFollowMode(showConsole, {
    startMessage: followingConsoleMessage,
    stopMessage: stoppedFollowingConsoleMessage,
    intervalMs: 1000,
  });
}

/**
 * Content identity of a message: messages with the same one are told apart
 * only by their number.
 *
 * @param message - A console message
 * @returns Its identity
 */
function messageIdentity(message: ConsoleMessage): string {
  return `${message.timestamp}|${message.type}|${message.navigationId ?? ''}|${message.text}`;
}

/**
 * How many messages of each identity are in a list.
 *
 * @param identities - Identities in order
 * @returns Counts
 */
function countIdentities(identities: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  return counts;
}

/** Decides which messages a follow poll prints */
export interface FollowCursor {
  /**
   * The messages not printed yet, in order.
   *
   * @param messages - All messages the session kept
   * @param currentNavigationId - Navigation id of the current page, if known
   * @param dropped - Oldest messages the session has dropped at its limit so far
   * @returns Messages to print now
   */
  next(
    messages: ConsoleMessage[],
    currentNavigationId?: number,
    dropped?: number
  ): ConsoleMessage[];
}

/**
 * Track what `console --follow` printed. Between two polls the session only
 * drops its oldest messages (`dropped` says how many) and appends new ones,
 * so the previous list minus the dropped ones is what was printed and is
 * still held: per message identity (time, level, page, text), the newest
 * surplus over that count is new. Identical messages are therefore each
 * printed once, also when some of them were dropped. A message of a page left
 * since the last poll is printed like any other. The first poll prints the
 * page loaded (every page with `--history`), the last `lastN` messages of it;
 * later polls print what is new on any page. `--level` applies to all of them.
 * Limit: a message inserted late (by its time) before older ones counts as
 * new, and a late message the session drops at once makes the next poll
 * reprint one message identical to the oldest kept.
 *
 * @param options - `--history` and `--level`
 * @param lastN - Messages to show at start (0 = all)
 * @returns The cursor
 */
export function createFollowCursor(
  options: Pick<ConsoleCommandOptions, 'history' | 'level'>,
  lastN: number
): FollowCursor {
  let previous: string[] = [];
  let previousDropped: number | undefined;
  let started = false;
  return {
    next(messages, currentNavigationId, dropped = 0) {
      const identities = messages.map(messageIdentity);
      const held = countIdentities(
        previous.slice(Math.max(0, dropped - (previousDropped ?? dropped)))
      );
      const surplus = new Map(
        [...countIdentities(identities)].map(([identity, count]) => [
          identity,
          count - (held.get(identity) ?? 0),
        ])
      );
      const isNew = identities.map(() => false);
      for (let i = identities.length - 1; i >= 0; i--) {
        const identity = identities[i] as string;
        const left = surplus.get(identity) ?? 0;
        if (left <= 0) continue;
        isNew[i] = true;
        surplus.set(identity, left - 1);
      }
      previous = identities;
      previousDropped = dropped;
      const fresh = messages.filter((_message, i) => isNew[i]);
      if (started) return options.level ? filterByLevel(fresh, options.level) : fresh;
      started = true;
      const backlog = applyFilters(fresh, options, currentNavigationId);
      return lastN === 0 ? backlog : backlog.slice(-lastN);
    },
  };
}

/** Chrome Issues of the page currently loaded */
interface PageIssues {
  issues: PageIssue[];
  /** Issues of the page not kept past the per-page limit */
  issuesDropped: number;
}

/** What the console view notes about the page besides its messages */
interface PageNotes extends PageIssues {
  /** The session's latest move to another tab */
  tabSwitch?: TabSwitchInfo | undefined;
  /** Messages `--level` hid, per level */
  hidden?: HiddenByLevel | undefined;
}

interface ConsoleResult extends PageNotes {
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
    .addOption(
      new Option(
        '--ndjson',
        'With --follow: one JSON object per line, a {"type":"message",…} record per console message and a {"type":"page","navigationId":N,"url":"…"} record per page, before its first message (instead of --json\'s batch envelopes; excludes --json)'
      ).default(false)
    )
    .addOption(includeSensitiveOption())
    .addOption(jsonOption())
    .action(async (options: ConsoleCommandOptions) => {
      let lastN: number;
      const jsonErrors = options.json === true || options.ndjson === true;

      try {
        checkNdjson(options);
        lastN = positiveIntRule({
          name: '--last',
          min: MIN_LAST,
          max: MAX_LAST,
          default: DEFAULT_LAST,
        }).validate(options.last);
      } catch (error) {
        handleValidationError(error, jsonErrors);
      }

      if (options.follow) {
        await runFollowMode(options, lastN);
        return;
      }

      await runCommand<ConsoleCommandOptions, unknown>(
        async () => {
          const result = await fetchConsoleMessages(true);
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode, result.suggestion);
          }
          const {
            messages,
            currentNavigationId,
            dropped,
            pageCrashedAt,
            tabSwitch,
            issues,
            issuesDropped,
          } = result.data;
          const filtered = applyFilters(messages, options, currentNavigationId);
          const hidden = hiddenByLevel(messages, options, currentNavigationId);
          if (options.json) {
            return {
              success: true,
              data: buildConsoleJsonOutput(
                filtered,
                buildFormatOptions(options, lastN, undefined, dropped, pageCrashedAt, {
                  issues,
                  issuesDropped,
                  tabSwitch,
                  hidden,
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
              hidden,
              dropped: droppedShown,
              pageCrashedAt,
              tabSwitch,
              issues,
              issuesDropped,
            },
          };
        },
        options,
        (data) => {
          const {
            messages,
            filtered,
            hidden,
            dropped,
            pageCrashedAt,
            tabSwitch,
            issues,
            issuesDropped,
          } = data as ConsoleResult;
          const skipped = skippedMessages(
            messages,
            lastMessages(filtered, lastN),
            options.history === true
          );
          return formatConsole(
            filtered,
            buildFormatOptions(options, lastN, skipped, dropped, pageCrashedAt, {
              issues,
              issuesDropped,
              tabSwitch,
              hidden,
            })
          );
        }
      );
    });
}
