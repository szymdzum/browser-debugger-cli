/**
 * No-match message smoke test.
 *
 * A selector that matches nothing gets one message on every command that
 * takes a selector, human and `--json`: `No nodes found matching "<selector>"`,
 * exit 83. Command-specific suggestions may differ.
 *
 * Timing: no waits; every command answers at once.
 */

import * as assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

const SELECTOR = '#nothing';
const EXPECTED = `No nodes found matching "${SELECTOR}"`;
const NO_MATCH_EXIT_CODE = 83;

/** Commands that take a selector, as their arguments after `dom` */
const COMMANDS: Record<string, string[]> = {
  query: ['query', SELECTOR],
  get: ['get', SELECTOR],
  layout: ['layout', SELECTOR],
  inspect: ['inspect', SELECTOR],
  click: ['click', SELECTOR],
  hover: ['hover', SELECTOR],
  fill: ['fill', SELECTOR, 'text'],
  submit: ['submit', SELECTOR],
  pressKey: ['pressKey', SELECTOR, 'Enter'],
  scroll: ['scroll', SELECTOR],
  listeners: ['listeners', SELECTOR],
  'a11y describe': ['a11y', 'describe', SELECTOR],
  screenshot: ['screenshot', join(tmpdir(), 'bdg-no-match.png'), '--selector', SELECTOR],
};

void describe('A selector that matches nothing', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}no-match`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const [name, args] of Object.entries(COMMANDS)) {
    void it(`${name}: one message, exit ${NO_MATCH_EXIT_CODE}, human and --json`, async () => {
      const json = await runCommand('dom', [...args, '--json'], { timeout: 60000 });
      assert.equal(json.exitCode, NO_MATCH_EXIT_CODE, json.stdout + json.stderr);
      const body = JSON.parse(json.stdout) as { success: boolean; error: string };
      assert.equal(body.success, false);
      assert.equal(body.error, EXPECTED);

      const human = await runCommand('dom', args, { timeout: 60000 });
      assert.equal(human.exitCode, NO_MATCH_EXIT_CODE, human.stdout + human.stderr);
      assert.ok(human.stderr.includes(EXPECTED), `stderr: ${human.stderr}`);
    });
  }
});
