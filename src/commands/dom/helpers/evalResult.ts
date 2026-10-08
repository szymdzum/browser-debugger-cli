/**
 * Bounds of a `dom eval --json` result (#478): one eval must not put
 * megabytes into an agent's context.
 */

import { EVAL_JSON_ARRAY_LIMIT, MAX_VALUE_LENGTH } from '@/constants.js';
import { capLength } from '@/utils/strings.js';

/**
 * The `result` of `dom eval --json`, and what was left out of it. A string
 * `result` with `truncatedFrom` while `type` is `object` is the start of
 * the value's JSON text, not a string the script returned.
 */
export interface BoundedEvalResult {
  /** The value, its first elements, or the start of its (JSON) text */
  result: unknown;
  /** Elements of an array result in the page, set only when it was bounded */
  count?: number;
  /** Elements left out of a listed array result */
  omitted?: number;
  /**
   * Length of the string, or of the JSON text of the copied object or array
   * (which holds at most 1000 entries per list or object), `result` was cut from
   */
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
 * @param value - Evaluated value, as copied from the page
 * @param length - Elements of an array result in the page (its copy may hold fewer)
 * @returns `result`, with what was left out when bounded
 */
export function boundEvalResult(value: unknown, length?: number): BoundedEvalResult {
  if (typeof value === 'string') {
    const { text, truncatedFrom } = capLength(value, MAX_VALUE_LENGTH);
    return { result: text, ...(truncatedFrom !== undefined && { truncatedFrom }) };
  }
  if (Array.isArray(value)) return boundArray(value, length ?? value.length);
  if (value === null || typeof value !== 'object') return { result: value };
  const json = JSON.stringify(value);
  return json.length > MAX_VALUE_LENGTH ? jsonStart(json) : { result: value };
}

/**
 * Bound an array result: its first {@link EVAL_JSON_ARRAY_LIMIT} elements,
 * or the start of its JSON text when even those are over the cap.
 *
 * @param value - Array result
 * @param count - Elements of the array in the page
 * @returns `result` with `count`, and `omitted` or `truncatedFrom`
 */
function boundArray(value: unknown[], count: number): BoundedEvalResult {
  const listed = value.slice(0, EVAL_JSON_ARRAY_LIMIT);
  const listedJson = JSON.stringify(listed);
  if (listedJson.length > MAX_VALUE_LENGTH) {
    const json = listed.length === value.length ? listedJson : JSON.stringify(value);
    return { ...jsonStart(json), count };
  }
  return listed.length < count
    ? { result: listed, count, omitted: count - listed.length }
    : { result: value };
}

/**
 * The first {@link MAX_VALUE_LENGTH} characters of a JSON text.
 *
 * @param json - JSON text of an object or array over the cap
 * @returns Its start, and the length of all of it
 */
function jsonStart(json: string): { result: string; truncatedFrom: number } {
  return { result: capLength(json, MAX_VALUE_LENGTH).text, truncatedFrom: json.length };
}
