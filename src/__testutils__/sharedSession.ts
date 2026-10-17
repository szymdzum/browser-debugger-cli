/**
 * One bdg session for a whole smoke file.
 *
 * Starting Chrome and the daemon costs seconds; navigating the running
 * session to the next fixture page costs a fraction of that and gives the
 * test a fresh document all the same. A page with a ticker never settles, so
 * the navigation does not wait for it: the helper waits for the observable
 * event instead (the new document reports the URL and `complete`), with a
 * deadline and a message that names the page.
 */

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';

/** Longest the new document may take to report its URL and `complete` */
const PAGE_LOAD_DEADLINE_MS = 30_000;

/** Time limit for one helper command: a hung command fails here, not at the suite timeout */
const HELPER_COMMAND_TIMEOUT_MS = 15_000;

/** Pause between two readiness polls */
const POLL_INTERVAL_MS = 50;

/** Marks the document that is being left, so a reload of the same URL is not mistaken for it */
const MARK_OLD_DOCUMENT = '(window.__bdgLeft = true)';

/** The document's URL and ready state, or `old` while the marked document is still there */
const READ_DOCUMENT =
  'window.__bdgLeft === true ? "old" : location.href + "\\n" + document.readyState';

/** What `open` hands a test */
export type OpenPage = (url: string, extraStartArgs?: string[]) => Promise<void>;

/**
 * Evaluate a page expression through the CLI.
 *
 * @param expression - JavaScript expression without parameters
 * @returns The command's exit code and the value it returned
 */
async function evaluate(expression: string): Promise<{ exitCode: number; value: string }> {
  const result = await runCommand(
    'cdp',
    ['Runtime.evaluate', '--params', JSON.stringify({ expression, returnByValue: true })],
    { timeout: HELPER_COMMAND_TIMEOUT_MS }
  );
  try {
    const parsed = JSON.parse(result.stdout) as { result?: { value?: unknown } };
    return { exitCode: result.exitCode, value: String(parsed.result?.value) };
  } catch {
    return { exitCode: result.exitCode, value: result.stdout };
  }
}

/**
 * Wait until the session's page is the document at `url` and has loaded.
 *
 * @param url - URL the navigation went to
 * @throws Error naming the page when the deadline passes
 */
async function waitForDocument(url: string): Promise<void> {
  const deadline = Date.now() + PAGE_LOAD_DEADLINE_MS;
  let last = '';
  while (Date.now() < deadline) {
    const read = await evaluate(READ_DOCUMENT);
    last = `exit ${read.exitCode}, ${JSON.stringify(read.value)}`;
    if (read.exitCode === 0 && read.value === `${url}\ncomplete`) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `${url} did not finish loading in ${PAGE_LOAD_DEADLINE_MS} ms (last read: ${last})`
  );
}

/**
 * Create the `open` function of a smoke file.
 *
 * The first call (and any call with extra start arguments, which need a
 * session of their own) starts a headless session on the page; later calls
 * navigate the running one.
 *
 * @returns `open(url, extraStartArgs)`
 */
export function createSharedSession(): OpenPage {
  let shareable = false;

  return async (url, extraStartArgs = []) => {
    if (shareable && extraStartArgs.length === 0) {
      const marked = await evaluate(MARK_OLD_DOCUMENT);
      if (marked.exitCode !== 0) {
        throw new Error(`could not mark the document before ${url}: ${marked.value}`);
      }
      const navigated = await runCommand('page', ['navigate', url, '--no-wait'], {
        timeout: HELPER_COMMAND_TIMEOUT_MS,
      });
      if (navigated.exitCode !== 0) {
        throw new Error(`page navigate ${url} failed: ${navigated.stdout}${navigated.stderr}`);
      }
      await waitForDocument(url);
      return;
    }
    await cleanupAllSessions();
    const port = await getFreePort();
    const started = await runCommand(
      url,
      ['--port', String(port), '--headless', ...extraStartArgs],
      {
        timeout: 60_000,
      }
    );
    if (started.exitCode !== 0) {
      throw new Error(`bdg ${url} failed (exit ${started.exitCode}): ${started.stderr}`);
    }
    shareable = extraStartArgs.length === 0;
  };
}
