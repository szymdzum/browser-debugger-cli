/**
 * Playwright-style selector filters: `:has-text("…")`, `:text-is("…")` and
 * `:visible`.
 *
 * They are not CSS, so the selector is split here (in Node) into the CSS the
 * browser runs and the filters the page applies to its matches. They are only
 * supported at the end of the last compound of each selector in a list
 * (`li.item:has-text("x"):visible`, `a:text-is("Home"), button:visible`):
 * there they narrow down the elements the CSS part matched. Anywhere else
 * (`div:has-text("x") > button`, `:not(:visible)`) they would have to be
 * evaluated inside the browser's selector matching, which bdg cannot do.
 */

import { CommandError } from '@/errors/index.js';
import { invalidSelectorFilterError, misplacedSelectorFilterError } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Filter applied in the page to the elements the CSS part matched. */
export type SelectorFilter =
  { kind: 'has-text'; text: string } | { kind: 'text-is'; text: string } | { kind: 'visible' };

/** One selector of a selector list: the CSS to run and the filters for its matches. */
export interface SelectorPart {
  css: string;
  filters: SelectorFilter[];
}

/** Filter found in a selector, with its position. */
interface FilterMatch {
  start: number;
  end: number;
  depth: number;
  filter: SelectorFilter;
}

/** Cheap pre-check: selectors without any of the names are plain CSS. */
const FILTER_NAME_HINT = /:(?:has-text|text-is|visible)/i;

/** A filter name at a given position (sticky). */
const FILTER_NAME = /:(has-text|text-is|visible)(?![\w-])/iy;

/** CSS ending in a (not escaped) combinator still needs an element selector. */
const ENDS_IN_COMBINATOR = /(^|[^\\])[\s>+~]$/;

/**
 * Split a selector into the CSS part and filters of each selector of its
 * list.
 *
 * @param selector - Selector as the user gave it
 * @returns The parts, or null for plain CSS (no filters anywhere), which runs unchanged
 * @throws CommandError (81) for a filter that is not at the end, or a malformed one
 */
export function parseSelectorFilters(selector: string): SelectorPart[] | null {
  if (!FILTER_NAME_HINT.test(selector)) return null;
  const parts = splitSelectorList(selector).map((part) => parsePart(part, selector));
  return parts.some((part) => part.filters.length > 0) ? parts : null;
}

/**
 * Split a selector list at its top-level commas (not inside quotes,
 * attribute brackets or parentheses).
 *
 * @param selector - Selector list
 * @returns The selectors, untrimmed
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let partStart = 0;
  scan(selector, (index, depth) => {
    if (selector[index] !== ',' || depth > 0) return index;
    parts.push(selector.slice(partStart, index));
    partStart = index + 1;
    return index;
  });
  parts.push(selector.slice(partStart));
  return parts;
}

/**
 * Walk a selector, calling `visit` for every character outside quotes,
 * escapes and attribute brackets, with the parenthesis depth.
 *
 * @param text - Selector text
 * @param visit - Returns the index to continue after (to skip what it consumed)
 */
function scan(text: string, visit: (index: number, depth: number) => number): void {
  let depth = 0;
  let inBrackets = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i++;
    } else if (char === '"' || char === "'") {
      i = quotedEnd(text, i) - 1;
    } else if (inBrackets) {
      inBrackets = char !== ']';
    } else if (char === '[') {
      inBrackets = true;
    } else if (char === '(' || char === ')') {
      depth += char === '(' ? 1 : -1;
    } else {
      i = visit(i, depth);
    }
  }
}

/**
 * End of a quoted string.
 *
 * @param text - Text containing the string
 * @param start - Index of the opening quote
 * @returns Index after the closing quote, or the text length when unterminated
 */
function quotedEnd(text: string, start: number): number {
  const end = closingQuote(text, start);
  return end === -1 ? text.length : end + 1;
}

/**
 * Index of the quote closing the string opened at `start` (backslash escapes skipped).
 *
 * @param text - Text containing the string
 * @param start - Index of the opening quote
 * @returns Index of the closing quote, or -1 when unterminated
 */
function closingQuote(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === text[start]) return i;
  }
  return -1;
}

/**
 * Split one selector of a list into its CSS part and trailing filters.
 *
 * @param part - One selector of the list
 * @param selector - Whole selector, for error messages
 * @returns CSS part (`*` when only filters are given) and filters
 * @throws CommandError (81) when a filter is not at the end
 */
function parsePart(part: string, selector: string): SelectorPart {
  const matches = findFilters(part, selector);
  const first = matches[0];
  if (!first) return { css: part.trim(), filters: [] };
  const misplaced = matches.find(
    (match, i) => match.depth > 0 || match.end !== (matches[i + 1]?.start ?? part.trimEnd().length)
  );
  if (misplaced) {
    const err = misplacedSelectorFilterError(selector, part.slice(misplaced.start, misplaced.end));
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const css = part.slice(0, first.start);
  const needsElement = css.trim() === '' || ENDS_IN_COMBINATOR.test(css);
  return {
    css: (needsElement ? `${css}*` : css).trim(),
    filters: matches.map((match) => match.filter),
  };
}

/**
 * Find every filter in a selector (at any parenthesis depth, outside quotes
 * and attribute brackets).
 *
 * @param part - One selector of a list
 * @param selector - Whole selector, for error messages
 * @returns Filters in order
 */
function findFilters(part: string, selector: string): FilterMatch[] {
  const matches: FilterMatch[] = [];
  scan(part, (index, depth) => {
    FILTER_NAME.lastIndex = index;
    const name = FILTER_NAME.exec(part)?.[1]?.toLowerCase();
    if (!name) return index;
    const nameEnd = FILTER_NAME.lastIndex;
    const { filter, end } =
      name === 'visible'
        ? { filter: { kind: 'visible' } as const, end: nameEnd }
        : readTextFilter(part, nameEnd, name, selector);
    matches.push({ start: index, end, depth, filter });
    return end - 1;
  });
  return matches;
}

/**
 * Read the `("text")` argument of a text filter.
 *
 * @param part - Selector text
 * @param start - Index after the filter name
 * @param name - `has-text` or `text-is`
 * @param selector - Whole selector, for error messages
 * @returns The filter (text whitespace-normalized) and the index after it
 * @throws CommandError (81) when the argument is missing or not closed
 */
function readTextFilter(
  part: string,
  start: number,
  name: string,
  selector: string
): { filter: SelectorFilter; end: number } {
  const argument = part[start] === '(' ? readArgument(part, start + 1) : null;
  if (!argument) {
    const err = invalidSelectorFilterError(selector, `:${name}`);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const text = argument.text.replace(/\s+/g, ' ').trim();
  const filter: SelectorFilter =
    name === 'has-text'
      ? { kind: 'has-text', text: text.toLowerCase() }
      : { kind: 'text-is', text };
  return { filter, end: argument.end };
}

/**
 * Read a filter argument: a single- or double-quoted string (backslash
 * escapes allowed) or unquoted text, up to the closing parenthesis.
 *
 * @param part - Selector text
 * @param start - Index after the opening parenthesis
 * @returns Argument text and the index after the closing parenthesis, or null when malformed
 */
function readArgument(part: string, start: number): { text: string; end: number } | null {
  const valueStart = start + (part.slice(start).length - part.slice(start).trimStart().length);
  const quote = part[valueStart];
  if (quote === '"' || quote === "'") {
    const close = closingQuote(part, valueStart);
    const after = close === -1 ? -1 : part.indexOf(')', close);
    if (after === -1 || part.slice(close + 1, after).trim() !== '') return null;
    return { text: part.slice(valueStart + 1, close).replace(/\\(.)/gs, '$1'), end: after + 1 };
  }
  const close = matchingParenthesis(part, start);
  return close === -1 ? null : { text: part.slice(start, close), end: close + 1 };
}

/**
 * Index of the parenthesis closing an unquoted argument (nested pairs skipped).
 *
 * @param part - Selector text
 * @param start - Index after the opening parenthesis
 * @returns Index of the closing parenthesis, or -1 when there is none
 */
function matchingParenthesis(part: string, start: number): number {
  let depth = 0;
  for (let i = start; i < part.length; i++) {
    if (part[i] === '(') depth++;
    else if (part[i] === ')' && depth-- === 0) return i;
  }
  return -1;
}
