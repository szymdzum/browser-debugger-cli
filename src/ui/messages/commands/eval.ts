/**
 * Eval messages.
 */

import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { frameUrlLabel } from './shared.js';

/**
 * Suggestion for an action that failed on a page that replaced built-ins
 * bdg's page scripts use.
 *
 * @param replaced - Their dotted names (all are named)
 * @returns Suggestion naming them and a way around
 */
export function brokenByReplacedBuiltinsSuggestion(replaced: readonly string[]): string {
  return `The page replaced built-ins bdg's action script uses (${replaced.join(', ')}), which may have broken it; if so, act on the element with ${sessionCommand("bdg eval '…'")} instead`;
}

/**
 * Warning on an action when the page replaced built-ins bdg's page scripts
 * use (polyfills, old frameworks, anti-bot scripts). Names the first four;
 * the action's `replacedBuiltins` (JSON) lists them all.
 *
 * @param replaced - Their dotted names
 * @returns e.g. `the page replaced built-ins bdg's scripts use (Element.prototype.querySelectorAll); bdg found the element in its own world, but the action runs in the page's and may misbehave`
 */
export function replacedBuiltinsWarning(replaced: readonly string[]): string {
  const shown =
    replaced.slice(0, 4).join(', ') +
    (replaced.length > 4 ? `, +${replaced.length - 4} more (see --json)` : '');
  return `the page replaced built-ins bdg's scripts use (${shown}); bdg found the element in its own world, but the action runs in the page's and may misbehave`;
}

/**
 * Header of `bdg eval --frame` output naming the frame the script ran in.
 *
 * @param url - Frame URL
 * @returns e.g. `Frame: https://pay.example/`
 */
export function evalFrameLine(url: string): string {
  return `Frame: ${frameUrlLabel(url)}`;
}

/**
 * Warning on a `eval` result the browser copied because the page
 * replaced built-ins bdg's own copy uses.
 *
 * @param replaced - Their dotted names (all are named)
 * @returns e.g. `the page replaced Object.keys, so the browser copied the result: undefined, NaN, functions, DOM nodes, dates, maps and sets inside it show as null or {}`
 */
export function evalCopiedByBrowserWarning(replaced: readonly string[]): string {
  return `the page replaced ${replaced.join(', ')}, so the browser copied the result: undefined, NaN, functions, DOM nodes, dates, maps and sets inside it show as null or {}`;
}

/**
 * Warning on a `eval` result shown as its preview: the page replaced
 * built-ins bdg's copy uses and the browser could not copy it either (a
 * cycle or a BigInt inside).
 *
 * @param replaced - Their dotted names (all are named)
 * @returns Warning that the value is a shortened preview
 */
export function evalPreviewWarning(replaced: readonly string[]): string {
  return `the page replaced ${replaced.join(', ')}, and the result could not be copied (it holds a cycle or a BigInt), so it is shown as a shortened preview string; return a JSON-safe value (e.g. pick the fields you need)`;
}

/**
 * Pointer after a value cut for human output.
 *
 * @param count - Characters left out
 * @returns e.g. `… 299800 more chars (use --full)`
 */
export function moreCharsNote(count: number): string {
  return `… ${count} more chars (use --full)`;
}
