/**
 * Downloads smoke test.
 *
 * A click on an attachment link must save the file into the session
 * directory's `downloads/` (never the user's real `~/Downloads`), named as the
 * page suggested (`(1)` added when that name is taken), and the click must
 * report it in human and JSON output; a download still running when the click
 * returns is reported `inProgress` and lands at the reported path later.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  REPORT_DOWNLOAD_BODY,
  REPORT_DOWNLOAD_NAME,
  SLOW_DOWNLOAD_NAME,
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';

/** A download as `--json` reports it */
interface ReportedDownload {
  url: string;
  suggestedFilename: string;
  path?: string;
  state: string;
  bytes?: number;
}

/** How long the slow download may take to land after the click returned */
const SLOW_DOWNLOAD_WAIT_MS = 15000;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Click an element and return the downloads the click reported.
 *
 * @param selector - Element to click
 * @returns Reported downloads (empty when none)
 */
async function clickDownloads(selector: string): Promise<ReportedDownload[]> {
  const output = await bdg(['dom', 'click', selector, '--json']);
  return (JSON.parse(output) as { data: { downloads?: ReportedDownload[] } }).data.downloads ?? [];
}

/**
 * Wait until a file exists.
 *
 * @param file - File path
 * @param timeoutMs - How long to wait
 * @returns True once it exists, false on timeout
 */
async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

void describe('Downloads', () => {
  let fixture: FixtureServer;
  const downloadsDir = path.join(ensureTestSessionDir(), 'downloads');
  const userDownloads = path.join(os.userInfo().homedir, 'Downloads');

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}downloads`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('saves an attachment into the session directory and reports it', async () => {
    const [download, ...others] = await clickDownloads('#report');

    assert.deepEqual(others, []);
    assert.ok(download, 'the click reports a download');
    assert.equal(download.url, `${fixture.url}report-download`);
    assert.equal(download.suggestedFilename, REPORT_DOWNLOAD_NAME);
    assert.equal(download.state, 'completed');
    assert.equal(download.bytes, REPORT_DOWNLOAD_BODY.length);
    assert.equal(download.path, path.join(downloadsDir, REPORT_DOWNLOAD_NAME));
    assert.equal(fs.readFileSync(download.path, 'utf8'), REPORT_DOWNLOAD_BODY);
    assert.equal((fs.statSync(downloadsDir).mode & 0o777).toString(8), '700');
    assert.equal(fs.existsSync(path.join(userDownloads, REPORT_DOWNLOAD_NAME)), false);
  });

  void it('keeps an earlier download with the same name and says where it went', async () => {
    const output = await bdg(['dom', 'click', '#report']);
    const second = path.join(downloadsDir, 'bdg-fixture-report (1).txt');

    assert.match(
      output,
      new RegExp(
        `Download: ${REPORT_DOWNLOAD_NAME} → .*bdg-fixture-report \\(1\\)\\.txt \\(completed, 15 B\\)`
      )
    );
    assert.equal(fs.readFileSync(second, 'utf8'), REPORT_DOWNLOAD_BODY);
    assert.equal(
      fs.readFileSync(path.join(downloadsDir, REPORT_DOWNLOAD_NAME), 'utf8'),
      REPORT_DOWNLOAD_BODY
    );
  });

  void it('reports a download still running as inProgress, then saves it at its path', async () => {
    const [download] = await clickDownloads('#slow');

    assert.ok(download, 'the click reports a download');
    assert.equal(download.suggestedFilename, SLOW_DOWNLOAD_NAME);
    assert.equal(download.state, 'inProgress');
    assert.equal(download.path, path.join(downloadsDir, SLOW_DOWNLOAD_NAME));
    assert.ok(await waitForFile(download.path, SLOW_DOWNLOAD_WAIT_MS), 'the file lands');
    assert.equal(fs.statSync(download.path).size, 20000);
    assert.equal(fs.existsSync(path.join(userDownloads, SLOW_DOWNLOAD_NAME)), false);
  });
});
