/**
 * Bounds of a `dom eval --json` result (#478): one eval must not put
 * megabytes into an agent's context.
 */

import { EVAL_JSON_ARRAY_LIMIT, MAX_VALUE_LENGTH } from '@/constants.js';
import { capLength } from '@/utils/strings.js';

/** The `result` of `dom eval --json`, and what was left out of it */
export interface BoundedEvalResult {
  /** The value, its first elements, or the start of its (JSON) text */
  result: unknown;
  /** Elements of an array result, set only when it was bounded */
  count?: number;
  /** Elements left out of a listed array result */
  omitted?: number;
  /** Length of the string or JSON text `result` was cut from */
  truncatedFrom?: number;
}

/**
 * Bound an eval result for JSON output: a string is cut to
 * {@link MAX_VALUE_LENGTH} characters, an array keeps its first
 * {@link EVAL_JSON_ARRAY_LIMIT} elements (with `count` and `omitted`), and
 * an object or array whose JSON is still longer than the cap becomes the
 * start of its JSON text (with `truncatedFrom`), so the output stays valid
 * JSON. Small values are returned as they are.
 *
 * @param value - Evaluated value
 * @param length - Elements of an array result in the page (its copy may hold fewer)
 * @returns `result`, with what was left out when bounded
 */
export function boundEvalResult(value: unknown, length?: number): BoundedEvalResult {
  if (typeof value === 'string') {
    const { text, truncatedFrom } = capLength(value, MAX_VALUE_LENGTH);
    return { result: text, ...(truncatedFrom !== undefined && { truncatedFrom }) };
  }
  if (Array.isArray(value)) {
    const count = length ?? value.length;
    const listed = value.slice(0, EVAL_JSON_ARRAY_LIMIT);
    if (!fitsCap(listed)) return { ...jsonStart(value), count };
    return listed.length < count
      ? { result: listed, count, omitted: count - listed.length }
      : { result: value };
  }
  if (value !== null && typeof value === 'object' && !fitsCap(value)) return jsonStart(value);
  return { result: value };
}

/**
 * Whether a value's JSON text is at most {@link MAX_VALUE_LENGTH} characters.
 *
 * @param value - Object or array
 * @returns True when it fits
 */
function fitsCap(value: object): boolean {
  return JSON.stringify(value).length <= MAX_VALUE_LENGTH;
}

/**
 * The first {@link MAX_VALUE_LENGTH} characters of a value's JSON text.
 *
 * @param value - Object or array over the cap
 * @returns The start of its JSON text, and the length of all of it
 */
function jsonStart(value: object): { result: string; truncatedFrom: number } {
  const json = JSON.stringify(value);
  return { result: capLength(json, MAX_VALUE_LENGTH).text, truncatedFrom: json.length };
}
