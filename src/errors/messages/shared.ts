/**
 * Shared error messages.
 */

import { joinLines } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/** Start of the message for a selector that matches nothing (page scripts put the selector between this and {@link NO_MATCH_SUFFIX}) */
export const NO_MATCH_PREFIX = 'No nodes found matching "';

/** End of the message for a selector that matches nothing */
export const NO_MATCH_SUFFIX = '"';

/**
 * The one message for a selector that matches nothing, on every command
 * that takes a selector.
 *
 * @param selector - Selector as given
 * @returns e.g. `No nodes found matching "#nothing"`
 */
export function noMatchMessage(selector: string): string {
  return `${NO_MATCH_PREFIX}${selector}${NO_MATCH_SUFFIX}`;
}

/**
 * Error with suggestion pair for CommandError usage.
 */
export interface ErrorWithSuggestion {
  message: string;
  suggestion: string;
}

/**
 * Which indices a list of `count` entries accepts, as the start of a suggestion.
 *
 * @param count - Entries in the list (at least 1)
 * @returns `Here the only index is 0` or `Use an index between 0 and N`
 */
export function usableIndexRange(count: number): string {
  return count === 1 ? 'Here the only index is 0' : `Use an index between 0 and ${count - 1}`;
}

/** Finding elements by accessible name, quoted for the shell (the name may contain spaces and colons). */
export const A11Y_NAME_QUERY_EXAMPLE = "bdg dom a11y query 'name=…'";

/**
 * Quote a value for a POSIX shell command line.
 *
 * @param value - Value
 * @returns The value in single quotes
 */
export function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/** Characters a shell passes through unquoted */
export const SHELL_SAFE_WORD = /^[\w@%+=:,./-]+$/;

/**
 * A word as a shell command line takes it: as is when safe, otherwise quoted.
 *
 * @param word - Word
 * @returns The word to write
 */
export function shellWord(word: string): string {
  return SHELL_SAFE_WORD.test(word) ? word : shellQuote(word);
}

/**
 * Hint for something not found while the page has not finished loading.
 *
 * @param readyState - The page's `document.readyState` (not `complete`)
 * @param selector - Selector that matched nothing, if any
 * @returns e.g. `The page is still loading (document.readyState: loading); wait for the element with: bdg dom wait '#login'`
 */
export function pageStillLoadingHint(readyState: string, selector?: string): string {
  const wait =
    selector !== undefined && selector.trim() !== ''
      ? `wait for the element with: ${sessionCommand(`bdg dom wait ${shellQuote(selector)}`)}`
      : `wait for it with: ${sessionCommand('bdg dom wait --load')}`;
  return `The page is still loading (document.readyState: ${readyState}); ${wait}`;
}

/**
 * Put the still-loading hint before a "not found" suggestion when the page
 * has not finished loading.
 *
 * @param suggestion - Suggestion of the error
 * @param readyState - The page's `document.readyState`, if known
 * @param selector - Selector that matched nothing, if any
 * @returns The suggestion, with the hint first while the page loads
 */
export function withLoadingHint(
  suggestion: string,
  readyState: string | undefined,
  selector?: string
): string {
  if (readyState === undefined || readyState === 'complete') return suggestion;
  return joinLines(pageStillLoadingHint(readyState, selector), suggestion || undefined);
}
