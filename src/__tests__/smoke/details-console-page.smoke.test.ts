/**
 * `network details`, `console details` and `console --page` (#465, D6 and
 * D11): on `/follow-left`, which logs on load and again when the page is left
 * for `/follow-arrived`, the commands return the page's data.
 *
 * Timing: nothing waits a fixed time; the test polls `console --page all`
 * until the arrived page's message is captured.
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

const COMMAND_TIMEOUT_MS = 60000;
const POLL_DEADLINE_MS = 30000;

interface Envelope {
  success: boolean;
  data: Record<string, unknown> & { messages?: Array<{ index?: number; text: string }> };
  warnings?: string[];
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param command - Command name
 * @param args - Arguments
 * @returns Stdout and stderr
 */
async function bdg(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await runCommand(command, args, { timeout: COMMAND_TIMEOUT_MS });
  assert.equal(
    result.exitCode,
    0,
    `bdg ${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`
  );
  return result;
}

/**
 * Run a bdg command with `--json` and parse its envelope.
 *
 * @param command - Command name
 * @param args - Arguments
 * @returns Envelope
 */
async function json(command: string, args: string[]): Promise<Envelope> {
  const { stdout } = await bdg(command, [...args, '--json']);
  return JSON.parse(stdout) as Envelope;
}

/**
 * Poll `console --page all` until a message with the text is captured.
 *
 * @param text - Message text
 */
async function waitForMessage(text: string): Promise<void> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  for (;;) {
    const { data } = await json('console', ['--page', 'all', '--list']);
    if (data.messages?.some((message) => message.text.includes(text))) return;
    assert.ok(Date.now() < deadline, `no console message "${text}" captured`);
  }
}

/**
 * The texts of the messages a `console --json` envelope lists.
 *
 * @param envelope - Console envelope
 * @returns Texts
 */
function texts(envelope: Envelope): string[] {
  return (envelope.data.messages ?? []).map((message) => message.text);
}

void describe('network details, console details, console --page', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}follow-left`,
      ['--port', String(port), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(started.exitCode, 0, started.stderr);
    await bdg('dom', ['click', '#leave']);
    await waitForMessage('arrived error');
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('console --page all lists the left page too; current and the default only the new one', async () => {
    const all = texts(await json('console', ['--page', 'all', '--list']));
    assert.ok(
      all.some((text) => text.includes('left loaded')),
      all.join('|')
    );
    const current = await json('console', ['--page', 'current', '--list']);
    assert.ok(texts(current).some((text) => text.includes('arrived error')));
    assert.ok(!texts(current).some((text) => text.includes('left loaded')));
    assert.deepEqual((await json('console', ['--list'])).data, current.data);
    const upper = await json('console', ['--page', 'ALL', '--list']);
    assert.deepEqual(texts(upper), all);
  });

  void it('console details <n> returns the message', async () => {
    const all = await json('console', ['--page', 'all', '--list']);
    const index = all.data.messages?.find((message) => message.text.includes('first error'))?.index;
    assert.ok(index !== undefined, 'message has an index');
    const current = await json('console', ['details', String(index)]);
    assert.ok(JSON.stringify(current.data).includes('first error'), JSON.stringify(current.data));
    assert.equal(current.warnings, undefined);
    const human = await bdg('console', ['details', String(index)]);
    assert.ok(human.stdout.includes('first error'), human.stdout);
  });

  void it('network details <id> returns the request, body options included', async () => {
    const list = await json('network', ['list']);
    const requests = list.data['requests'] as Array<{ requestId: string }>;
    const id = requests[0]?.requestId;
    assert.ok(id, 'a request was captured');
    for (const extra of [[], ['--no-body'], ['--body-max', '10']]) {
      const current = await json('network', ['details', id, ...extra]);
      assert.ok(JSON.stringify(current.data).includes(id), extra.join(' '));
      assert.equal(current.warnings, undefined);
    }
    await bdg('network', ['details', id, '--body']);
  });
});
