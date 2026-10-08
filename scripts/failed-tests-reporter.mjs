/**
 * node:test reporter that lists only the failed tests, one Markdown line each:
 * `` - `file`: `suite › test` ``. Suites are left out (a suite fails when one
 * of its tests does), so each line is a test that failed or was cancelled.
 * `scripts/smoke-selected.sh` uses it next to the spec reporter and copies
 * the lines into the job summary of a CI run.
 */
import { relative } from 'node:path';

/**
 * Quotes text as a Markdown code span, so `<`, `|` or `*` in a name stay as typed.
 *
 * @param text - Text to quote
 * @returns The code span
 */
function code(text) {
  return `\`${String(text).replaceAll('`', "'")}\``;
}

/**
 * Yields a Markdown list item for every failed test (not suite) in the run.
 *
 * @param source - Test runner events
 */
export default async function* failedTests(source) {
  const path = [];
  for await (const event of source) {
    const { name, nesting, file, details } = event.data ?? {};
    if (event.type === 'test:start') path.splice(nesting, path.length, name);
    if (event.type !== 'test:fail' || details?.type === 'suite') continue;
    const fullName = [...path.slice(0, nesting), name].join(' › ');
    yield `- ${file ? `${code(relative(process.cwd(), file))}: ` : ''}${code(fullName)}\n`;
  }
}
