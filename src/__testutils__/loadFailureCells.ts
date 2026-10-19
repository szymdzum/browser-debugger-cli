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
  | { kind: 'pending'; shows: RegExp };

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

/** Tracks a failed load that a command reports as success (start, navigate, reload, wait, console, attach) */
const ISSUE_860 = '#860: a failed load is reported as success';

/** Tracks a click or submit that ends on a failed or never-ending navigation and reports success */
const ISSUE_873 = '#873: a click or submit on a failed or never-ending navigation reports success';

/** Why `dom submit` on a failed load has no cell */
const NONDETERMINISTIC = 'nondeterministic until #873: the result depends on the network-idle wait';

const UNREACHABLE = 'Chrome never shows a document for a request the server does not answer';

/** The rows of the matrix */
export const ROWS: readonly Row[] = [
  {
    id: 'connection refused',
    url: (s) => s.refusedUrl,
    expect: { kind: 'failure', cause: /ERR_CONNECTION_REFUSED/ },
    full: true,
    na: { submit: NONDETERMINISTIC },
    console: true,
    attach: (s) => String(new URL(s.refusedUrl).port),
    todo: {
      reload: ISSUE_860,
      click: ISSUE_873,
      wait: ISSUE_860,
      console: ISSUE_860,
      attach: ISSUE_860,
    },
  },
  {
    id: 'DNS failure',
    url: (s) => s.unresolvableUrl,
    expect: {
      kind: 'failure',
      cause: /ERR_NAME_NOT_RESOLVED/,
    },
    console: true,
    todo: { console: ISSUE_860 },
  },
  {
    id: 'connection reset mid-response',
    url: (s) => `${s.url}reset`,
    expect: { kind: 'failure', cause: /ERR_CONNECTION_RESET/ },
    console: true,
    todo: { console: ISSUE_860 },
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
    na: { submit: NONDETERMINISTIC },
    console: true,
    attach: () => 'https://127.0.0.1',
    todo: {
      start: ISSUE_860,
      navigate: ISSUE_860,
      reload: ISSUE_860,
      click: ISSUE_873,
      wait: ISSUE_860,
      console: ISSUE_860,
      attach: ISSUE_860,
    },
  },
  {
    id: 'body shorter than Content-Length (the page stays loading)',
    url: (s) => `${s.url}truncated`,
    expect: { kind: 'pending', shows: NOT_DONE },
    console: true,
    na: { start: 'budget: navigate meets the same document and takes 5 s here' },
  },
  {
    id: 'redirect loop',
    url: (s) => `${s.url}redirect-loop`,
    expect: { kind: 'failure', cause: /ERR_TOO_MANY_REDIRECTS/ },
    full: true,
    na: { submit: NONDETERMINISTIC },
    console: true,
    todo: {
      start: ISSUE_860,
      navigate: ISSUE_860,
      reload: ISSUE_860,
      click: ISSUE_873,
      wait: ISSUE_860,
      console: ISSUE_860,
    },
  },
  {
    id: 'redirect to chrome://',
    url: (s) => `${s.url}redirect-chrome`,
    expect: { kind: 'failure', cause: /ERR_UNSAFE_REDIRECT/ },
    todo: { start: ISSUE_860, navigate: ISSUE_860 },
  },
  {
    id: 'redirect to about:blank',
    url: (s) => `${s.url}redirect-about`,
    expect: { kind: 'failure', cause: /ERR_UNSAFE_REDIRECT/ },
    todo: { start: ISSUE_860, navigate: ISSUE_860 },
  },
  {
    id: 'file:// missing',
    url: (s) => s.missingFileUrl,
    expect: { kind: 'failure', cause: /ERR_FILE_NOT_FOUND/ },
    full: true,
    todo: { reload: ISSUE_860, wait: ISSUE_860 },
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
    todo: { click: ISSUE_873 },
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
  if (expect.kind === 'failure') {
    if (!EXIT_VALUES.has(run.exitCode) || ok)
      problems.push(`exit ${run.exitCode} is not an error code`);
    const claim = FALSE_SUCCESS.exec(run.output);
    if (claim) problems.push(`says "${claim[0]}" about a failed load`);
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
