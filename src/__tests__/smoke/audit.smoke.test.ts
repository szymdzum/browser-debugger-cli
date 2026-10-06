/**
 * Smoke tests for `bdg dom audit` and `bdg css search` against a real Chrome
 * and the `/inspect` fixture page.
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

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

void describe('dom audit and css search', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}inspect`, '--port', String(port), '--headless']);
    await bdg(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('lists text below WCAG AA, weakest first', async () => {
    const output = await bdg(['dom', 'audit', 'contrast', '--json']);
    const data = (
      JSON.parse(output) as {
        data: { contrast: { failing: number; items: Array<{ element: string; ratio: number }> } };
      }
    ).data;
    assert.ok(data.contrast.failing > 0);
    const ratios = data.contrast.items.map((item) => item.ratio);
    assert.deepEqual(
      ratios,
      [...ratios].sort((a, b) => a - b)
    );
    assert.ok(data.contrast.items.some((item) => item.element === 'b' && item.ratio < 1.3));
    assert.match(
      await bdg(['dom', 'audit', 'contrast']),
      /^Contrast \(AA\): \d+ of \d+ text elements below/
    );
  });

  void it('runs every check by default and rejects an unknown one', async () => {
    const output = await bdg(['dom', 'audit']);
    assert.match(output, /\nOverflow: /);
    assert.match(output, /\nLayers: /);
    assert.match(output, /\nAnimations: /);
    assert.match(await bdg(['dom', 'audit', 'contrsat'], 81), /did you mean contrast\?/);
  });

  void it('finds text in the stylesheets with the rule and its place', async () => {
    const output = await bdg(['css', 'search', 'Fixture Sans']);
    assert.match(output, /"Fixture Sans": \d+ matches in \d+ stylesheets/);
    assert.match(output, /<style> in inspect:\d+\n {4}.*font-family: "Fixture Sans"/);
    assert.match(await bdg(['css', 'search', 'no-such-token-xyz']), /is not in the page's/);
  });

  void it('says what it cannot see: paint behind text, masks, canvas, and the scroll a hover made', async () => {
    await bdg(['page', 'navigate', `${fixture.url}inspect-paint`]);
    const audit = await bdg(['dom', 'audit', 'contrast', 'animations']);
    assert.match(
      audit,
      /p#over-image "White over an image in view" 16px \(approximate: img behind\)/
    );
    assert.match(
      audit,
      /p#low "White over an image out of view" 16px \(out of view\) \(approximate: only its ancestors were checked\)/
    );
    assert.match(
      audit,
      /\(\+ 1 canvas element: animations drawn by scripts on it are not listed\)/
    );
    const masked = await bdg(['dom', 'inspect', '#masked', '--tree', '0']);
    assert.match(masked, /\[masked by mask-image\]/);
    assert.match(
      masked,
      /\ntext {3}Arial 400 16\/normal · color #fff · contrast 15\.9 AAA on #222/
    );
    assert.match(await bdg(['dom', 'layout', '#masked']), /masked by mask-image$/m);
    const gradient = await bdg(['dom', 'inspect', '#gradient', '--tree', '0']);
    assert.match(
      gradient,
      /\nfill {3}bg-image linear-gradient\(90deg, #f00, #00f\) · clipped to the text/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#gradient', '--all']),
      /-webkit-text-fill-color transparent/
    );
    assert.match(await bdg(['dom', 'hover', '#far']), /Scrolled: +page down \d+px to reach it/);
  });
});
