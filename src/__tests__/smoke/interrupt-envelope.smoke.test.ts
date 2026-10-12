/**
 * Interrupted commands report it (#611).
 *
 * Ctrl-C (SIGINT) or SIGTERM during any command prints one error envelope
 * under `--json` (stdout) or one line on stderr, then exits 130 (143). An
 * action that may already have reached the page says so; a command writing
 * a file says whether it wrote it.
 *
 * The signal is sent once the command is known to be waiting: a click on
 * `/busy` once the page's click handler has told the fixture server (the
 * page then stays busy, so the click cannot finish), a read once the command
 * has connected to a daemon that is stopped (SIGSTOP) for the test, so its
 * request cannot be answered. No fixed sleeps.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { BUSY_MS } from '@/__testutils__/fixturePages/interruptFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';

/** Long enough for a click queued behind a busy page plus its own wait */
const COMMAND_TIMEOUT_MS = 3 * BUSY_MS + 30000;

/** The `--json` error envelope of an interrupted command */
interface InterruptEnvelope {
  success: boolean;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: COMMAND_TIMEOUT_MS });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Parse the one envelope an interrupted `--json` command printed.
 *
 * @param result - The command's result
 * @param exitCode - Expected exit code (130 or 143)
 * @returns The envelope
 */
function oneEnvelope(result: CommandResult, exitCode: number): InterruptEnvelope {
  const shown = `stdout: ${result.stdout}\nstderr: ${result.stderr}`;
  assert.equal(result.exitCode, exitCode, shown);
  const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
  assert.equal(lines.length, 1, `exactly one envelope on stdout; ${shown}`);
  const envelope = JSON.parse(lines[0] ?? '') as InterruptEnvelope;
  assert.equal(envelope.success, false, shown);
  assert.equal(envelope.error, 'Interrupted', shown);
  assert.equal(envelope.exitCode, exitCode, shown);
  assert.equal(typeof envelope.suggestion, 'string', shown);
  return envelope;
}

after(removeTempDirs);

void describe('Interrupted commands', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}busy`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  beforeEach(() => {
    fixture.beacons.length = 0;
  });

  /**
   * Click the busy button and send `signal` once the page has the click.
   *
   * @param args - Extra click arguments
   * @param signal - Signal to send
   * @returns The click's result
   */
  async function interruptClick(args: string[], signal: NodeJS.Signals): Promise<CommandResult> {
    const stop = new AbortController();
    const click = runCommand('dom', ['click', '#b', ...args], {
      timeout: COMMAND_TIMEOUT_MS,
      interrupt: stop.signal,
      interruptWith: signal,
    });
    const deadline = Date.now() + 2 * BUSY_MS + 20000;
    while (!fixture.beacons.includes('clicked') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fixture.beacons.includes('clicked'), 'the click never reached the page');
    stop.abort();
    return click;
  }

  /**
   * Run a command against a stopped daemon and send `signal` once the
   * command has connected to it (its `--debug` line), so its request is in
   * flight and cannot be answered. The daemon is resumed afterwards.
   *
   * @param args - Full bdg argument list, `--json --debug` added
   * @param signal - Signal to send
   * @returns The command's result
   */
  async function interruptRead(args: string[], signal: NodeJS.Signals): Promise<CommandResult> {
    const pidFile = path.join(ensureTestSessionDir(), 'daemon.pid');
    const daemonPid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    assert.ok(Number.isInteger(daemonPid), `daemon.pid: ${fs.readFileSync(pidFile, 'utf8')}`);
    const stop = new AbortController();
    const [command = '', ...rest] = args;
    process.kill(daemonPid, 'SIGSTOP');
    try {
      return await runCommand(command, [...rest, '--json', '--debug'], {
        timeout: COMMAND_TIMEOUT_MS,
        interrupt: stop.signal,
        interruptWith: signal,
        onStderr: (stderr) => {
          if (stderr.includes('Connected to daemon')) stop.abort();
        },
      });
    } finally {
      process.kill(daemonPid, 'SIGCONT');
    }
  }

  void it('prints one envelope (130) when a click is interrupted with --json', async () => {
    const envelope = oneEnvelope(await interruptClick(['--json'], 'SIGINT'), 130);
    assert.match(String(envelope.suggestion), /click may/i);
    assert.match(String(envelope.suggestion), /bdg peek/);
  });

  void it('prints one line on stderr (130) when a click is interrupted', async () => {
    const result = await interruptClick([], 'SIGINT');
    const shown = `stdout: ${result.stdout}\nstderr: ${result.stderr}`;
    assert.equal(result.exitCode, 130, shown);
    assert.equal(result.stdout, '', shown);
    const lines = result.stderr.split('\n').filter((line) => line.trim() !== '');
    assert.equal(lines.length, 1, shown);
    assert.match(lines[0] ?? '', /Interrupted/);
    assert.match(lines[0] ?? '', /click may/i);
  });

  void it('prints one envelope (143) when a click is terminated with --json', async () => {
    oneEnvelope(await interruptClick(['--json'], 'SIGTERM'), 143);
  });

  void it('prints one envelope (130) when a read is interrupted', async () => {
    const envelope = oneEnvelope(await interruptRead(['network', 'list'], 'SIGINT'), 130);
    assert.doesNotMatch(String(envelope.suggestion), /may have/);
  });

  void it('says the HAR file was not written when network har is interrupted', async () => {
    const file = path.join(makeTempDir('bdg-har-'), 'out.har');
    fs.writeFileSync(file, 'previous');
    const envelope = oneEnvelope(await interruptRead(['network', 'har', file], 'SIGINT'), 130);
    assert.match(String(envelope.suggestion), /not written/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous', 'the previous content stays');
  });

  void it('answers normally afterwards', async () => {
    await bdg(['network', 'list', '--json']);
  });
});
