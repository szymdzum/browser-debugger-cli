/**
 * Smoke test for the user agent of a headless session: regular Chrome's
 * string, and client hints that name the browser and its platform version
 * like a regular Chrome's do (the fixture server's origin is a secure
 * context, so the page has `navigator.userAgentData`).
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

interface BrandVersion {
  brand: string;
  version: string;
}

interface ClientHints {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  platform: string;
  platformVersion: string;
  mobile: boolean;
}

/**
 * Run a bdg command with `--json` and return its data.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns The envelope's data
 */
async function bdgJson(args: string[]): Promise<Record<string, unknown>> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: Record<string, unknown> }).data;
}

/**
 * Evaluate an expression in the page.
 *
 * @param expression - JavaScript expression (a promise is awaited)
 * @returns Its result
 */
async function evaluate(expression: string): Promise<unknown> {
  return (await bdgJson(['dom', 'eval', expression]))['result'];
}

void describe('headless user agent', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const start = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(start.exitCode, 0, start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('sends regular Chrome user agent and client hints', async () => {
    const { product } = (await bdgJson(['cdp', 'Browser.getVersion']))['result'] as {
      product: string;
    };
    const fullVersion = /\/([\d.]+)$/.exec(product)?.[1] ?? '';
    const major = fullVersion.split('.')[0];
    assert.doesNotMatch(String(await evaluate('navigator.userAgent')), /Headless/);
    const hints = JSON.parse(
      String(
        await evaluate(
          "navigator.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']).then(JSON.stringify)"
        )
      )
    ) as ClientHints;
    for (const brand of ['Chromium', 'Google Chrome']) {
      assert.ok(
        hints.brands.some((entry) => entry.brand === brand && entry.version === major),
        `${brand} in ${JSON.stringify(hints.brands)}`
      );
    }
    assert.ok(
      hints.fullVersionList.some(
        (entry) => entry.brand === 'Chromium' && entry.version === fullVersion
      ),
      JSON.stringify(hints.fullVersionList)
    );
    assert.ok(!JSON.stringify(hints).includes('Headless'), JSON.stringify(hints));
    assert.notEqual(hints.platform, '');
    assert.notEqual(hints.platformVersion, '');
    assert.equal(hints.mobile, false);
  });
});
