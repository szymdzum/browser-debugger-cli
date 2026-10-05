/**
 * Playwright-style selector filters: `:has-text("…")`, `:text-is("…")` and
 * `:visible`.
 *
 * They are not CSS, so the selector is split here (in Node) into the CSS the
 * browser runs and the filters the page applies to its matches. A filter
 * applies to the compound it is written in (`li.item:has-text("x"):visible`,
 * `a:visible.active`). On the last compound it narrows down the matches; on an
 * earlier one it scopes the rest of the selector, which is then matched under
 * each element passing the filter: `li:has-text("Buy milk") .toggle` is the
 * `.toggle` inside the row that says "Buy milk". Only descendant and child
 * combinators can follow a filtered compound. Inside `:has()` filters test
 * what an element contains (`li:has(label:text-is("x"))`); inside other
 * pseudo-classes (`:not(:visible)`) they would have to be evaluated by the
 * browser's selector matching, which bdg cannot do.
 */

import { CommandError } from '@/errors/index.js';
import {
  emptyTextFilterError,
  invalidSelectorError,
  invalidSelectorFilterError,
  misplacedSelectorFilterError,
  siblingAfterFilterError,
} from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Filter applied in the page to the elements the CSS part matched. */
export type SelectorFilter =
  | { kind: 'has-text'; text: string }
  | { kind: 'text-is'; text: string }
  | { kind: 'visible' }
  | { kind: 'has'; selectors: ScopedStep[][] };

/** Combinators a scoped step can follow: descendant (` `) and child (`>`). */
export type ScopeCombinator = ' ' | '>';

/** CSS matched under a scope element (`:scope <combinator> <css>`), then filtered. */
export interface ScopedStep {
  combinator: ScopeCombinator;
  css: string;
  filters: SelectorFilter[];
}

/**
 * One selector of a selector list: the CSS to run and the filters for its
 * matches; `steps` (when a filtered compound is not the last) are matched
 * under each of them in turn, and the last step's matches are the result.
 */
export interface SelectorPart {
  css: string;
  filters: SelectorFilter[];
  steps?: ScopedStep[];
}

/** Filter found in a compound, with its position. */
interface FilterMatch {
  start: number;
  end: number;
  depth: number;
  filter: SelectorFilter;
}

/** Compound selector text and the combinator before it (`''` for none). */
interface RawCompound {
  combinator: string;
  text: string;
}

/** Cheap pre-check: selectors without any of the names are plain CSS. */
const FILTER_NAME_HINT = /:(?:has-text|text-is|visible)/i;

/** A filter name at a given position (sticky). */
const FILTER_NAME = /:(has-text|text-is|visible)(?![\w-])/iy;

/** `:has(` at a given position (sticky). */
const HAS_OPEN = /:has\(/iy;

/** Characters that form combinators between compounds. */
const COMBINATOR_CHAR = /[\s>+~]/;

/**
 * Split a selector into the CSS part and filters of each selector of its
 * list.
 *
 * @param selector - Selector as the user gave it
 * @returns The parts, or null for plain CSS (no filters anywhere), which runs unchanged
 * @throws CommandError (81) for a misplaced or malformed filter
 */
export function parseSelectorFilters(selector: string): SelectorPart[] | null {
  if (!FILTER_NAME_HINT.test(selector)) return null;
  const parts = splitSelectorList(selector).map((part) => parsePart(part, selector));
  return parts.some((part) => part.filters.length > 0) ? parts : null;
}

/**
 * The parts with every `:visible` filter removed, to count what only
 * visibility excluded.
 *
 * @param parts - Parsed selector parts
 * @returns Parts without `:visible`, or null when they have none
 */
export function withoutVisibleFilters(parts: SelectorPart[]): SelectorPart[] | null {
  const json = JSON.stringify(parts);
  if (!json.includes('"kind":"visible"')) return null;
  return JSON.parse(json, (key, value: unknown) =>
    key === 'filters' && Array.isArray(value)
      ? value.filter((filter: SelectorFilter) => filter.kind !== 'visible')
      : value
  ) as SelectorPart[];
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
 * Walk a selector, calling `visit` at every token start outside quoted
 * strings, escapes and attribute brackets (whose insides are skipped), with
 * the parenthesis depth (for `)`, the depth inside it).
 *
 * @param text - Selector text
 * @param visit - Returns the index to continue after (`index` to let scan handle the character)
 */
function scan(text: string, visit: (index: number, depth: number) => number): void {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const next = visit(i, depth);
    if (next !== i) {
      i = next;
      continue;
    }
    const char = text[i];
    if (char === '\\') i++;
    else if (char === '"' || char === "'") i = quotedEnd(text, i) - 1;
    else if (char === '[') i = bracketEnd(text, i) - 1;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
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
 * End of an attribute selector (quotes and escapes inside skipped).
 *
 * @param text - Text containing it
 * @param start - Index of the `[`
 * @returns Index after the `]`, or the text length when unterminated
 */
function bracketEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === '"' || char === "'") i = quotedEnd(text, i) - 1;
    else if (char === ']') return i + 1;
  }
  return text.length;
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
 * Index of the parenthesis closing the one at `open` (quotes, escapes and
 * attribute brackets skipped).
 *
 * @param text - Selector text
 * @param open - Index of the `(`
 * @returns Index of the `)`, or -1 when it is not closed
 */
function closingParenthesis(text: string, open: number): number {
  let close = -1;
  scan(text.slice(open), (index, depth) => {
    if (close !== -1 || text[open + index] !== ')' || depth !== 1) return index;
    close = open + index;
    return text.length;
  });
  return close;
}

/**
 * Throw an exit-81 error.
 *
 * @param err - Message and suggestion
 * @throws CommandError (81)
 */
function reject(err: { message: string; suggestion: string }): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Parse one selector of a list.
 *
 * @param part - One selector of the list
 * @param selector - Whole selector, for error messages
 * @returns CSS and filters of its first step, and the scoped steps after it
 * @throws CommandError (81) for an empty selector or misplaced filters
 */
function parsePart(part: string, selector: string): SelectorPart {
  if (part.trim() === '') reject(invalidSelectorError(selector, 'a selector in the list is empty'));
  if (!FILTER_NAME_HINT.test(part)) return { css: part.trim(), filters: [] };
  const { leading, steps } = parseChain(part, selector);
  if (leading) reject(invalidSelectorError(selector, `it starts with the combinator "${leading}"`));
  const [first, ...rest] = steps;
  return {
    css: first?.css ?? '*',
    filters: first?.filters ?? [],
    ...(rest.length > 0 && { steps: rest }),
  };
}

/**
 * Parse a complex selector into steps that end at each filtered compound.
 *
 * @param text - Selector (may start with a combinator inside `:has()`)
 * @param selector - Whole selector, for error messages
 * @returns The leading combinator (`''` for none) and the steps
 * @throws CommandError (81) for a sibling combinator after a filter, or a trailing combinator
 */
function parseChain(text: string, selector: string): { leading: string; steps: ScopedStep[] } {
  const compounds = splitCompounds(text.trim(), selector);
  const leading = compounds[0]?.combinator ?? '';
  const steps: ScopedStep[] = [];
  let combinator: ScopeCombinator = ' ';
  let css = '';
  compounds.forEach((compound, i) => {
    const parsed = parseCompound(compound.text, selector);
    css += css ? joinCombinator(compound.combinator) + parsed.css : parsed.css;
    const next = compounds[i + 1];
    if (parsed.filters.length === 0 && next) return;
    steps.push({ combinator, css, filters: parsed.filters });
    css = '';
    if (!next) return;
    if (next.combinator !== ' ' && next.combinator !== '>') {
      reject(siblingAfterFilterError(selector, next.combinator));
    }
    combinator = next.combinator;
  });
  return { leading, steps };
}

/**
 * Combinator as written between two compounds of the CSS.
 *
 * @param combinator - ` `, `>`, `+` or `~`
 * @returns The combinator with surrounding spaces
 */
function joinCombinator(combinator: string): string {
  return combinator === ' ' ? ' ' : ` ${combinator} `;
}

/**
 * Split a complex selector into its compounds at top-level combinators.
 *
 * @param text - Trimmed selector
 * @param selector - Whole selector, for error messages
 * @returns Compounds with the combinator before each (`''` for the first, unless it leads)
 * @throws CommandError (81) when the selector ends with a combinator
 */
function splitCompounds(text: string, selector: string): RawCompound[] {
  const compounds: RawCompound[] = [];
  let combinator = '';
  let start = -1;
  scan(text, (index, depth) => {
    const char = text[index] ?? '';
    if (depth > 0 || !COMBINATOR_CHAR.test(char)) {
      if (start === -1) start = index;
      return index;
    }
    if (start !== -1) {
      compounds.push({ combinator, text: text.slice(start, index) });
      start = -1;
      combinator = ' ';
    }
    if (char.trim() && !combinator.trim()) combinator = char;
    return index;
  });
  if (start === -1) reject(invalidSelectorError(selector, 'it ends with a combinator'));
  compounds.push({ combinator, text: text.slice(start) });
  return compounds;
}

/**
 * Take the filters (and `:has()` containing filters) out of a compound.
 *
 * @param text - Compound selector
 * @param selector - Whole selector, for error messages
 * @returns The compound's CSS (`*` when only filters are given) and its filters
 * @throws CommandError (81) for a filter inside another pseudo-class
 */
function parseCompound(text: string, selector: string): { css: string; filters: SelectorFilter[] } {
  if (!FILTER_NAME_HINT.test(text)) return { css: text, filters: [] };
  const hasFilters = findHasFilters(text, selector);
  const inHas = (match: FilterMatch): boolean =>
    hasFilters.some((has) => match.start >= has.start && match.end <= has.end);
  const filters = findFilters(text, selector).filter((match) => !inHas(match));
  const misplaced = filters.find((match) => match.depth > 0);
  if (misplaced) {
    reject(misplacedSelectorFilterError(selector, text.slice(misplaced.start, misplaced.end)));
  }
  const removed = [...hasFilters, ...filters].sort((a, b) => a.start - b.start);
  let css = '';
  let position = 0;
  for (const match of removed) {
    css += text.slice(position, match.start);
    position = match.end;
  }
  css += text.slice(position);
  return { css: css || '*', filters: removed.map((match) => match.filter) };
}

/**
 * Find the top-level `:has()` of a compound whose argument uses filters.
 *
 * @param text - Compound selector
 * @param selector - Whole selector, for error messages
 * @returns The `:has()` filters with their positions
 */
function findHasFilters(text: string, selector: string): FilterMatch[] {
  const matches: FilterMatch[] = [];
  scan(text, (index, depth) => {
    HAS_OPEN.lastIndex = index;
    if (depth > 0 || !HAS_OPEN.test(text)) return index;
    const open = HAS_OPEN.lastIndex - 1;
    const close = closingParenthesis(text, open);
    if (close === -1) return index;
    const filter = parseHasArgument(text.slice(open + 1, close), selector);
    if (filter) matches.push({ start: index, end: close + 1, depth, filter });
    return filter ? close : index;
  });
  return matches;
}

/**
 * Parse the relative selector list of a `:has()` that may use filters.
 *
 * @param argument - Text between the parentheses
 * @param selector - Whole selector, for error messages
 * @returns The `has` filter, or null when the argument is plain CSS
 * @throws CommandError (81) for a sibling combinator (`:has(+ x)`)
 */
function parseHasArgument(argument: string, selector: string): SelectorFilter | null {
  if (!FILTER_NAME_HINT.test(argument)) return null;
  const selectors = splitSelectorList(argument).map((relative) => {
    if (relative.trim() === '')
      reject(invalidSelectorError(selector, ':has() has an empty selector'));
    const { leading, steps } = parseChain(relative, selector);
    if (leading && leading !== '>') reject(siblingAfterFilterError(selector, leading));
    const [first, ...rest] = steps;
    return first ? [{ ...first, combinator: (leading || ' ') as ScopeCombinator }, ...rest] : [];
  });
  const usesFilters = selectors.some((chain) => chain.some((step) => step.filters.length > 0));
  return usesFilters ? { kind: 'has', selectors } : null;
}

/**
 * Find every text and visibility filter in a compound (at any parenthesis
 * depth, outside quotes and attribute brackets).
 *
 * @param part - Compound selector
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
 * @throws CommandError (81) when the argument is missing or not closed, or `:has-text` is empty
 */
function readTextFilter(
  part: string,
  start: number,
  name: string,
  selector: string
): { filter: SelectorFilter; end: number } {
  const argument = part[start] === '(' ? readArgument(part, start + 1) : null;
  if (!argument) reject(invalidSelectorFilterError(selector, `:${name}`));
  const text = argument.text.replace(/\s+/g, ' ').trim();
  if (name === 'has-text' && text === '') reject(emptyTextFilterError(selector));
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
