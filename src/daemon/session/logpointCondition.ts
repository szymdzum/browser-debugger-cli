/**
 * The page-side code of a logpoint: the condition of its breakpoint, which
 * logs and answers `false` so the page never pauses (#848).
 *
 * The condition is a fixed template. What the daemon puts into it is data
 * encoded with `JSON.stringify` (the logpoint id, the limit, the names of the
 * binding and the page-side state), except the expressions and the guard:
 * they are the user's own code to run in the page at that line, which is the
 * feature, and must be inline to see the line's variables. Each is first
 * compiled alone as a parenthesized expression (`Runtime.compileScript`, see
 * `logpoints.ts`), so a typo fails before anything is bound, and each sits on
 * its own lines inside `(…)`, so a trailing `//` comment cannot swallow what follows.
 * A hit also reports the stack frame of the condition itself, whose `eval at
 * … (script URL:line:column)` names the script it ran in; an error is reported
 * the same way, at most `max` of them. Each expression has its own try/catch, so
 * one that throws does not hide the others.
 */

/** Name of the binding the condition reports hits through (a page global) */
export const LOGPOINT_BINDING = '__bdg_lp_7c1f';

/** Page global holding the counters `{ [id]: { hits, errors, last } }` */
export const LOGPOINT_STATE = '__bdg_lps_7c1f';

/** Longest string kept in a logged value */
const MAX_VALUE_STRING = 10000;

/** Longest error message kept (the page cuts it, so hits and counters stay small) */
const MAX_ERROR_TEXT = 500;

/** Items of an array and keys of an object kept in a logged value */
const MAX_VALUE_ITEMS = 20;

/** Depth of a logged value */
const MAX_VALUE_DEPTH = 3;

/**
 * Serializer of logged values, page-side: JSON for what JSON carries, and
 * `{ $: "<description>" }` for what it cannot (undefined, NaN, bigint, functions,
 * cycles, DOM nodes and other class instances, values past the limits).
 */
const SERIALIZER = `function ser(v, d, seen) {
  var t = typeof v;
  if (v === null || t === 'boolean') return v;
  if (t === 'string') return v.length > ${MAX_VALUE_STRING} ? v.slice(0, ${MAX_VALUE_STRING}) + '…' : v;
  if (t === 'number') return isFinite(v) ? v : { $: String(v) };
  if (t === 'undefined') return { $: 'undefined' };
  if (t === 'bigint') return { $: 'bigint ' + v };
  if (t === 'symbol') return { $: String(v) };
  if (t === 'function') return { $: 'function ' + (v.name || '(anonymous)') };
  if (seen.indexOf(v) >= 0) return { $: 'circular' };
  var tag = Object.prototype.toString.call(v).slice(8, -1);
  if (tag === 'Date') return { $: 'Date ' + (isNaN(v) ? 'invalid' : v.toISOString()) };
  var plain = tag === 'Object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  if (!plain && !Array.isArray(v)) return { $: v.constructor && v.constructor.name ? v.constructor.name : tag };
  if (d >= ${MAX_VALUE_DEPTH}) return { $: Array.isArray(v) ? 'Array(' + v.length + ')' : 'Object' };
  seen = seen.concat([v]);
  if (Array.isArray(v)) return v.slice(0, ${MAX_VALUE_ITEMS}).map(function (x) { return ser(x, d + 1, seen); });
  var out = {};
  Object.keys(v).slice(0, ${MAX_VALUE_ITEMS}).forEach(function (k) { out[k] = ser(v[k], d + 1, seen); });
  return out;
}`;

/** What a logpoint's condition is built from */
export interface LogpointConditionSpec {
  id: string;
  /** Hits logged per page load; the rest are counted */
  max: number;
  expressions: string[];
  guard?: string | undefined;
}

/**
 * The condition of a logpoint's breakpoint.
 *
 * @param spec - Id, limit, expressions and guard
 * @returns Page code that logs a hit through the binding and evaluates to `false`
 */
export function buildLogpointCondition(spec: LogpointConditionSpec): string {
  const id = JSON.stringify(spec.id);
  const state = JSON.stringify(LOGPOINT_STATE);
  const binding = JSON.stringify(LOGPOINT_BINDING);
  const guard = spec.guard === undefined ? '' : `if (!(\n${spec.guard}\n)) return false;\n    `;
  const values = spec.expressions
    .map(
      (expression, index) =>
        `try { __lp_v.push(__lp_ser((\n${expression}\n), 0, [])); } catch (__lp_e) { __lp_v.push(null); __lp_fail(__lp_e, ${index}); }`
    )
    .join('\n    ');
  return `(() => {
  var __lp_st = globalThis[${state}] || (globalThis[${state}] = {});
  var __lp_c = __lp_st[${id}] || (__lp_st[${id}] = { hits: 0, errors: 0, last: '' });
  var __lp_msg = function (e) {
    try {
      var m = (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
      return m.length > ${MAX_ERROR_TEXT} ? m.slice(0, ${MAX_ERROR_TEXT}) + '…' : m;
    } catch (x) {
      return '(error)';
    }
  };
  try {
    ${guard}__lp_c.hits++;
    if (__lp_c.hits > ${JSON.stringify(spec.max)}) return false;
    var __lp_ser = __lp_st.ser || (__lp_st.ser = ${SERIALIZER});
    var __lp_v = [], __lp_x = {};
    var __lp_fail = function (e, index) {
      __lp_c.errors++;
      __lp_c.last = __lp_msg(e);
      __lp_x[index] = __lp_c.last;
    };
    ${values}
    globalThis[${binding}](JSON.stringify({ i: ${id}, s: String(new Error().stack).split('\\n')[1], v: __lp_v, x: __lp_x }));
  } catch (__lp_e) {
    __lp_c.errors++;
    __lp_c.last = __lp_msg(__lp_e);
    if (__lp_c.errors <= ${JSON.stringify(spec.max)}) {
      try { globalThis[${binding}](JSON.stringify({ i: ${id}, e: __lp_c.last })); } catch (__lp_f) {}
    }
  }
  return false;
})()`;
}

/**
 * Page code that reads every logpoint's counters as JSON text.
 *
 * @returns Expression evaluating to a JSON string of `{ [id]: { hits, errors, last } }`
 */
export function readLogpointCountersExpression(): string {
  return `JSON.stringify(globalThis[${JSON.stringify(LOGPOINT_STATE)}] || {})`;
}
