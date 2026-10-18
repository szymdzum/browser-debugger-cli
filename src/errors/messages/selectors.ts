/**
 * Selector error messages.
 */

import type { IndexSource } from '@/types.js';
import { joinLines } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { detectSelectorQuoteDamage, hasAttributeSelector } from '@/utils/shellDetection.js';

import {
  type ErrorWithSuggestion,
  noMatchMessage,
  usableIndexRange,
  A11Y_NAME_QUERY_EXAMPLE,
  withLoadingHint,
  shellWord,
} from './shared.js';

/**
 * Generate element not found error with shell quote detection and CDP fallback.
 *
 * Provides guidance for when high-level DOM commands fail to find elements.
 * Detects shell quote damage for attribute selectors and provides specific
 * recovery suggestions including the two-step query-then-inspect pattern.
 *
 * @param selector - CSS selector that failed (as received by the command)
 * @returns Message and context-aware suggestion
 *
 * @example
 * ```typescript
 * // Simple selector - standard suggestions
 * elementNotFoundError('#missing-element')
 *
 * // Attribute selector with shell damage detected
 * elementNotFoundError('[data-test-id=value]')
 * // Suggestion: "Shell quote handling detected: ..."
 * ```
 */
export function elementNotFoundError(selector: string): ErrorWithSuggestion {
  const message = noMatchMessage(selector);
  const discovery = [
    'Discovery path:',
    `  1. Query first:  ${sessionCommand(`bdg dom query '${selector}'`)}`,
    `  2. Then inspect: ${sessionCommand('bdg dom a11y describe 0')}`,
  ];
  const quoteCheck = detectSelectorQuoteDamage(selector);
  if (quoteCheck.damaged) {
    return {
      message,
      suggestion: joinLines(
        'Shell quote handling detected: the selector arrived without its quotes.',
        quoteCheck.details && `  ${quoteCheck.details}`,
        ...discovery
      ),
    };
  }
  if (hasAttributeSelector(selector)) {
    return {
      message,
      suggestion: joinLines(
        'Attribute selector: check that the shell kept its quotes.',
        ...discovery,
        'Or see the page structure: bdg dom a11y tree'
      ),
    };
  }
  return {
    message,
    suggestion: joinLines(
      `Check the selector syntax, or wait for the element to load (${sessionCommand('bdg peek')} shows the page state)`,
      unreachableElementsNote(selector)
    ),
  };
}

/**
 * Index out of range error.
 *
 * @param index - The index asked for
 * @param max - Highest valid index (-1 when nothing matched)
 * @returns Message and suggestion
 */
export function indexOutOfRangeError(index: number, max: number): ErrorWithSuggestion {
  const count = max + 1;
  if (count < 1) {
    return {
      message: `Index ${index} out of range (found 0 nodes)`,
      suggestion: 'Nothing matched, so there is no index to use. Check the selector',
    };
  }
  return {
    message: `Index ${index} out of range (found ${count} ${count === 1 ? 'node' : 'nodes'})`,
    suggestion: usableIndexRange(count),
  };
}

/** Where text filters can go, for selector errors. */
const SCOPED_FILTER_EXAMPLES =
  'Put the filter on the element it tests, e.g. li:has-text("Buy milk") .toggle (the .toggle in that row) or label:has-text("Name") input, or test what an element contains with :has(), e.g. li:has(label:text-is("Buy milk"))';

/** Playwright selector syntax bdg does not support (`:text()`, `>>` chains, `text=` engines, layout pseudo-classes). */
const PLAYWRIGHT_ONLY_SYNTAX =
  /:(?:text|text-matches|nth-match|left-of|right-of|above|below|near)\(|>>|^\s*(?:text|css|xpath|role|id|data-testid|internal:\w+)=/i;

/**
 * Empty (or blank) selector: the browser rejects it, so it is caught before
 * any page script runs.
 *
 * @returns Message and suggestion
 */
export function emptySelectorError(): ErrorWithSuggestion {
  return {
    message: 'Invalid CSS selector: The provided selector is empty',
    suggestion: 'Pass a selector, e.g. bdg dom query "button.primary"',
  };
}

/** A number that is no index: signed or fractional (`-1`, `+1`, `1.5`, `.5`), and no valid CSS selector either. */
const NON_INDEX_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * CSS selector rejected by the browser. Playwright-only syntax (`:text()`,
 * `>>`, `text=`) gets the filters bdg supports instead.
 *
 * @param selector - Selector as given
 * @param detail - Browser error, if any
 * @returns Message and suggestion
 */
export function invalidSelectorError(selector: string, detail?: string): ErrorWithSuggestion {
  return {
    message: `Invalid CSS selector: ${selector}${detail ? ` (${detail})` : ''}`,
    suggestion: PLAYWRIGHT_ONLY_SYNTAX.test(selector)
      ? `Playwright-only syntax is not CSS. bdg supports :has-text("…"), :text-is("…") and :visible, e.g. button:has-text("Save"), or scoped to a row or label: li:has-text("Buy milk") .toggle; or find elements by accessible name: ${A11Y_NAME_QUERY_EXAMPLE}`
      : NON_INDEX_NUMBER.test(selector)
        ? 'Indices are 0-based non-negative integers from a list command: run bdg dom query "<selector>" and use an index like 0; to match by selector, check its syntax, e.g. bdg dom query "button.primary"'
        : 'Check the selector syntax, e.g. bdg dom query "button.primary"',
  };
}

/**
 * A text or visibility filter (`:has-text()`, `:text-is()`, `:visible`)
 * inside a pseudo-class other than `:has()`, e.g. `:not(:visible)`.
 *
 * @param selector - Selector as given
 * @param filter - The misplaced filter as written
 * @returns Message and suggestion
 */
export function misplacedSelectorFilterError(
  selector: string,
  filter: string
): ErrorWithSuggestion {
  return {
    message: `${filter} can only be used on an element of the selector or inside :has(), not inside other pseudo-classes: ${selector}`,
    suggestion: `${SCOPED_FILTER_EXAMPLES}; or find elements by accessible name: ${A11Y_NAME_QUERY_EXAMPLE}`,
  };
}

/**
 * A sibling combinator (`+`, `~`) after a filtered compound: the rest of the
 * selector is matched under the filtered element, so only descendant and
 * child combinators can follow it.
 *
 * @param selector - Selector as given
 * @param combinator - The combinator found
 * @returns Message and suggestion
 */
export function siblingAfterFilterError(selector: string, combinator: string): ErrorWithSuggestion {
  return {
    message: `Only a descendant (space) or child (>) combinator can follow a text or visibility filter, not "${combinator}": ${selector}`,
    suggestion: `Put the filter on the element to match, e.g. h2 + p:has-text("x"), or scope by a common ancestor: section:has-text("x") p`,
  };
}

/**
 * A `:has()` with filters whose selector starts with a sibling combinator
 * (`:has(+ a:visible)`): its matches are searched under the element, where
 * siblings are not.
 *
 * @param selector - Selector as given
 * @param combinator - `+` or `~`
 * @returns Message and suggestion
 */
export function siblingInHasError(selector: string, combinator: string): ErrorWithSuggestion {
  return {
    message: `:has() with text or visibility filters can only look inside an element, not at its siblings ("${combinator}"): ${selector}`,
    suggestion:
      'Use a descendant or child: li:has(a:visible), li:has(> a:visible); for a sibling, put the filter on it: li + a:visible',
  };
}

/** How a selector with filters is malformed (before the browser sees it). */
const MALFORMED_SELECTOR_DETAILS = {
  'empty-in-list': () => 'a selector in the list is empty',
  'leading-combinator': (combinator: string) => `it starts with the combinator "${combinator}"`,
  'trailing-combinator': () => 'it ends with a combinator',
  'empty-has': () => ':has() has an empty selector',
  'scope-in-has': () =>
    ':has() with filters is already relative to the element; write :has(> a:visible) instead of :has(:scope > a:visible)',
} as const;

/**
 * A selector with filters that is malformed in a way bdg detects while
 * splitting it (so the error shows the selector as given, not rewritten CSS).
 *
 * @param selector - Selector as given
 * @param problem - What is wrong
 * @param combinator - The combinator, for `leading-combinator`
 * @returns Message and suggestion
 */
export function malformedSelectorError(
  selector: string,
  problem: keyof typeof MALFORMED_SELECTOR_DETAILS,
  combinator = ''
): ErrorWithSuggestion {
  return invalidSelectorError(selector, MALFORMED_SELECTOR_DETAILS[problem](combinator));
}

/**
 * `:has-text()` with empty text, which every element would match.
 *
 * @param selector - Selector as given
 * @returns Message and suggestion
 */
export function emptyTextFilterError(selector: string): ErrorWithSuggestion {
  return {
    message: `:has-text() needs the text to look for (empty text matches every element): ${selector}`,
    suggestion:
      'Give the text, e.g. button:has-text("Save"); use :text-is("") for elements without text',
  };
}

/**
 * A text filter without its text, e.g. `:has-text` or `:text-is("x"`.
 *
 * @param selector - Selector as given
 * @param filter - Filter name, e.g. ":has-text"
 * @returns Message and suggestion
 */
export function invalidSelectorFilterError(selector: string, filter: string): ErrorWithSuggestion {
  return {
    message: `${filter} needs its text in closed parentheses: ${selector}`,
    suggestion: `Quote the text, e.g. button${filter}("Save"); escape quotes inside it with a backslash`,
  };
}

/**
 * Note for a form command (fill, submit) whose index refers to results of
 * another command and hit an element it cannot act on.
 *
 * @param source - The index and the list it refers to
 * @param preview - What the cached element is, e.g. `h3 "Welcome"`
 * @returns e.g. `index 0 refers to the last dom query results ("h3": h3 "Welcome"); run bdg dom form to target form fields by index`
 */
export function otherIndexSourceNote(source: IndexSource, preview?: string): string {
  const query = source.query === undefined ? '' : `"${source.query}"`;
  const what = [query, preview].filter(Boolean).join(': ');
  return `index ${source.index} refers to the last ${source.command} results${what ? ` (${what})` : ''}; run ${sessionCommand('bdg dom form')} to target form fields by index`;
}

/** What a page holds that selectors cannot search (a cheap page check) */
export interface UnsearchedContent {
  /** Iframes whose document the page cannot read (cross-origin) */
  crossOriginFrames: boolean;
  /** `<object>`/`<embed>` elements */
  embeds: boolean;
  /** Custom elements with a closed shadow root, e.g. `x-vault#pay` (read over CDP) */
  closedShadowHosts?: string[];
  /** How many custom elements were checked, when the page has more (the check stopped early) */
  closedShadowHostsChecked?: number;
}

/** Closed shadow hosts named in a "not found" note */
const CLOSED_HOSTS_NAMED = 3;

/**
 * How to reach an element in a closed shadow root: the accessibility tree
 * holds it, and `dom fill`, `dom click` and `dom get` accept its query indices.
 *
 * @returns Line for "not found" notes
 */
function closedShadowRootHelp(): string {
  return `For an element in a closed shadow root: ${sessionCommand('bdg dom a11y query role=textbox')} (or another role), then use its index with dom fill, dom click or dom get`;
}

/**
 * The closed shadow hosts of a page, named for a "not found" note.
 *
 * @param hosts - Short names, e.g. `x-vault#pay`
 * @returns e.g. `closed shadow roots (in <x-vault>)`
 */
function closedShadowRootsPlace(hosts: string[]): string {
  const named = hosts.slice(0, CLOSED_HOSTS_NAMED).map((host) => `<${host}>`);
  const more = hosts.length > named.length ? `, +${hosts.length - named.length} more` : '';
  return `closed shadow roots (in ${named.join(', ')}${more})`;
}

/**
 * Where selectors do not reach (open shadow roots and same-origin iframes are
 * searched), and how to reach an element there instead: a closed shadow
 * root's through the accessibility tree, a cross-origin iframe's with
 * `eval --frame`. When the page was checked, only what it has is named
 * (nothing when it has none of them), and a closed host check that stopped
 * before the end of the page without finding one says so.
 *
 * @param selector - Selector that matched nothing
 * @param unsearched - What the page holds, when it was checked
 * @returns Note for "not found" suggestions (empty when nothing applies)
 */
export function unreachableElementsNote(selector: string, unsearched?: UnsearchedContent): string {
  const script = `document.querySelector(${JSON.stringify(selector)})`.replaceAll("'", `'\\''`);
  const framesHelp = `For an element in a cross-origin iframe: ${sessionCommand('bdg dom frames')}, then ${sessionCommand(`bdg eval --frame <n> '${script}'`)}`;
  if (!unsearched) {
    return joinLines(
      'Closed shadow roots, cross-origin iframes and <object>/<embed> documents are not searched.',
      closedShadowRootHelp(),
      framesHelp
    );
  }
  const closedHosts = unsearched.closedShadowHosts ?? [];
  const places = [
    closedHosts.length > 0 && closedShadowRootsPlace(closedHosts),
    unsearched.crossOriginFrames && 'cross-origin iframes',
    unsearched.embeds && '<object>/<embed> documents',
  ].filter((place): place is string => typeof place === 'string');
  const checked = unsearched.closedShadowHostsChecked;
  const stoppedEarly = checked !== undefined && closedHosts.length === 0;
  if (places.length === 0 && !stoppedEarly) return '';
  const listed =
    places.length === 1 ? places[0] : `${places.slice(0, -1).join(', ')} and ${places.at(-1)}`;
  return joinLines(
    places.length > 0 ? `The page has ${listed}, which are not searched.` : undefined,
    stoppedEarly
      ? `Closed shadow roots were looked for in the first ${checked} custom elements only (none there); selectors do not search them.`
      : undefined,
    closedHosts.length > 0 || stoppedEarly ? closedShadowRootHelp() : undefined,
    unsearched.crossOriginFrames ? framesHelp : undefined
  );
}

/**
 * "Did you mean" for a selector that is a single id or class.
 *
 * @param kind - Id or class
 * @param names - Similar names on the page
 * @returns e.g. `Did you mean #remove-backpack? (similar id on the page)`; empty without names
 */
export function similarSelectorsLine(kind: 'id' | 'class', names: string[]): string {
  if (names.length === 0) return '';
  const sigil = kind === 'id' ? '#' : '.';
  const what = kind === 'id' ? 'id' : 'class';
  const plural = names.length === 1 ? what : kind === 'id' ? 'ids' : 'classes';
  return `Did you mean ${names.map((name) => sigil + name).join(', ')}? (similar ${plural} on the page)`;
}

/**
 * A selector that would have to cross into a shadow root: selectors cannot,
 * but bdg searches open shadow roots on its own.
 *
 * @param host - The compound matching the host, and the selector after it
 * @returns e.g. `mdn-search-modal hosts a shadow root, which a selector cannot cross into; bdg searches open shadow roots itself: use "form"`
 */
export function shadowBoundaryLine(host: { compound: string; rest: string }): string {
  return `${host.compound} hosts a shadow root, which a selector cannot cross into; bdg searches open shadow roots itself: use "${host.rest}"`;
}

/** What the page says about a selector that matched nothing */
export interface NoMatchContext {
  /** Elements only its `:visible` filters excluded */
  hidden?: number;
  /** The page's `document.readyState`, when known (a hint is added while it loads) */
  readyState?: string;
  /** What the page holds that selectors cannot search, when checked */
  unsearched?: UnsearchedContent;
  /** "Did you mean" line for a single id or class ({@link similarSelectorsLine}) */
  similar?: string;
  /** A leading compound that matches a shadow host, and the selector after it */
  shadowHost?: { compound: string; rest: string };
}

/**
 * No nodes found for selector.
 *
 * @param selector - Selector as given
 * @param context - What the page says about it (hidden matches, readyState, unsearched content, similar names)
 */
export function noNodesFoundError(
  selector: string,
  context: NoMatchContext = {}
): ErrorWithSuggestion {
  const hiddenMatches = context.hidden ?? 0;
  const hidden =
    hiddenMatches > 0
      ? hiddenMatches === 1
        ? '1 element matches without :visible but is hidden (check with bdg dom layout). '
        : `${hiddenMatches} elements match without :visible but are hidden (check with bdg dom layout). `
      : '';
  const note = unreachableElementsNote(selector, context.unsearched);
  return {
    message: noMatchMessage(selector),
    suggestion: withLoadingHint(
      joinLines(
        context.similar,
        context.shadowHost && shadowBoundaryLine(context.shadowHost),
        shadowPseudoLine(selector),
        `${hidden}Verify the CSS selector is correct.`,
        note ? note : undefined
      ),
      context.readyState,
      selector
    ),
  };
}

/**
 * Advice for a selector with `::part()` or `::slotted()`, which name
 * pseudo-elements a page's stylesheet uses and never match an element.
 *
 * @param selector - Selector as given
 * @returns Line, or undefined for other selectors
 */
function shadowPseudoLine(selector: string): string | undefined {
  const part = /::part\(\s*([^)\s]+)\s*\)/.exec(selector)?.[1];
  if (part) {
    return `::part() styles a shadow part and selects nothing; bdg searches open shadow roots, so select the part itself: [part~="${part}"]`;
  }
  return /::slotted\(/.test(selector)
    ? '::slotted() selects nothing; select the slotted element itself (it is in the light DOM)'
    : undefined;
}

/**
 * Suggestion for a `--filter` word written without a `type:`.
 *
 * @param word - The word as typed, without any `!` or `-` prefix
 * @param negated - Whether the word was negated
 * @returns e.g. `Did you mean: url:access_token? (url: matches a part of the URL as shown)`
 */
export function untypedFilterWordSuggestion(word: string, negated: boolean): string {
  return `Did you mean: ${shellWord(`${negated ? '!' : ''}url:${word}`)}? (url: matches a part of the URL as shown)`;
}
