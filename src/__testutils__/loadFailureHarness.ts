/**
 * Shared setup and drivers of the load-failure matrix (#862), used by
 * `load-failure-start.smoke.test.ts` and `load-failure-actions.smoke.test.ts`
 * (two files so the smoke shards run them in parallel). Each file is its own
 * process, so the hostile server and the Chrome are module state.
 */

import * as assert from 'node:assert/strict';
import { it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { startHostileServer, type HostileServer } from '@/__testutils__/hostileServer.js';
import {
  judge,
  ROWS,
  type Axis,
  type Observed,
  type ObservedJson,
  type Row,
} from '@/__testutils__/loadFailureCells.js';
import { makeTempDir } from '@/__testutils__/tempDirs.js';
import { launchChrome } from '@/connection/launcher.js';
import type { LaunchedChrome } from '@/types.js';

/** Shortest navigation limit bdg accepts from the test environment (`page navigate`, `reload`) */
const TEST_ENV = { BDG_TEST_PAGE_READY_MS: '1000' };

/** `--timeout` of the commands that wait on a page that never answers */
export const WAIT_MS = '1500';

/** Why a row without `full` has no cell for an in-session command */
const LIMITED = 'budget: the row meets the same net error as a row that runs this command';

/** Proxy variables of the environment (Chrome gets `--no-proxy-server` too: the `.invalid` host must not reach a proxy) */
const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].flatMap((name) => [
  name,
  name.toLowerCase(),
]);

let hostile: HostileServer | undefined;
let chrome: LaunchedChrome | undefined;

/**
 * The running hostile server.
 *
 * @returns The server
 */
export function hostileServer(): HostileServer {
  assert.ok(hostile, 'the hostile server is not running');
  return hostile;
}

/**
 * The test's Chrome.
 *
 * @returns Its debugging port
 */
export function chromePort(): number {
  assert.ok(chrome, 'Chrome is not running');
  return chrome.port;
}

/**
 * Start the hostile server and a Chrome that bypasses any proxy of the environment.
 */
export async function setUpMatrix(): Promise<void> {
  for (const name of PROXY_VARIABLES) delete process.env[name];
  await cleanupAllSessions();
  hostile = await startHostileServer();
  chrome = await launchChrome({
    port: await getFreePort(),
    userDataDir: makeTempDir('bdg-matrix-chrome-'),
    headless: true,
    sessionDir: makeTempDir('bdg-matrix-session-'),
    chromeFlags: ['--no-proxy-server'],
  });
}

/**
 * Stop what {@link setUpMatrix} started; a failing step never skips the next.
 */
export async function tearDownMatrix(): Promise<void> {
  try {
    await cleanupAllSessions();
  } finally {
    try {
      await chrome?.kill();
    } finally {
      await hostile?.close();
    }
  }
}

/**
 * Run a bdg command.
 *
 * @param command - Command or URL
 * @param args - Arguments
 * @returns Exit code and output
 */
export async function bdg(command: string, args: string[] = []): Promise<Observed> {
  const result = await runCommand(command, args, { timeout: 60_000, env: TEST_ENV });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

/**
 * Run a bdg command with `--json`.
 *
 * @param command - Command or URL
 * @param args - Arguments
 * @returns Exit code and envelope
 */
export async function bdgJson(command: string, args: string[] = []): Promise<ObservedJson> {
  const result = await runCommand(command, [...args, '--json'], {
    timeout: 60_000,
    env: TEST_ENV,
  });
  const envelope = JSON.parse(result.stdout || '{}') as ObservedJson['envelope'];
  return { exitCode: result.exitCode, envelope };
}

/**
 * Run a cell and judge it: human output always, `--json` too when asked.
 *
 * @param row - The row
 * @param run - The command under test, with `--json` or without
 * @param prepare - Puts the session in the state the command starts from
 * @param withJson - Also run it with `--json`
 */
export async function checkCell(
  row: Row,
  run: (json: boolean) => Promise<Observed | ObservedJson>,
  prepare: () => Promise<void>,
  withJson: boolean
): Promise<void> {
  await prepare();
  const human = (await run(false)) as Observed;
  let json: ObservedJson | undefined;
  if (withJson) {
    await prepare();
    json = (await run(true)) as ObservedJson;
  }
  const problems = judge(row.expect, human, json);
  assert.deepEqual(
    problems,
    [],
    `${row.id}\nhuman: ${JSON.stringify(human)}\njson: ${JSON.stringify(json)}`
  );
}

/**
 * What a command can tell about a row: `dom wait --load` and `attach` do not
 * report an HTTP status, so a page that loads is judged by its exit code alone.
 *
 * @param row - The row
 * @param statusless - The command does not report an HTTP status
 * @returns The row's expectation for that command
 */
export function expectationFor(row: Row, statusless: boolean): Row['expect'] {
  return statusless && row.expect.kind === 'loads' ? { kind: 'loads' } : row.expect;
}

/**
 * Register one `it` per row for an axis: skipped with the reason when the
 * command cannot (or, for a row without `full`, need not) reach the row.
 *
 * @param axis - The command
 * @param cell - Runs one row
 * @param options - `full`: the axis runs on rows with `full` only; `flagged`: on rows with `console` only
 */
export function cellsFor(
  axis: Axis,
  cell: (row: Row) => Promise<void>,
  options: { full?: boolean; flagged?: boolean } = {}
): void {
  for (const row of ROWS) {
    if (options.flagged && !row.console) continue;
    const reason = row.na?.[axis] ?? (options.full && !row.full ? LIMITED : undefined);
    void it(`${axis}: ${row.id}`, { skip: reason, todo: row.todo?.[axis] }, () => cell(row));
  }
}

/**
 * The URL of a row.
 *
 * @param row - The row
 * @returns Its URL
 */
export function urlOf(row: Row): string {
  const url = row.url(hostileServer());
  assert.ok(url, `${row.id} has no URL`);
  return url;
}

/**
 * Whether a row is a failed load that gets the `--json` runs of the slow commands.
 *
 * @param row - The row
 * @returns True for a failure the matrix runs everywhere
 */
export function failsLoad(row: Row): boolean {
  return row.full === true && row.expect.kind === 'failure';
}

/**
 * Start the in-session commands' session on a plain page of the test's Chrome.
 */
export async function startSession(): Promise<void> {
  await bdg('stop');
  const started = await bdg(`${hostileServer().url}ok`, ['--chrome-ws-url', String(chromePort())]);
  assert.equal(started.exitCode, 0, started.output);
}

/**
 * Navigate to a row's URL (without waiting for a page that never answers).
 *
 * @param row - The row
 */
export async function reachUrl(row: Row): Promise<void> {
  const wait = row.expect.kind === 'pending' ? ['--no-wait'] : [];
  await bdg('page', ['navigate', urlOf(row), ...wait]);
}

/**
 * Navigate to the page with the link and the form that lead to a row.
 *
 * @param row - The row
 */
export async function reachLaunch(row: Row): Promise<void> {
  const server = hostileServer();
  const launched = await bdg('page', [
    'navigate',
    row.launch ? row.launch(server) : server.launchUrl(urlOf(row)),
  ]);
  assert.equal(launched.exitCode, 0, launched.output);
}

/**
 * Run one command on a row, from the state `reach` puts the session in.
 *
 * @param row - The row
 * @param command - Command
 * @param args - Arguments
 * @param reach - Puts the session in the state the command starts from
 * @param withJson - Also run it with `--json`
 */
export function runOn(
  row: Row,
  command: string,
  args: string[],
  reach: (row: Row) => Promise<void>,
  withJson: boolean
): Promise<void> {
  return checkCell(
    { ...row, expect: expectationFor(row, args.includes('--load')) },
    (json) => (json ? bdgJson(command, args) : bdg(command, args)),
    () => reach(row),
    withJson
  );
}
