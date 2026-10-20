/**
 * The cells of the load-failure matrix (#862) and the oracle they are judged by.
 *
 * Every row is one URL a navigation can meet, with the outcome bdg must report
 * for it. Every command that navigates or waits on a load is judged by the same
 * oracle, so a new command or a new failure is one more entry here, not another
 * set of asserts. A command that cannot reach a row is `na` with the reason; a
 * cell that fails the oracle today carries its `todo` (the issue that tracks it).
 */

import type { HostileServer } from '@/__testutils__/hostileServer.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** The commands the matrix drives */
export type Axis =
  'start' | 'navigate' | 'reload' | 'click' | 'submit' | 'wait' | 'console' | 'attach';

/** What bdg must report for a row */
export type Expectation =
  | { kind: 'failure'; cause: RegExp }
  | { kind: 'loads'; shows?: RegExp }
  | { kind: 'warns'; cause: RegExp }
  | { kind: 'pending'; shows: RegExp }
  | { kind: 'actionFailure'; cause: RegExp }
  | { kind: 'loading' };

/** One URL of the matrix */
export interface Row {
  id: string;
  /** The URL, or undefined when no command can be given it (a `blob:` URL exists in one document only) */
  url: (server: HostileServer) => string | undefined;
  /** The page with the link and the form that lead to the URL (default `/launch?to=URL`) */
  launch?: (server: HostileServer) => string;
  expect: Expectation;
  /** Reason the command cannot reach this row */
  na?: Partial<Record<Axis, string>>;
  /** Issue that tracks a cell failing the oracle today */
  todo?: Partial<Record<Axis, string>>;
  /** The in-session commands and the `--json` variants run on the row (otherwise start and navigate, human output only) */
  full?: boolean;
  /** `bdg console` after the load must not say "No errors" */
  console?: boolean;
  /** What `dom click` and `dom submit` must report, when it is not {@link actionExpectation}'s default */
  actions?: Expectation;
  /** Pattern that picks the row's tab for `attach` (rows without one have no attach cell) */
  attach?: (server: HostileServer) => string;
}

/** Output of a run: what the oracle reads */
export interface Observed {
  exitCode: number;
  output: string;
}

/** Output of a `--json` run */
export interface ObservedJson {
  exitCode: number;
  envelope: { success?: boolean; error?: string; exitCode?: number } & Record<string, unknown>;
}

/** What a failed load must never say */
const FALSE_SUCCESS = /✓|Session Started|Navigated|No errors|Reloaded|Page loaded|Element Clicked/;

/** Ways a command says that the page is not done or did not answer */
const NOT_DONE = /⚠|timed out|"warnings?"|"readyState":"loading"/i;

const EXIT_VALUES: ReadonlySet<number> = new Set(Object.values(EXIT_CODES));

/** The reason a command has no cell for a row it does not reach through a link */
const NO_LINK_TO = (what: string): string =>
  `a page cannot link to ${what} (Chrome blocks the navigation)`;

/** How an action says the new page has not finished loading */
const STILL_LOADING = /still loading/i;

const UNREACHABLE = 'Chrome never shows a document for a request the server does not answer';

/** The rows of the matrix */
export const ROWS: readonly Row[] = [
  {
    id: 'connection refused',
    url: (s) => s.refusedUrl,
    expect: { kind: 'failure', cause: /ERR_CONNECTION_REFUSED/ },
    full: true,
    console: true,
    attach: (s) => new URL(s.refusedUrl).host,
  },
  {
    id: 'DNS failure',
    url: (s) => s.unresolvableUrl,
    expect: {
      kind: 'failure',
      cause: /ERR_NAME_NOT_RESOLVED/,
    },
    console: true,
  },
  {
    id: 'connection reset mid-response',
    url: (s) => `${s.url}reset`,
    expect: { kind: 'failure', cause: /ERR_CONNECTION_RESET/ },
    console: true,
  },
  {
    id: 'connection closed before a byte',
    url: (s) => `${s.url}reset-early`,
    expect: { kind: 'failure', cause: /ERR_EMPTY_RESPONSE/ },
  },
  {
    id: 'TLS to a plain-HTTP port',
    url: (s) => s.tlsToPlainUrl,
    expect: { kind: 'failure', cause: /ERR_SSL_PROTOCOL_ERROR/ },
    full: true,
    console: true,
    attach: () => 'https://127.0.0.1',
  },
  {
    id: 'body shorter than Content-Length',
    url: (s) => `${s.url}truncated`,
    expect: { kind: 'failure', cause: /ERR_CONTENT_LENGTH_MISMATCH/ },
    console: true,
  },
  {
    id: 'redirect loop',
    url: (s) => `${s.url}redirect-loop`,
    expect: { kind: 'failure', cause: /ERR_TOO_MANY_REDIRECTS/ },
    full: true,
    console: true,
  },
  {
    id: 'redirect to chrome://',
    url: (s) => `${s.url}redirect-chrome`,
    expect: { kind: 'failure', cause: /ERR_UNSAFE_REDIRECT/ },
  },
  {
    id: 'redirect to about:blank',
    url: (s) => `${s.url}redirect-about`,
    expect: { kind: 'failure', cause: /ERR_UNSAFE_REDIRECT/ },
  },
  {
    id: 'file:// missing',
    url: (s) => s.missingFileUrl,
    expect: { kind: 'failure', cause: /ERR_FILE_NOT_FOUND/ },
    full: true,
    na: { click: NO_LINK_TO('file://'), submit: NO_LINK_TO('file://') },
  },
  {
    id: 'view-source:',
    url: (s) => `view-source:${s.url}ok`,
    expect: { kind: 'failure', cause: /Invalid URL/ },
    na: {
      reload: 'bdg rejects the URL, so no page is there to reload',
      click: NO_LINK_TO('view-source:'),
      submit: NO_LINK_TO('view-source:'),
      wait: 'bdg rejects the URL, so no load is there to wait on',
    },
  },
  {
    id: 'server never answers',
    url: (s) => `${s.url}hang`,
    expect: { kind: 'pending', shows: NOT_DONE },
    full: true,
    na: {
      start:
        'no time limit to shorten: bdg waits 45 s for Chrome (exit 102) and the tab stays held',
      reload: UNREACHABLE,
    },
  },
  {
    id: 'response never ends',
    url: (s) => `${s.url}endless`,
    expect: { kind: 'pending', shows: NOT_DONE },
    full: true,
    actions: { kind: 'loading' },
  },
  {
    id: '204 No Content',
    url: (s) => `${s.url}status/204`,
    expect: { kind: 'loads' },
  },
  {
    id: '304 Not Modified',
    url: (s) => `${s.url}status/304`,
    expect: { kind: 'loads' },
    na: { start: 'budget: starts like 204, which ends the same way (ERR_ABORTED) and takes 5 s' },
  },
  {
    id: '404 without a body',
    url: (s) => `${s.url}status/404`,
    expect: { kind: 'loads', shows: /404/ },
  },
  {
    id: '404 with a body',
    url: (s) => `${s.url}status/404-body`,
    expect: { kind: 'loads', shows: /404/ },
    full: true,
    attach: () => 'status/404-body',
  },
  {
    id: '500 without a body',
    url: (s) => `${s.url}status/500`,
    expect: { kind: 'loads', shows: /500/ },
  },
  {
    id: '500 with a body',
    url: (s) => `${s.url}status/500-body`,
    expect: { kind: 'loads', shows: /500/ },
  },
  {
    id: 'CSP blocks the scripts',
    url: (s) => `${s.url}csp`,
    expect: { kind: 'loads' },
    console: true,
  },
  {
    id: 'data:',
    url: () => 'data:text/html,%3Ctitle%3EHostile%20data%3C%2Ftitle%3E',
    expect: { kind: 'loads' },
    na: { click: NO_LINK_TO('data:'), submit: NO_LINK_TO('data:') },
  },
  {
    id: 'about:blank',
    url: () => 'about:blank',
    expect: { kind: 'loads' },
  },
  {
    id: 'file:// present',
    url: (s) => s.fileUrl,
    expect: { kind: 'loads' },
    na: { click: NO_LINK_TO('file://'), submit: NO_LINK_TO('file://') },
  },
  {
    id: 'blob:',
    url: () => undefined,
    launch: (s) => `${s.url}launch-blob`,
    expect: { kind: 'loads' },
    full: true,
    na: {
      start: 'a blob: URL exists in the document that made it only',
      navigate: 'a blob: URL exists in the document that made it only',
      reload: 'a blob: URL exists in the document that made it only',
      wait: 'a blob: URL exists in the document that made it only',
      submit:
        'a GET form adds its query to the blob: URL, which then names no blob (ERR_FILE_NOT_FOUND)',
    },
  },
];

/**
 * Check a human-output run against the expectation.
 *
 * @param expect - What bdg must report
 * @param run - The command's exit code and output
 * @returns What breaks the oracle (empty when it holds)
 */
function judgeHuman(expect: Expectation, run: Observed): string[] {
  const problems: string[] = [];
  const ok = run.exitCode === 0;
  if (expect.kind === 'actionFailure') {
    if (run.exitCode !== EXIT_CODES.INVALID_URL)
      problems.push(
        `exit ${run.exitCode}, a navigation that failed exits ${EXIT_CODES.INVALID_URL}`
      );
    if (!run.output.includes('⚠')) problems.push('no ⚠ verdict about the failed navigation');
    if (run.output.includes('✓')) problems.push('says "✓" about a failed navigation');
    if (!expect.cause.test(run.output)) problems.push(`does not name the cause ${expect.cause}`);
    return problems;
  }
  if (expect.kind === 'loading') {
    if (!ok) problems.push(`exit ${run.exitCode}, a page still loading is no failure`);
    if (!run.output.includes('⚠')) problems.push('no ⚠ warning about a page still loading');
    if (!STILL_LOADING.test(run.output)) problems.push(`does not say ${STILL_LOADING}`);
    return problems;
  }
  if (expect.kind === 'failure') {
    if (!EXIT_VALUES.has(run.exitCode) || ok)
      problems.push(`exit ${run.exitCode} is not an error code`);
    const claim = FALSE_SUCCESS.exec(run.output);
    if (claim) problems.push(`says "${claim[0]}" about a failed load`);
    if (!expect.cause.test(run.output)) problems.push(`does not name the cause ${expect.cause}`);
    return problems;
  }
  if (expect.kind === 'warns') {
    if (!ok) problems.push(`exit ${run.exitCode}, the command must succeed with a warning`);
    if (!run.output.includes('⚠')) problems.push('no ⚠ warning about the failed load');
    if (!expect.cause.test(run.output)) problems.push(`does not name the cause ${expect.cause}`);
    return problems;
  }
  if (expect.kind === 'loads') {
    if (!ok) problems.push(`exit ${run.exitCode}, the page loads`);
    if (expect.shows && !expect.shows.test(run.output))
      problems.push(`does not show ${expect.shows}`);
    return problems;
  }
  if (!expect.shows.test(run.output))
    problems.push(`does not say the page is not done (${expect.shows})`);
  if (ok && !run.output.includes('⚠'))
    problems.push('exit 0 and no warning about a page that is not done');
  return problems;
}

/**
 * Check a `--json` run against the expectation.
 *
 * @param expect - What bdg must report
 * @param run - The command's exit code and envelope
 * @returns What breaks the oracle (empty when it holds)
 */
function judgeJson(expect: Expectation, run: ObservedJson): string[] {
  const { envelope } = run;
  const shown = JSON.stringify(envelope);
  if (expect.kind === 'actionFailure') return judgeActionFailureJson(expect.cause, run);
  if (expect.kind === 'loading') {
    return run.exitCode === 0 &&
      envelope.success === true &&
      /still loading|"navigation":true/i.test(shown)
      ? []
      : [`--json: exit ${run.exitCode}, success must be true and say the page is still loading`];
  }
  if (expect.kind === 'failure') {
    const problems: string[] = [];
    if (envelope.success !== false) problems.push(`--json: success is ${String(envelope.success)}`);
    if (envelope.exitCode !== run.exitCode)
      problems.push(
        `--json: exitCode ${String(envelope.exitCode)} is not the exit ${run.exitCode}`
      );
    if (!expect.cause.test(String(envelope.error)))
      problems.push(`--json: error does not name the cause ${expect.cause}`);
    return problems;
  }
  if (expect.kind === 'warns') {
    const warnings = JSON.stringify(envelope['warnings'] ?? []);
    return run.exitCode === 0 && envelope.success === true && expect.cause.test(warnings)
      ? []
      : [`--json: exit ${run.exitCode}, success must be true with the cause in warnings`];
  }
  if (expect.kind === 'loads') {
    const shows =
      expect.shows && !expect.shows.test(shown) ? [`--json: does not show ${expect.shows}`] : [];
    return run.exitCode === 0 && envelope.success === true
      ? shows
      : [`--json: exit ${run.exitCode}, the page loads`, ...shows];
  }
  return expect.shows.test(shown)
    ? []
    : [`--json: does not say the page is not done (${expect.shows})`];
}

/**
 * Check the `--json` run of an action whose navigation failed: an error
 * envelope (exit 80) that names the cause and keeps the action's data.
 *
 * @param cause - The network error the output must name
 * @param run - The command's exit code and envelope
 * @returns What breaks the oracle (empty when it holds)
 */
function judgeActionFailureJson(cause: RegExp, run: ObservedJson): string[] {
  const { envelope } = run;
  const failed = envelope['navigationFailed'] as { errorText?: string } | undefined;
  const problems: string[] = [];
  if (envelope.success !== false) problems.push(`--json: success is ${String(envelope.success)}`);
  if (run.exitCode !== EXIT_CODES.INVALID_URL || envelope.exitCode !== run.exitCode)
    problems.push(`--json: exit ${run.exitCode} (exitCode ${String(envelope.exitCode)}), not 80`);
  if (!cause.test(String(envelope.error))) problems.push(`--json: error does not name ${cause}`);
  if (!cause.test(String(failed?.errorText)))
    problems.push(`--json: navigationFailed.errorText does not name ${cause}`);
  if (envelope['selector'] === undefined) problems.push("--json: the action's data is missing");
  return problems;
}

/**
 * What an action that starts a navigation (`dom click`, `dom submit`) must
 * report for a row: its own expectation when it has one, a failed load as
 * an action failure (exit 80, ⚠, the cause), the row's expectation otherwise.
 *
 * @param row - The row
 * @returns The expectation for the action's cell
 */
export function actionExpectation(row: Row): Expectation {
  if (row.actions) return row.actions;
  return row.expect.kind === 'failure'
    ? { kind: 'actionFailure', cause: row.expect.cause }
    : row.expect;
}

/**
 * Judge the human and, when there is one, the `--json` run of a cell.
 *
 * @param expect - What bdg must report
 * @param human - The run without `--json`
 * @param json - The run with `--json`
 * @returns What breaks the oracle (empty when it holds)
 */
export function judge(expect: Expectation, human: Observed, json?: ObservedJson): string[] {
  return [...judgeHuman(expect, human), ...(json ? judgeJson(expect, json) : [])];
}
