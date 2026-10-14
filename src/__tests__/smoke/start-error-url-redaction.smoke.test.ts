/**
 * Start errors never echo URL credentials (#757): `bdg <url>` with a
 * password in the user info or a token in the query or fragment fails, and
 * neither its human stderr, its `--json` envelope (error and suggestion)
 * nor `daemon.log` holds the secret, while the error still names the host.
 *
 * Timing: the URLs that reach Chrome fail on load (nothing listens on the
 * free port; port 1 is unsafe); `daemon.log` is read until it holds the
 * "Session start failed" line.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';

/** Any form of the password the inputs carry */
const SECRET = /SECRETPW|SECRET%40PW/;

/** The daemon's line for a failed start */
const START_FAILED = 'Session start failed';

/** A start URL, the host its error names, and whether it reaches Chrome */
interface Case {
  url: string;
  host: RegExp;
  launches: boolean;
}

/**
 * The case matrix; `PORT` is replaced by a port nothing listens on.
 *
 * Cells whose error never quoted the URL (`Invalid port`,
 * `Unsupported protocol`) name the port or scheme instead of the host.
 */
const CASES: Case[] = [
  { url: 'http://user:SECRETPW@localhost:PORT', host: /localhost/, launches: true },
  { url: 'http://user:SECRETPW@127.0.0.1:1/p', host: /127\.0\.0\.1/, launches: true },
  { url: 'http://us%40er:SECRETPW@localhost:1', host: /localhost/, launches: true },
  { url: 'http://user:SECRET%40PW@localhost:1', host: /localhost/, launches: true },
  { url: 'http://user:SECRETPW@[::1]:1/', host: /\[::1\]/, launches: true },
  { url: 'http://user@localhost:1/', host: /localhost/, launches: true },
  { url: 'http://localhost:1/?token=SECRETPW', host: /localhost/, launches: true },
  { url: 'http://localhost:1/#access_token=SECRETPW', host: /localhost/, launches: true },
  { url: 'localhost:PORT/?token=SECRETPW', host: /localhost/, launches: true },
  { url: 'user:SECRETPW@localhost:abc/p', host: /localhost/, launches: false },
  { url: 'http://user:SECRETPW@localhost:99999/', host: /99999/, launches: false },
  { url: 'htp://user:SECRETPW@localhost', host: /htp:/, launches: false },
  { url: 'http://user:SECRETPW@local host/', host: /local host/, launches: false },
  { url: 'http://user:SECRETPW@localhost/?', host: /localhost/, launches: false },
  { url: '//u:SECRETPW@localhost:1', host: /localhost/, launches: true },
  { url: 'http:////u:SECRETPW@localhost:1', host: /localhost/, launches: true },
  { url: 'https:/u:SECRETPW@localhost:1', host: /localhost/, launches: true },
  { url: 'x?next=u:SECRETPW@localhost', host: /'x/, launches: false },
];

/**
 * Read `daemon.log` once it holds a line (within 15 s).
 *
 * @param marker - Text the log must hold
 * @returns The log
 */
async function daemonLogWith(marker: string): Promise<string> {
  const file = path.join(ensureTestSessionDir(), 'daemon.log');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const log = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (log.includes(marker)) return log;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`daemon.log has no "${marker}" line`);
}

/**
 * Empty `daemon.log`, so the next failed start's line is the one read.
 */
function clearDaemonLog(): void {
  const file = path.join(ensureTestSessionDir(), 'daemon.log');
  if (fs.existsSync(file)) fs.writeFileSync(file, '');
}

void describe('start errors never echo URL credentials (#757)', () => {
  let port = 0;

  before(async () => {
    await cleanupAllSessions();
    port = await getFreePort();
  });

  after(async () => {
    await cleanupAllSessions();
  });

  for (const { url: template, host, launches } of CASES) {
    void it(`hides the secret of ${template}`, async () => {
      const url = template.replace('PORT', String(port));

      if (launches) clearDaemonLog();
      const human = await runCommand(url, [], { timeout: 60000 });
      assert.equal(human.exitCode, 80, `${url}: ${human.stderr}`);
      const shown = `${human.stdout}\n${human.stderr}`;
      assert.doesNotMatch(shown, SECRET, `human: ${shown}`);
      assert.match(human.stderr, host, `human: ${human.stderr}`);
      if (launches) {
        const log = await daemonLogWith(START_FAILED);
        assert.doesNotMatch(log, SECRET, `daemon.log: ${log}`);
      }

      const json = await runCommand(url, ['--json'], { timeout: 60000 });
      assert.equal(json.exitCode, 80, `${url} --json: ${json.stderr}`);
      assert.doesNotMatch(`${json.stdout}\n${json.stderr}`, SECRET, `--json: ${json.stdout}`);
      const envelope = JSON.parse(json.stdout) as { success: boolean; error?: string };
      assert.equal(envelope.success, false);
      assert.match(envelope.error ?? '', host, `--json: ${json.stdout}`);
    });
  }
});
