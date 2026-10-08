/**
 * Downloads smoke test.
 *
 * A click on an attachment link must save the file into the session
 * directory's `downloads/` (never the user's real `~/Downloads`), named as the
 * page suggested (`(1)` added when that name is taken), and the click must
 * report it in human and JSON output; a download still running when the click
 * returns is reported `inProgress` and lands at the reported path later.
 * Downloads from new tabs are named and listed too, `peek` and `status` list
 * the session's downloads, and a session whose downloads directory cannot be
 * created refuses downloads instead of saving them elsewhere.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

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
  reason?: string;
}

/** How long a download may take to land after the click returned (a 15 B or 20 kB file: well under 1 s) */
const DOWNLOAD_WAIT_MS = 15000;

/** Second name the report gets when its first is taken */
const REPORT_COPY_NAME = 'bdg-fixture-report (1).txt';

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param env - Extra environment
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], env: Record<string, string> = {}): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000, env });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Click an element and return the downloads the click reported.
 *
 * @param selector - Element to click
 * @param env - Extra environment
 * @returns Reported downloads (empty when none)
 */
async function clickDownloads(
  selector: string,
  env: Record<string, string> = {}
): Promise<ReportedDownload[]> {
  const output = await bdg(['dom', 'click', selector, '--json'], env);
  return (JSON.parse(output) as { data: { downloads?: ReportedDownload[] } }).data.downloads ?? [];
}

/**
 * Wait until a condition holds.
 *
 * @param check - Condition
 * @param timeoutMs - How long to wait
 * @returns True once it holds, false on timeout
 */
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * The last download `bdg status --json` lists, once it has left `inProgress`
 * (Chrome reports the end a moment after the file lands or fails), or after
 * {@link DOWNLOAD_WAIT_MS}.
 *
 * @param env - Extra environment
 * @returns The download
 */
async function lastDownloadOnceEnded(
  env: Record<string, string> = {}
): Promise<ReportedDownload | undefined> {
  const deadline = Date.now() + DOWNLOAD_WAIT_MS;
  for (;;) {
    const output = await bdg(['status', '--json'], env);
    const last = (
      JSON.parse(output) as { data: { activity?: { downloads?: ReportedDownload[] } } }
    ).data.activity?.downloads?.at(-1);
    if (last?.state !== 'inProgress' || Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Assert a reported download saved the report at the given path: it is
 * completed, or still running and lands there shortly.
 *
 * @param download - Reported download
 * @param expectedPath - Where it must be saved
 */
async function assertReportSaved(
  download: ReportedDownload | undefined,
  expectedPath: string
): Promise<void> {
  assert.ok(download, 'the click reports a download');
  assert.equal(download.suggestedFilename, REPORT_DOWNLOAD_NAME);
  assert.ok(['completed', 'inProgress'].includes(download.state), download.state);
  assert.equal(download.path, expectedPath);
  assert.ok(await waitFor(() => fs.existsSync(expectedPath), DOWNLOAD_WAIT_MS), 'the file lands');
  assert.equal(fs.readFileSync(expectedPath, 'utf8'), REPORT_DOWNLOAD_BODY);
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

  beforeEach(() => {
    for (const file of fs.readdirSync(downloadsDir)) fs.rmSync(path.join(downloadsDir, file));
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('saves an attachment into the session directory and reports it', async () => {
    const [download, ...others] = await clickDownloads('#report');

    assert.deepEqual(others, []);
    assert.equal(download?.url, `${fixture.url}report-download`);
    await assertReportSaved(download, path.join(downloadsDir, REPORT_DOWNLOAD_NAME));
    assert.equal((fs.statSync(downloadsDir).mode & 0o777).toString(8), '700');
    assert.equal(fs.existsSync(path.join(userDownloads, REPORT_DOWNLOAD_NAME)), false);
  });

  void it('keeps an earlier download with the same name and says where it went', async () => {
    await clickDownloads('#report');
    const output = await bdg(['dom', 'click', '#report']);

    assert.match(
      output,
      /Download: bdg-fixture-report\.txt → .*bdg-fixture-report \(1\)\.txt \((completed, 15 B|inProgress[^)]*)\)/
    );
    for (const name of [REPORT_DOWNLOAD_NAME, REPORT_COPY_NAME]) {
      const file = path.join(downloadsDir, name);
      assert.ok(await waitFor(() => fs.existsSync(file), DOWNLOAD_WAIT_MS), name);
      assert.equal(fs.readFileSync(file, 'utf8'), REPORT_DOWNLOAD_BODY);
    }
  });

  void it('reports a download still running as inProgress, then saves it at its path', async () => {
    const [download] = await clickDownloads('#slow');

    assert.ok(download, 'the click reports a download');
    assert.equal(download.suggestedFilename, SLOW_DOWNLOAD_NAME);
    assert.equal(download.state, 'inProgress');
    assert.equal(download.path, path.join(downloadsDir, SLOW_DOWNLOAD_NAME));
    assert.equal(fs.existsSync(download.path), false, 'not there before it completes');

    await fetch(`${fixture.url}slow-download/release`);
    assert.ok(await waitFor(() => fs.existsSync(download.path ?? ''), DOWNLOAD_WAIT_MS));
    assert.equal(fs.statSync(download.path).size, 20000);
    assert.equal(fs.existsSync(path.join(userDownloads, SLOW_DOWNLOAD_NAME)), false);
  });

  void it('names downloads of new tabs and windows, and status and peek list them', async () => {
    await bdg(['dom', 'click', '#report-tab']);
    await bdg(['dom', 'click', '#report-window']);
    const names = [REPORT_DOWNLOAD_NAME, REPORT_COPY_NAME];
    const landed = await waitFor(
      () => names.every((name) => fs.existsSync(path.join(downloadsDir, name))),
      DOWNLOAD_WAIT_MS
    );

    assert.ok(landed, `files: ${fs.readdirSync(downloadsDir).join(', ')}`);
    assert.deepEqual(fs.readdirSync(downloadsDir).sort(), names.sort());
    const last = await lastDownloadOnceEnded();
    assert.equal(last?.path, path.join(downloadsDir, REPORT_COPY_NAME));
    assert.equal(last.state, 'completed');
    assert.match(await bdg(['status']), /Downloads:\s+\d+ \(last: bdg-fixture-report\.txt → /);
    const peek = await bdg(['peek', '--json']);
    const peeked = (JSON.parse(peek) as { data: { downloads?: ReportedDownload[] } }).data;
    assert.deepEqual(peeked.downloads?.at(-1), last);
    assert.match(await bdg(['peek']), /Downloads: \d+ \(last: bdg-fixture-report\.txt → /);
  });
});

void describe('Downloads without a usable downloads directory', () => {
  let fixture: FixtureServer;
  const session = { BDG_SESSION: 'downloads-denied' };
  const sessionDir = path.join(ensureTestSessionDir(), 'sessions', session.BDG_SESSION);
  const userDownloads = path.join(os.userInfo().homedir, 'Downloads');

  before(async () => {
    fixture = await startFixtureServer();
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(sessionDir, 'downloads'), 'not a directory');
    const port = await getFreePort();
    await bdg([`${fixture.url}downloads`, '--port', String(port), '--headless'], session);
  });

  after(async () => {
    await runCommand('stop', [], { env: session });
    await fixture.close();
  });

  void it('refuses downloads (reported canceled, with why) instead of saving them elsewhere', async () => {
    const [download] = await clickDownloads('#report', session);

    assert.ok(download, 'the click reports the download');
    const listed = await lastDownloadOnceEnded(session);
    assert.equal(listed?.state, 'canceled');
    assert.equal(listed.path, undefined);
    assert.match(listed.reason ?? '', /downloads directory/);
    assert.equal(fs.existsSync(path.join(userDownloads, REPORT_DOWNLOAD_NAME)), false);
  });
});

void describe('Cleanup and downloads', () => {
  void it('keeps downloaded files and says where they are', async () => {
    const session = { BDG_SESSION: 'downloads-kept' };
    const downloadsDir = path.join(
      ensureTestSessionDir(),
      'sessions',
      session.BDG_SESSION,
      'downloads'
    );
    fs.mkdirSync(downloadsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(downloadsDir, REPORT_DOWNLOAD_NAME), REPORT_DOWNLOAD_BODY);

    const output = await bdg(['cleanup'], session);
    const json = await bdg(['cleanup', '--json'], session);

    assert.match(output, /Downloads kept: 1 file in .*downloads-kept\/downloads/);
    const data = (JSON.parse(json) as { data: { downloadsKept?: unknown } }).data;
    assert.deepEqual(data.downloadsKept, { dir: downloadsDir, files: 1 });
    assert.ok(fs.existsSync(path.join(downloadsDir, REPORT_DOWNLOAD_NAME)));
  });
});
