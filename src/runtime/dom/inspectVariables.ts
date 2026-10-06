/**
 * `var()` in declared values: which custom properties a value uses, which of
 * them are not set, and the value with them substituted. A fallback counts
 * only when its custom property is not set.
 */

import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';

/** One top-level `var()` of a value */
interface VarCall {
  start: number;
  end: number;
  name: string;
  fallback?: string;
}

/**
 * The top-level `var()` calls of a value.
 *
 * @param value - Value as written
 * @returns Calls in order (nested ones are inside a fallback)
 */
function varCalls(value: string): VarCall[] {
  const calls: VarCall[] = [];
  for (let start = value.indexOf('var('); start !== -1; start = value.indexOf('var(', start + 1)) {
    const end = closingParen(value, start + 3);
    const [name = '', ...fallback] = value.slice(start + 4, end).split(',');
    calls.push({
      start,
      end,
      name: name.trim(),
      ...(fallback.length > 0 && { fallback: fallback.join(',').trim() }),
    });
    start = end;
  }
  return calls;
}

/**
 * Index of the parenthesis that closes the one at `open`.
 *
 * @param text - Text
 * @param open - Index of `(`
 * @returns Index of the matching `)` (the end of the text when unbalanced)
 */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}

/**
 * The custom properties a value uses that are not set and have no fallback:
 * the fallback of an unset one is used instead (and checked in turn).
 *
 * @param value - Value as written
 * @param style - Computed styles (custom properties included)
 * @returns Names of the unset custom properties
 */
export function unsetVariables(value: string, style: StyleMap): string[] {
  return varCalls(value).flatMap((call) => {
    if (style[call.name] !== undefined) return [];
    return call.fallback !== undefined ? unsetVariables(call.fallback, style) : [call.name];
  });
}

/**
 * The custom properties a value takes its value from (fallbacks only when
 * used).
 *
 * @param value - Value as written
 * @param style - Computed styles
 * @returns Names
 */
export function usedVariables(value: string, style: StyleMap): string[] {
  return varCalls(value).flatMap((call) =>
    style[call.name] !== undefined || call.fallback === undefined
      ? [call.name]
      : usedVariables(call.fallback, style)
  );
}

/**
 * A value with its custom properties substituted.
 *
 * @param value - Value as written
 * @param style - Computed styles
 * @returns Substituted value (unset ones without fallback left as written)
 */
export function substituteVariables(value: string, style: StyleMap): string {
  let result = '';
  let last = 0;
  for (const call of varCalls(value)) {
    const set = style[call.name];
    const replacement =
      set !== undefined
        ? set.trim()
        : call.fallback !== undefined
          ? substituteVariables(call.fallback, style)
          : value.slice(call.start, call.end + 1);
    result += value.slice(last, call.start) + replacement;
    last = call.end + 1;
  }
  return result + value.slice(last);
}
