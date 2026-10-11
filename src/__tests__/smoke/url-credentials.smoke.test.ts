/**
 * Page URLs with credentials smoke test (#623).
 *
 * The session starts on the `/url-creds?token=…` fixture through a URL with
 * `user:pass@` and a `#id_token=`. Every output shows the URL without the user
 * info and with the tokens as `••••`: the start output (and the "already
 * running" error), `status` (human, `--verbose`, `--json`), `sessions`,
 * `page info`, `page tabs`, `page close`, `network list`, `peek`, the
 * `navigation`, `triggeredRequests` and `opened` of `dom click`, the
 * `action` of `dom form --json`, the root `url` of `dom a11y tree --json`,
 * the `page navigate` result and `daemon.log`. `--include-sensitive` on
 * `status`, `sessions`, `page info`, `page tabs`, `network list` and `peek`
 * shows the tokens, with a warning, but never the user info.
 *
 * Timing: the start waits for the page; each click waits for its effects
 * before it reads them; `page back` waits for the page to load. The fetch
 * button sets the title to `fetched` when its request and the WebSocket
 * echo came back, which the test waits for. `daemon.log` is read until it
 * holds the `Target updated` line the start writes.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  URL_CREDS_PATH,
  URL_SECRET_MARKER,
} from '@/__testutils__/fixturePages/urlCredentialFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import type { OpenedTab, PageCloseData, PageTabsData } from '@/ipc/protocol/tabTypes.js';

/** Shown instead of a secret value */
const MASK = '••••';

/** The password of the session URL's user info */
const PASSWORD = 'PW-BASIC-623';

/** Any secret of the session URL or the fixture pages */
const ANY_SECRET = new RegExp(`${PASSWORD}|QT-[A-Z]+${URL_SECRET_MARKER}|4111111111111111`);

/** The user info, in any output */
const USER_INFO = /bob:|PW-BASIC/;

/** Result of a bdg command */
interface BdgRun {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a bdg command.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns stdout, stderr and the exit code
 */
async function run(args: string[]): Promise<BdgRun> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list
 * @returns stdout and stderr
 */
async function bdg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await run(args);
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * Run a bdg command with `--json` and return its envelope.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The envelope's data and warning, and the raw output
 */
async function bdgJson<T>(
  args: string[]
): Promise<{ data: T; warning?: string; stdout: string; stderr: string }> {
  const { stdout, stderr } = await bdg([...args, '--json']);
  const envelope = JSON.parse(stdout) as { data: T; warning?: string };
  return { ...envelope, stdout, stderr };
}

/**
 * Wait until the page's title is the one given (within 15 s).
 *
 * @param title - Expected title
 */
async function waitForTitle(title: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await runCommand('dom', ['eval', 'document.title', '--json'], {
      timeout: 30000,
    });
    if (result.stdout.includes(`"${title}"`)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`the page title did not become ${title}`);
}

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

/** What the tests read of a click's `--json` data */
interface ClickJson {
  navigation?: { url: string; sameDocument: boolean };
  triggeredRequests?: Array<{ url: string; resourceType?: string }>;
  opened?: OpenedTab[];
}

void describe('Page URLs with credentials', () => {
  let fixture: FixtureServer;
  let origin: string;
  let startUrl: string;
  let shownStartUrl: string;
  let start: BdgRun;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    origin = fixture.url.replace(/\/$/, '');
    const host = origin.replace(/^http:\/\//, '');
    const m = (name: string): string => `${name}${URL_SECRET_MARKER}`;
    startUrl = `http://bob:${PASSWORD}@${host}${URL_CREDS_PATH}#id_token=${m('QT-ID')}`;
    shownStartUrl = `${origin}/url-creds?token=${MASK}&q=plain#id_token=${MASK}`;
    const port = await getFreePort();
    start = await run([startUrl, '--port', String(port), '--headless']);
    assert.equal(start.exitCode, 0, `Start failed: ${start.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('the start output shows the target without the user info and with the tokens masked', () => {
    const output = `${start.stdout}${start.stderr}`;
    assert.doesNotMatch(output, ANY_SECRET);
    assert.doesNotMatch(output, USER_INFO);
    assert.ok(output.includes(`Target: ${shownStartUrl}`), output);
  });

  void it('daemon.log holds no credential', async () => {
    const log = await daemonLogWith('Target updated');
    assert.doesNotMatch(log, ANY_SECRET);
    assert.doesNotMatch(log, USER_INFO);
    assert.ok(log.includes(`Navigating to ${shownStartUrl}`), log);
  });

  void it('a second start names the running session without its credentials', async () => {
    const again = await run([startUrl, '--headless']);
    assert.notEqual(again.exitCode, 0);
    const output = `${again.stdout}${again.stderr}`;
    assert.doesNotMatch(output, ANY_SECRET);
    assert.doesNotMatch(output, USER_INFO);
    assert.ok(output.includes(shownStartUrl), output);
  });

  void it('status masks the URL, human, --verbose and --json', async () => {
    for (const args of [['status'], ['status', '--verbose']]) {
      const { stdout } = await bdg(args);
      assert.doesNotMatch(stdout, ANY_SECRET);
      assert.doesNotMatch(stdout, USER_INFO);
      assert.ok(stdout.includes(shownStartUrl), stdout);
    }
    const { data, stdout } = await bdgJson<{ pageState: { url: string } }>(['status']);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(data.pageState.url, shownStartUrl);
  });

  void it('status --include-sensitive shows the tokens but not the user info, with a warning', async () => {
    const human = await bdg(['status', '--include-sensitive']);
    assert.doesNotMatch(human.stdout, USER_INFO);
    assert.ok(human.stdout.includes(`token=QT-SESSION${URL_SECRET_MARKER}`), human.stdout);
    assert.match(human.stderr, /Warning: .*credentials/i);
    const json = await bdgJson<{ pageState: { url: string } }>(['status', '--include-sensitive']);
    assert.doesNotMatch(json.data.pageState.url, USER_INFO);
    assert.ok(json.data.pageState.url.includes(`#id_token=QT-ID${URL_SECRET_MARKER}`));
    assert.match(json.warning ?? '', /credentials/i);
  });

  void it('sessions masks the URL, human and --json; --include-sensitive shows the tokens', async () => {
    const human = await bdg(['sessions']);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.doesNotMatch(human.stdout, USER_INFO);
    assert.ok(human.stdout.includes(shownStartUrl), human.stdout);
    const json = await bdgJson<{ sessions: Array<{ url?: string }> }>(['sessions']);
    assert.equal(json.data.sessions[0]?.url, shownStartUrl);
    const raw = await bdgJson<{ sessions: Array<{ url?: string }> }>([
      'sessions',
      '--include-sensitive',
    ]);
    assert.doesNotMatch(raw.data.sessions[0]?.url ?? '', USER_INFO);
    assert.ok(raw.data.sessions[0]?.url?.includes(`token=QT-SESSION${URL_SECRET_MARKER}`));
    assert.match(raw.warning ?? '', /credentials/i);
  });

  void it('page info masks the URL, human and --json; --include-sensitive shows the tokens', async () => {
    const human = await bdg(['page', 'info']);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.doesNotMatch(human.stdout, USER_INFO);
    assert.ok(human.stdout.includes(shownStartUrl), human.stdout);
    const json = await bdgJson<{ url: string }>(['page', 'info']);
    assert.equal(json.data.url, shownStartUrl);
    const raw = await bdgJson<{ url: string }>(['page', 'info', '--include-sensitive']);
    assert.doesNotMatch(raw.data.url, USER_INFO);
    assert.ok(raw.data.url.includes(`token=QT-SESSION${URL_SECRET_MARKER}`));
    assert.match(raw.warning ?? '', /credentials/i);
  });

  void it('dom form --json resolves the action without the user info', async () => {
    const { data, stdout } = await bdgJson<{ forms: Array<{ action: string | null }> }>([
      'dom',
      'form',
    ]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.doesNotMatch(stdout, USER_INFO);
    assert.equal(data.forms[0]?.action, `${origin}/url-creds-landing`);
  });

  void it('dom a11y tree --json shows the root url masked', async () => {
    const { stdout } = await bdgJson<unknown>(['dom', 'a11y', 'tree', '--limit', '0']);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.doesNotMatch(stdout, USER_INFO);
    assert.ok(stdout.includes(JSON.stringify(shownStartUrl)), stdout);
  });

  void it('a click that opens a window lists it masked; page tabs and page close too', async () => {
    const click = await bdgJson<ClickJson>(['dom', 'click', '#open-popup']);
    assert.doesNotMatch(click.stdout, ANY_SECRET);
    assert.equal(click.data.opened?.[0]?.url, `${origin}/url-creds-popup?token=${MASK}`);
    const human = await bdg(['page', 'tabs']);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.doesNotMatch(human.stdout, USER_INFO);
    assert.ok(human.stdout.includes(`url-creds-popup?token=${MASK}`), human.stdout);
    const tabs = await bdgJson<PageTabsData>(['page', 'tabs']);
    assert.equal(tabs.data.tabs[0]?.url, shownStartUrl);
    assert.equal(tabs.data.tabs[1]?.url, `${origin}/url-creds-popup?token=${MASK}`);
    const raw = await bdgJson<PageTabsData>(['page', 'tabs', '--include-sensitive']);
    assert.doesNotMatch(raw.stdout, USER_INFO);
    assert.equal(
      raw.data.tabs[1]?.url,
      `${origin}/url-creds-popup?token=QT-POPUP${URL_SECRET_MARKER}`
    );
    assert.match(raw.warning ?? '', /credentials/i);
    const closed = await bdgJson<PageCloseData>(['page', 'close', '1']);
    assert.doesNotMatch(closed.stdout, ANY_SECRET);
    assert.equal(closed.data.closed.url, `${origin}/url-creds-popup?token=${MASK}`);
    assert.equal(closed.data.current.url, shownStartUrl);
  });

  void it('a click that sends requests lists them masked, the WebSocket too', async () => {
    const click = await bdgJson<ClickJson>(['dom', 'click', '#fetch']);
    await waitForTitle('fetched');
    assert.doesNotMatch(click.stdout, ANY_SECRET);
    assert.doesNotMatch(click.stdout, USER_INFO);
    const urls = (click.data.triggeredRequests ?? []).map((request) => request.url);
    assert.ok(urls.includes(`${origin}/url-creds-api?access_token=${MASK}&q=plain`), click.stdout);
    assert.ok(
      urls.includes(`ws://${origin.replace(/^http:\/\//, '')}/ws?token=${MASK}`),
      click.stdout
    );
  });

  void it('network list and peek mask the URLs; --include-sensitive shows the tokens', async () => {
    for (const verbose of [false, true]) {
      for (const args of [
        ['network', 'list', '--last', '0'],
        ['peek', '--last', '0'],
      ]) {
        const { stdout } = await bdg(verbose ? [...args, '-v'] : args);
        assert.doesNotMatch(stdout, ANY_SECRET, args.join(' '));
        assert.doesNotMatch(stdout, USER_INFO, args.join(' '));
        assert.doesNotMatch(stdout, /%E2%80%A2/, 'the mask is not percent-encoded');
        assert.ok(stdout.includes(`token=${MASK}`), `${args.join(' ')}: ${stdout}`);
        if (verbose) {
          assert.ok(
            stdout.includes(`${origin}/url-creds-api?access_token=${MASK}&q=plain`),
            stdout
          );
        }
      }
    }
    const list = await bdgJson<{ requests: Array<{ url: string }> }>([
      'network',
      'list',
      '--last',
      '0',
    ]);
    assert.doesNotMatch(list.stdout, ANY_SECRET);
    assert.ok(
      list.data.requests.some((r) => r.url === `${origin}/url-creds?token=${MASK}&q=plain`)
    );
    const peek = await bdgJson<{ network?: Array<{ url: string }>; target: { url: string } }>([
      'peek',
      '--last',
      '0',
    ]);
    assert.doesNotMatch(peek.stdout, ANY_SECRET);
    assert.equal(peek.data.target.url, shownStartUrl);
    assert.ok(
      peek.data.network?.some(
        (r) => r.url === `${origin}/url-creds-api?access_token=${MASK}&q=plain`
      )
    );

    const rawList = await bdgJson<{ requests: Array<{ url: string }> }>([
      'network',
      'list',
      '--last',
      '0',
      '--include-sensitive',
    ]);
    assert.doesNotMatch(rawList.stdout, USER_INFO);
    assert.ok(
      rawList.data.requests.some((r) => r.url.includes(`access_token=QT-FETCH${URL_SECRET_MARKER}`))
    );
    assert.match(rawList.warning ?? '', /credentials/i);
    const rawPeek = await bdg(['peek', '--last', '0', '-v', '--include-sensitive']);
    assert.doesNotMatch(rawPeek.stdout, USER_INFO);
    assert.ok(rawPeek.stdout.includes(`token=QT-SESSION${URL_SECRET_MARKER}`), rawPeek.stdout);
    assert.match(rawPeek.stderr, /Warning: .*credentials/i);
  });

  void it('a click that navigates reports the new URL masked, human and --json', async () => {
    const tokens = await bdgJson<ClickJson>(['dom', 'click', '#go-tokens']);
    assert.doesNotMatch(tokens.stdout, ANY_SECRET);
    assert.equal(
      tokens.data.navigation?.url,
      `${origin}/url-creds-landing?access_token=${MASK}&code=${MASK}&q=plain`
    );
    const info = await bdgJson<{ url: string }>(['page', 'info']);
    assert.equal(
      info.data.url,
      `${origin}/url-creds-landing?access_token=${MASK}&code=${MASK}&q=plain`
    );
    await bdg(['page', 'back']);

    const card = await bdg(['dom', 'click', '#go-card']);
    assert.doesNotMatch(card.stdout, ANY_SECRET);
    assert.ok(
      card.stdout.includes(
        `navigated to ${origin}/url-creds-landing?password=${MASK}&cc-number=${MASK}`
      ),
      card.stdout
    );
    await bdg(['page', 'back']);

    const hash = await bdgJson<ClickJson>(['dom', 'click', '#go-hash']);
    assert.doesNotMatch(hash.stdout, ANY_SECRET);
    assert.equal(hash.data.navigation?.url, `${origin}/url-creds-landing#id_token=${MASK}`);
    await bdg(['page', 'back']);
  });

  void it('page navigate reports the URL without the user info and with the token masked', async () => {
    const host = origin.replace(/^http:\/\//, '');
    const target = `http://bob:${PASSWORD}@${host}/url-creds-landing?token=QT-NAV${URL_SECRET_MARKER}&q=plain`;
    const human = await bdg(['page', 'navigate', target]);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.doesNotMatch(human.stdout, USER_INFO);
    assert.ok(
      human.stdout.includes(`${origin}/url-creds-landing?token=${MASK}&q=plain`),
      human.stdout
    );
    const json = await bdgJson<{ url: string }>(['page', 'navigate', target]);
    assert.equal(json.data.url, `${origin}/url-creds-landing?token=${MASK}&q=plain`);
    const log = await daemonLogWith('Target updated');
    assert.doesNotMatch(log, ANY_SECRET);
    assert.doesNotMatch(log, USER_INFO);
  });
});
