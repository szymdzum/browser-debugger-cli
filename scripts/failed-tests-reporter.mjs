/**
 * node:test reporter that lists only the failed tests, one Markdown line each:
 * `` - `file`: `suite › test` ``. Suites are left out (a suite fails when one
 * of its tests does), so each line is a test that failed or was cancelled.
 * When a whole test file fails (Node 22 applies `--test-timeout` to the file,
 * not to its tests), the line names the test that was still running in it.
 * `scripts/smoke-selected.sh` uses it next to the spec reporter and copies
 * the lines into the job summary of a CI run.
 */
import { realpathSync } from 'node:fs';
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
 * Resolves symlinks in a test file path: the runner names a file test by the
 * path it was given, its tests report the real path (`/tmp` vs `/private/tmp`).
 *
 * @param file - Test file path
 * @returns The real path, or the path itself when it cannot be resolved
 */
function realFile(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Tracks, per test file, the tests that were dequeued (started running) and
 * have not completed yet, so a file that is killed can say what it was running.
 */
class RunningTests {
  /** @type {Map<string, Array<{ nesting: number, name: string }>>} */
  #byFile = new Map();

  /**
   * Records a test that started running.
   *
   * @param file - Test file
   * @param nesting - Nesting level of the test
   * @param name - Test name
   */
  start(file, nesting, name) {
    const key = realFile(file);
    if (!this.#byFile.has(key)) this.#byFile.set(key, []);
    this.#byFile.get(key).push({ nesting, name });
  }

  /**
   * Forgets a test that completed.
   *
   * @param file - Test file
   * @param nesting - Nesting level of the test
   * @param name - Test name
   */
  complete(file, nesting, name) {
    const running = this.#byFile.get(realFile(file)) ?? [];
    const index = running.findLastIndex((t) => t.nesting === nesting && t.name === name);
    if (index !== -1) running.splice(index, 1);
  }

  /**
   * Full name of the innermost test still running in a file.
   *
   * @param file - Test file
   * @returns `suite › test`, or undefined when nothing was running
   */
  innermost(file) {
    const running = this.#byFile.get(realFile(file)) ?? [];
    const leaf = running.at(-1);
    if (!leaf) return undefined;
    const path = [];
    for (const t of running) path.splice(t.nesting, path.length, t.name);
    return path.slice(0, leaf.nesting + 1).join(' › ');
  }
}

/**
 * Yields a Markdown list item for every failed test (not suite) in the run.
 *
 * @param source - Test runner events
 */
export default async function* failedTests(source) {
  const path = [];
  const running = new RunningTests();
  for await (const event of source) {
    const { name, nesting, file, details, todo } = event.data ?? {};
    const isFileTest = file !== undefined && name === file;
    if (event.type === 'test:dequeue' && !isFileTest) running.start(file, nesting, name);
    if (event.type === 'test:complete' && !isFileTest) running.complete(file, nesting, name);
    if (event.type === 'test:start') path.splice(nesting, path.length, name);
    if (event.type !== 'test:fail' || details?.type === 'suite' || todo) continue;
    const where = file ? `${code(relative(process.cwd(), file))}: ` : '';
    const inFlight = isFileTest ? running.innermost(file) : undefined;
    if (inFlight) {
      const reason = String(details?.error?.message ?? 'unknown error')
        .replace(/\s+/g, ' ')
        .trim();
      yield `- ${where}${code(inFlight)} (still running when the file failed: ${code(reason)})\n`;
      continue;
    }
    const fullName = [...path.slice(0, nesting), name].join(' › ');
    yield `- ${where}${code(fullName)}\n`;
  }
}
