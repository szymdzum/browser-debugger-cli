/**
 * Smoke test for a page whose renderer crashes mid-session (its renderer
 * process is killed: `Page.crash` and `chrome://crash` only hang it on Linux
 * CI): the session says so, page commands fail at once with 107, and a
 * reload brings the page back.
 */

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

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

/**
 * Kill the renderer processes of a Chrome, as a renderer crash does.
 *
 * @param chromePid - Chrome's browser process
 */
function killRenderers(chromePid: number): void {
  const processes = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, args]) => ({ pid: Number(pid), ppid: Number(ppid), args: args ?? '' }));
  const family = new Set([chromePid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const proc of processes) {
      if (family.has(proc.ppid) && !family.has(proc.pid)) {
        family.add(proc.pid);
        grew = true;
      }
    }
  }
  const renderers = processes.filter(
    (proc) => family.has(proc.pid) && proc.args.includes('--type=renderer')
  );
  assert.ok(renderers.length > 0, 'Chrome has a renderer process');
  for (const renderer of renderers) process.kill(renderer.pid, 'SIGKILL');
}

void describe('page crash', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}inspect`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports a crashed page, fails page commands at once, and recovers on reload', async () => {
    const status0 = JSON.parse(await bdg(['status', '--json'])) as {
      data: { chromePid: number };
    };
    killRenderers(status0.data.chromePid);
    const crashed =
      /\n⚠ The page crashed at .+ \(renderer gone\); bdg page reload brings it back\n/;
    let status = '';
    for (let attempt = 0; attempt < 20 && !crashed.test(status); attempt++) {
      if (attempt > 0) await delay(250);
      status = await bdg(['status']);
    }
    assert.match(status, crashed);
    assert.match(await bdg(['peek']), /^⚠ The page crashed at /);
    const started = Date.now();
    assert.match(
      await bdg(['dom', 'query', 'h1'], 107),
      /The page crashed at .+ \(its renderer is gone\), so page commands cannot run\n.*bdg page reload/
    );
    assert.ok(Date.now() - started < 10000, 'fails at once instead of waiting for the page');
    const json = JSON.parse(await bdg(['status', '--json'])) as {
      data: { pageState: { crashedAt?: number } };
    };
    assert.equal(typeof json.data.pageState.crashedAt, 'number');

    await bdg(['page', 'reload']);
    assert.doesNotMatch(await bdg(['status']), /crashed/);
    assert.match(await bdg(['dom', 'query', 'body']), /Found \d+ nodes? matching "body"/);
  });
});
