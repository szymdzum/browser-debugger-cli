/**
 * Serves the smoke test fixture pages outside the tests, for manual and
 * fresh-agent test rounds (.claude/skills/ship/SKILL.md, "Fresh-agent test scenarios"):
 *
 * ```bash
 * npx tsx src/__testutils__/serveFixtures.ts
 * ```
 *
 * Prints the fixture server's URL and the blocked cookie fixture URLs, then
 * serves until Ctrl-C (or SIGTERM).
 */

import { startCookieFixtures } from '@/__testutils__/cookieFixtures.js';
import { startFixtureServer } from '@/__testutils__/fixtureServer.js';

/**
 * Start both fixture servers and stop them on a signal.
 */
async function main(): Promise<void> {
  const fixtures = await startFixtureServer();
  const cookies = await startCookieFixtures();
  process.stdout.write(
    [
      `fixtures:      ${fixtures.url}`,
      `cookies seed:  ${cookies.seedUrl}`,
      `cookies page:  ${cookies.pageUrl}`,
      'Ctrl-C to stop',
      '',
    ].join('\n')
  );
  const stop = (): void => {
    void Promise.all([fixtures.close(), cookies.close()]).then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main();
