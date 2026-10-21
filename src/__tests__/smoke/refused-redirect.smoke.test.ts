/**
 * Redirects Chrome refuses (#890): a server that redirects to a scheme Chrome
 * does not load as a page (`myapp://`, `javascript:`, `view-source:`) fails the navigation with exit 80, naming the refused URL and
 * Chrome's error (`net::ERR_ABORTED`), as a redirect to `data:`, `file:` or
 * `chrome://` does (`ERR_UNSAFE_REDIRECT`); a 204, a download and an http
 * page behind the same redirect still load. The matrix is redirect target ×
 * entry path (`bdg URL`, `page navigate`, `dom click` on a link), plus
 * `dom submit` of a form whose action redirects to a refused scheme, and
 * `--json` on one refused cell per path. Rows are judged by the oracle of
 * `loadFailureCells.ts`.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setImmediate as setImmediatePromise } from 'node:timers/promises';

import type { HostileServer } from '@/__testutils__/hostileServer.js';
import {
  actionExpectation,
  judge,
  type Expectation,
  type ObservedJson,
  type Row,
} from '@/__testutils__/loadFailureCells.js';
import {
  bdg,
  bdgJson,
  chromePort,
  closeTab,
  hostileServer,
  listTabs,
  openTab,
  reachLaunch,
  setUpMatrix,
  startSession,
  tearDownMatrix,
  urlOf,
} from '@/__testutils__/loadFailureHarness.js';
import { removeTempDirs } from '@/__testutils__/tempDirs.js';

after(removeTempDirs);

/** Chrome's error for a redirect it refuses */
const ABORTED: Expectation = { kind: 'failure', cause: /ERR_ABORTED/ };

/** Chrome's error for a redirect to a local scheme */
const UNSAFE: Expectation = { kind: 'failure', cause: /ERR_UNSAFE_REDIRECT/ };

/** One redirect target of the matrix */
interface Target {
  id: string;
  /** Where the redirect leads */
  to: (server: HostileServer) => string;
  expect: Expectation;
  /** Text the output must show: the refused URL */
  names?: string;
}

/** The redirect targets */
const TARGETS: readonly Target[] = [
  { id: 'myapp://', to: () => 'myapp://callback', expect: ABORTED, names: 'myapp://callback' },
  {
    id: 'javascript:',
    to: () => 'javascript:alert(1)',
    expect: ABORTED,
    names: 'javascript:alert(1)',
  },
  {
    id: 'view-source:',
    to: (s) => `view-source:${s.url}ok`,
    expect: ABORTED,
    names: 'view-source:',
  },
  { id: 'data:', to: () => 'data:text/html,<title>D</title>', expect: UNSAFE },
  { id: 'file:', to: (s) => s.fileUrl, expect: UNSAFE },
  { id: 'chrome://', to: () => 'chrome://version', expect: UNSAFE },
  { id: '204', to: (s) => `${s.url}status/204`, expect: { kind: 'loads' } },
  { id: 'download', to: (s) => `${s.url}download`, expect: { kind: 'loads' } },
  { id: 'http 200', to: (s) => `${s.url}ok`, expect: { kind: 'loads', shows: /:\d+\/ok\b/ } },
];

/** The target that also gets a `--json` run on each path */
const JSON_TARGET = 'myapp://';

/**
 * The target as a row of the load-failure oracle.
 *
 * @param target - Redirect target
 * @returns Row whose URL redirects to it
 */
function rowOf(target: Target): Row {
  return {
    id: `redirect to ${target.id}`,
    url: (s) => s.redirectUrl(target.to(s)),
    expect: target.expect,
  };
}

/** A bdg command: what follows `bdg` */
type Command = [command: string, args: string[]];

/**
 * Run a cell: human output, and `--json` for the JSON target; judged by the
 * oracle, and a refused redirect's output must name the refused URL.
 *
 * @param target - Redirect target
 * @param expect - What bdg must report
 * @param prepare - Puts the session in the state the command starts from
 * @param run - The command and its arguments, run as is and with `--json`
 */
async function cell(
  target: Target,
  expect: Expectation,
  prepare: () => Promise<void>,
  run: Command
): Promise<void> {
  const [command, args] = run;
  await prepare();
  const human = await bdg(command, args);
  let json: ObservedJson | undefined;
  if (target.id === JSON_TARGET) {
    await prepare();
    json = await bdgJson(command, args);
  }
  const problems = judge(expect, human, json);
  if (target.names && !human.output.includes(target.names))
    problems.push(`does not name the refused URL ${target.names}`);
  if (json && target.names && !String(json.envelope.error).includes(target.names))
    problems.push(`--json: error does not name the refused URL ${target.names}`);
  assert.deepEqual(
    problems,
    [],
    `${target.id}\nhuman: ${JSON.stringify(human)}\njson: ${JSON.stringify(json)}`
  );
}

/**
 * The redirect URL of a target.
 *
 * @param target - Redirect target
 * @returns URL that redirects to it
 */
function redirectTo(target: Target): string {
  return urlOf(rowOf(target));
}

/**
 * A new session, in a new tab (the others closed), on the page that leads to
 * a row. On Linux Chrome hands `myapp://` to `xdg-open` and asks first: the
 * prompt stays on its tab and takes the mouse, so a later action in that tab
 * would not reach the page.
 *
 * @param row - The row
 */
async function inFreshTab(row: Row): Promise<void> {
  await bdg('stop');
  const old = await listTabs();
  const created = await openTab('about:blank');
  await Promise.all(old.map(closeTab));
  while ((await listTabs()).some((id) => id !== created.id)) await setImmediatePromise();
  await startSession();
  await reachLaunch(row);
}

void describe('Refused redirects (#890)', () => {
  before(setUpMatrix);

  after(async () => {
    try {
      await bdg('stop');
    } finally {
      await tearDownMatrix();
    }
  });

  void describe('bdg URL', () => {
    for (const target of TARGETS) {
      void it(`start: ${target.id}`, () =>
        cell(target, target.expect, async () => void (await bdg('stop')), [
          redirectTo(target),
          ['--chrome-ws-url', String(chromePort())],
        ]));
    }
    after(async () => void (await bdg('stop')));
  });

  void describe('in a session', () => {
    before(startSession);
    after(async () => void (await bdg('stop')));

    const backToOk = async (): Promise<void> => {
      await bdg('page', ['navigate', `${hostileServer().url}ok`]);
    };

    for (const target of TARGETS) {
      void it(`navigate: ${target.id}`, () =>
        cell(target, target.expect, backToOk, ['page', ['navigate', redirectTo(target)]]));
    }

    for (const target of TARGETS) {
      const row = rowOf(target);
      void it(`click: ${target.id}`, () =>
        cell(target, actionExpectation(row, 'click'), () => inFreshTab(row), [
          'dom',
          ['click', '#go'],
        ]));
    }

    for (const target of TARGETS.filter((t) => t.expect === ABORTED)) {
      const row = rowOf(target);
      void it(`submit: ${target.id}`, () =>
        cell(target, actionExpectation(row, 'submit'), () => inFreshTab(row), [
          'dom',
          ['submit', '#form', '--timeout', '1500'],
        ]));
    }
  });
});
