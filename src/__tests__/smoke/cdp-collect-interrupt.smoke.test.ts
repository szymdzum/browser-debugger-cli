/**
 * An interrupted `bdg cdp <method>` with event flags (`--collect`, `--until`,
 * `--out`) never tells the agent to run it again (#758).
 *
 * The daemon keeps running the call after the client dies, so the call may
 * have reached the page (`Tracing.end` cannot be repeated) and an `--out`
 * file may have been written. The signal is sent once the collection has
 * started: its `--out` temp file exists next to the target. No fixed sleeps.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Upper bound for every command */
const COMMAND_TIMEOUT_MS = 60_000;

/** Event that never arrives: the collection runs until it is interrupted */
const NEVER = 'Never.happens';

/** The `--json` error envelope of an interrupted command */
interface InterruptEnvelope {
  success: boolean;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

/**
 * Describe a command result for assertion messages.
 *
 * @param result - Command result
 * @returns Exit code, stdout and stderr
 */
function shown(result: CommandResult): string {
  return `exit ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
}

/**
 * Wait until a directory holds an entry (the collection's temp file).
 *
 * @param dir - Directory to watch
 */
async function untilCollecting(dir: string): Promise<void> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (fs.readdirSync(dir).length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(fs.readdirSync(dir).length > 0, 'the collection never started');
}

after(removeTempDirs);

void describe('Interrupted bdg cdp with event flags', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  /**
   * Run `bdg cdp Page.reload --collect … --until Never.happens` with
   * `--out`, interrupt it once collecting.
   *
   * @param json - Whether to ask for `--json`
   * @returns The out file and the interrupted result (exit 130, asserted)
   */
  async function interruptCollection(
    json: boolean
  ): Promise<{ file: string; result: CommandResult }> {
    const dir = makeTempDir('bdg-collect-interrupt-');
    const file = path.join(dir, 'events.ndjson');
    const stop = new AbortController();
    const running = runCommand(
      'cdp',
      [
        'Page.reload',
        '--collect',
        'Page.frameNavigated',
        '--until',
        NEVER,
        '--timeout',
        '30',
        '--out',
        file,
        ...(json ? ['--json'] : []),
      ],
      { timeout: COMMAND_TIMEOUT_MS, interrupt: stop.signal }
    );
    await untilCollecting(dir);
    stop.abort();
    const result = await running;
    assert.equal(result.exitCode, 130, shown(result));
    return { file, result };
  }

  void it('says the call may have reached the page and names the --out file (human)', async () => {
    const { file, result } = await interruptCollection(false);
    assert.doesNotMatch(result.stderr, /run it again/, shown(result));
    assert.match(result.stderr, /may already have reached the page/, shown(result));
    assert.ok(result.stderr.includes(file), shown(result));
  });

  void it('carries the same suggestion under --json', async () => {
    const { file, result } = await interruptCollection(true);
    const envelope = JSON.parse(result.stdout.trim()) as InterruptEnvelope;
    assert.equal(envelope.error, 'Interrupted', shown(result));
    assert.doesNotMatch(envelope.suggestion ?? '', /run it again/, shown(result));
    assert.ok((envelope.suggestion ?? '').includes(file), shown(result));
  });
});
