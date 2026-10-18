/**
 * Tab error messages.
 */

import type { TabRef } from '@/ipc/protocol/tabTypes.js';
import { joinLines } from '@/ui/formatting.js';
import { tabClosedText } from '@/ui/messages/commands.js';
import { sessionCommand, startSessionSuggestion } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion } from './shared.js';

/** A tab as error messages list it */
interface ListedTab {
  index: number;
  url: string;
}

/** The tab commands that take a target */
export type TabCommand = 'switch' | 'close';

/**
 * The tabs listed one per line, e.g. `  [1] http://localhost/popup`.
 *
 * @param tabs - Tabs
 * @returns Lines
 */
function tabLines(tabs: readonly ListedTab[]): string[] {
  return tabs.map((tab) => `  [${tab.index}] ${tab.url}`);
}

/**
 * `bdg page switch|close <index>` with an index past the last tab.
 *
 * @param index - Index given
 * @param tabs - Open tabs
 * @returns Message and suggestion
 */
export function tabIndexOutOfRangeError(
  index: number,
  tabs: readonly ListedTab[]
): ErrorWithSuggestion {
  return {
    message: `Tab index ${index} out of range (${tabs.length === 1 ? '1 tab: the only index is 0' : `${tabs.length} tabs: 0-${tabs.length - 1}`})`,
    suggestion: joinLines(
      'Open tabs:',
      ...tabLines(tabs),
      `List them with: ${sessionCommand('bdg page tabs')}`
    ),
  };
}

/**
 * `bdg page switch|close <url-part>` that no tab URL contains.
 *
 * @param part - Text given
 * @param tabs - Open tabs
 * @param similar - Closest URL parts, best first
 * @param command - The command given, which the suggestions name
 * @returns Message and suggestion
 */
export function tabNotFoundError(
  part: string,
  tabs: readonly ListedTab[],
  similar: readonly string[],
  command: TabCommand = 'switch'
): ErrorWithSuggestion {
  return {
    message: `No tab URL contains "${part}"`,
    suggestion: joinLines(
      similar[0] !== undefined &&
        `Did you mean: ${sessionCommand(`bdg page ${command} ${similar[0]}`)}?`,
      'Open tabs:',
      ...tabLines(tabs),
      `${command === 'switch' ? 'Switch' : 'Close'} by index: ${sessionCommand(`bdg page ${command} <index>`)}`
    ),
  };
}

/**
 * `bdg page switch|close <url-part>` that several tab URLs contain.
 *
 * @param part - Text given
 * @param matches - Tabs whose URL contains it
 * @param command - The command given, which the suggestion names
 * @returns Message and suggestion
 */
export function tabAmbiguousError(
  part: string,
  matches: readonly ListedTab[],
  command: TabCommand = 'switch'
): ErrorWithSuggestion {
  return {
    message: `"${part}" matches ${matches.length} tabs`,
    suggestion: joinLines(
      ...tabLines(matches),
      `Pick one by index, e.g. ${sessionCommand(`bdg page ${command} ${matches[0]?.index ?? 0}`)}`
    ),
  };
}

/**
 * The first action after the session's tab closed on its own (e.g. a popup's
 * timer called `window.close()`) and the session moved to another tab
 * without a command reporting it: the action was meant for the closed tab,
 * so it is not run on the other one.
 *
 * @param closed - The tab that closed
 * @param current - The tab the session moved to
 * @returns Message and suggestion
 */
export function actionAfterTabMoveError(closed: TabRef, current: TabRef): ErrorWithSuggestion {
  return {
    message: `${tabClosedText(closed, current)}. The action was not run: it was meant for the tab that closed`,
    suggestion: `Run it again to act on the current tab, or list the tabs with: ${sessionCommand('bdg page tabs')}`,
  };
}

/** What an interrupted `bdg page switch` did, as far as the command knows */
type InterruptedSwitchOutcome =
  | { tab: { index: number; url: string }; switched: boolean }
  | { error: string }
  | { unknown: string }
  | undefined;

/**
 * `bdg page switch` interrupted by Ctrl-C or SIGTERM: the command waited for
 * the daemon's answer, so it says whether the session moved.
 *
 * @param signal - The signal
 * @param outcome - The daemon's answer: the tab switched to (`switched`
 *   false when the session already was on it), the switch's error, why no
 *   answer came (`unknown`: the switch may still have completed), or
 *   nothing when the request was never sent
 * @returns Message and suggestion
 */
export function pageSwitchInterruptedError(
  signal: 'SIGINT' | 'SIGTERM',
  outcome: InterruptedSwitchOutcome
): ErrorWithSuggestion {
  const how = signal === 'SIGINT' ? 'Interrupted (Ctrl-C)' : 'Terminated (SIGTERM)';
  return {
    message: `${how}${interruptedSwitchText(outcome)}`,
    suggestion: `The session tab is marked * in: ${sessionCommand('bdg page tabs')}`,
  };
}

/**
 * What an interrupted switch did, after "Interrupted (Ctrl-C)".
 *
 * @param outcome - See {@link pageSwitchInterruptedError}
 * @returns Text
 */
function interruptedSwitchText(outcome: InterruptedSwitchOutcome): string {
  if (outcome === undefined) return ' before the switch was sent; the session did not switch';
  if ('error' in outcome) return `; the session did not switch (${outcome.error})`;
  if ('unknown' in outcome) {
    return `; no answer came, so it is not known whether the session switched (${outcome.unknown})`;
  }
  const where = `tab ${outcome.tab.index}: ${outcome.tab.url}`;
  return outcome.switched
    ? `, but the switch completed: now on ${where}`
    : `; the session was already on ${where}`;
}

/**
 * `bdg page close` of the session's tab when there is no other tab to move to.
 *
 * @returns Message and suggestion
 */
export function lastTabCloseError(): ErrorWithSuggestion {
  return {
    message: 'This is the only tab: closing it would end the session',
    suggestion: `End the session with: ${sessionCommand('bdg stop')}`,
  };
}

/**
 * A tab bdg could not connect to.
 *
 * @param url - The tab's URL
 * @param reason - Why the connection failed
 * @param attached - Whether the session is attached to a running Chrome (--chrome-ws-url)
 * @returns Message and suggestion
 */
export function tabConnectFailedError(
  url: string,
  reason: string,
  attached: boolean
): ErrorWithSuggestion {
  return {
    message: `Could not switch to ${url}: ${reason}`,
    suggestion: attached
      ? 'The attached Chrome must serve page WebSockets (/devtools/page/<id>) for its other tabs; the session stays on its tab'
      : `The session stays on its tab; list tabs with: ${sessionCommand('bdg page tabs')}`,
  };
}

/**
 * A switch that failed, after which the session could not go back to its tab.
 *
 * @param cause - Why the switch failed
 * @param resumeError - Why the old tab could not be followed again
 * @returns Message and suggestion
 */
export function sessionEndedAfterFailedSwitchError(
  cause: string,
  resumeError: string
): ErrorWithSuggestion {
  return {
    message: `The tab switch failed (${cause}) and the session could not go back to its tab (${resumeError}); the session ended`,
    suggestion: startSessionSuggestion(),
  };
}

/**
 * The tab commands when Chrome refused target discovery.
 *
 * @param reason - Chrome's answer
 * @returns Message and suggestion
 */
export function tabsUnavailableError(reason: string): ErrorWithSuggestion {
  return {
    message: `Tabs are not tracked in this session: ${reason}`,
    suggestion: `List the targets with: ${sessionCommand('bdg cdp Target.getTargets')}`,
  };
}
