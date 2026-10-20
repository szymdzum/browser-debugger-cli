#!/usr/bin/env node
/**
 * The mechanical half of the ship skill: worktrees, CI waits, merge-checks,
 * gates, merges, leftovers, brief rendering and the PR log. The orchestrator
 * judges; this script does what must be done the same way every time.
 *
 * Run `node .claude/skills/ship/scripts/ship.mjs help` for the commands.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.SHIP_REPO ?? 'szymdzum/browser-debugger-cli';
const NODE_BIN = join(homedir(), '.nvm/versions/node/v22.15.0/bin');
const POLL_MS = 60_000;
const SNAPSHOT = {
  bdg: '/tmp/ship-snapshot-bdg.txt',
  downloads: '/tmp/ship-snapshot-downloads.txt',
  main: '/tmp/ship-snapshot-main-checkout.txt',
  time: '/tmp/ship-snapshot-time.txt',
};

/** Exit codes of this script, so the orchestrator can branch on them */
export const EXIT = { ok: 0, failed: 1, usage: 2, superseded: 3, timeout: 4 };

const CALL_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 180_000;
let waiterDeadline = null;
let waiterState = null;

/**
 * Runs a command and returns its trimmed stdout; throws with stderr on failure.
 * A command that outlives `timeoutMs` (default 60 s, so a hung gh cannot block
 * a waiter) is killed and fails with `timedOut` set and a message naming the
 * command and the timeout. `deadline` (epoch ms) caps the timeout further;
 * `timeoutMs: 0` means no timeout, for long builds.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, deadline?: number | null } & object} [opts]
 */
export function run(cmd, args, opts = {}) {
  const { timeoutMs = CALL_TIMEOUT_MS, deadline = waiterDeadline, ...execOpts } = opts;
  let timeout;
  try {
    timeout = callTimeout(timeoutMs, deadline);
  } catch (err) {
    const message = `${err.message}; not starting \`${cmd} ${args.join(' ')}\``;
    throw Object.assign(err, { message, stderr: message });
  }
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...execOpts,
      ...(timeout ? { timeout, killSignal: 'SIGKILL' } : {}),
    }).trim();
  } catch (err) {
    if (err?.code !== 'ETIMEDOUT') throw err;
    const message = `\`${cmd} ${args.join(' ')}\` timed out after ${timeout / 1000}s`;
    throw Object.assign(new Error(message), { timedOut: true, stderr: message });
  }
}

/** Smallest remaining waiter budget a gh call may start with */
export const MIN_CALL_BUDGET_MS = 2000;

/**
 * Expands a (possibly short) commit SHA to the full one.
 *
 * @param {string} sha
 * @param {typeof run} [exec]
 */
export function resolveSha(sha, exec = run) {
  if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  if (sha.startsWith('-')) throw new Error(`refusing "${sha}": a commit SHA cannot start with "-"`);
  try {
    return exec('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { deadline: null });
  } catch (err) {
    try {
      return retryTransient(() =>
        exec('gh', ['api', `repos/${REPO}/commits/${sha}`, '--jq', '.sha'])
      );
    } catch (ghErr) {
      if (ghErr.budgetExhausted) throw ghErr;
      throw new Error(
        `cannot resolve ${sha} to a commit (git: ${err.message.split('\n')[0]}; gh: ${ghErr.message.split('\n')[0]})`
      );
    }
  }
}

/**
 * The timeout of one call, capped by the waiter deadline.
 *
 * @param {number} timeoutMs
 * @param {number | null} deadline
 * @param {number} [now]
 */
export function callTimeout(timeoutMs, deadline, now = Date.now()) {
  if (!deadline) return timeoutMs;
  const left = deadline - now;
  if (left < MIN_CALL_BUDGET_MS)
    throw Object.assign(
      new Error(`less than ${MIN_CALL_BUDGET_MS / 1000}s of the wait budget left`),
      { timedOut: true, budgetExhausted: true }
    );
  return timeoutMs ? Math.min(timeoutMs, left) : left;
}

/**
 * What a waiter that ran out of time reports.
 *
 * @param {{ subject: string, minutes: number, failures: number, last: string, seen: Record<string, string> }} state
 * @param {boolean} thrown
 */
export function timeoutMessage(state, thrown) {
  const seen = Object.entries(state.seen);
  if (state.failures > 0 && (thrown || seen.length === 0))
    return `gh failed ${state.failures} times: ${state.last}`;
  if (seen.length === 0) return `no CI run found for ${state.subject} after ${state.minutes} min`;
  return `${seen.map(([name, status]) => `${name} still ${status}`).join(', ')} after ${state.minutes} min`;
}

/**
 * What to say when a PR has no pull_request CI run.
 *
 * @param {number} prNumber
 * @param {string} mergeable
 */
export function noRunMessage(prNumber, mergeable) {
  if (mergeable === 'CONFLICTING')
    return `PR #${prNumber} conflicts with its base: GitHub runs no pull_request CI; rebase`;
  return `no pull_request CI run 3 minutes after the push: close and reopen PR #${prNumber} (not a dispatch: CI OK must come from a pull_request run)`;
}

/**
 * One status line of a job or workflow run, with its elapsed minutes.
 *
 * @param {string} name
 * @param {string} status
 * @param {string | null | undefined} startedAt
 * @param {number} [now]
 */
export function statusLine(name, status, startedAt, now = Date.now()) {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started) || new Date(started).getUTCFullYear() < 1970)
    return `${name} ${status}`;
  return `${name} ${status} ${Math.max(0, Math.floor((now - started) / 60_000))} min`;
}

/**
 * The `gh workflow run` inputs of a repeat dispatch, or an error.
 *
 * @param {string[]} files
 * @param {Record<string, string>} keys
 * @returns {{ args: string[] } | { error: string }}
 */
export function repeatDispatch(files, keys) {
  const node = String(keys.node ?? 22);
  if (!['22', '24', '26'].includes(node)) return { error: `--node must be 22, 24 or 26, got ${node}` };
  const braced = files.find((f) => /[{}]/.test(f));
  if (braced)
    return { error: `brace expansion is not supported (${braced}): pass the files space-separated` };
  return {
    args: [
      '-f',
      `smoke_files=${files.join(' ')}`,
      '-f',
      `repeat=${keys.repeat ?? 10}`,
      '-f',
      `node=${node}`,
    ],
  };
}

/**
 * Gate 5 verdict from the latest main CI runs.
 *
 * @param {Array<{ status: string, conclusion: string | null, headSha: string, databaseId?: number }>} runs
 * @param {boolean} fixesMain
 * @returns {{ ok: boolean, text: string }}
 */
export function mainGateVerdict(runs, fixesMain) {
  const decided = runs.find((r) => r.status === 'completed' && r.conclusion !== 'cancelled');
  const pending = runs.find((r) => r.status !== 'completed');
  const note = pending
    ? ` (a run on ${pending.headSha.slice(0, 10)} is in progress: wait for it if that merge touched this PR's files)`
    : '';
  const where = decided ? `${decided.conclusion} on ${decided.headSha.slice(0, 10)}` : 'no completed run';
  const green = decided?.conclusion === 'success';
  if (!fixesMain) return { ok: green, text: `5 main is green: ${where}${note}` };
  if (decided && !green)
    return { ok: true, text: `5 skipped: this PR fixes main, run ${decided.databaseId} (${where})` };
  return { ok: false, text: `5 --fixes-main refused: main is ${green ? 'green' : 'not red'} (${where})` };
}

const TRANSIENT_GH =
  /unexpected EOF|connection reset|ECONNRESET|i\/o timeout|context deadline exceeded|Client\.Timeout|TLS handshake timeout|HTTP 5\d\d/i;
const RETRY_BACKOFF_MS = [2000, 5000, 10_000, 20_000];

/**
 * Whether a failed gh call looks like a network or GitHub hiccup worth retrying.
 * A call killed by its timeout counts too. Only gh's stderr counts: the error
 * message starts with the command line, whose numbers (a PR 502, `--limit 500`)
 * must not look like an HTTP status.
 *
 * @param {{ stderr?: unknown }} err
 */
export function isTransientGhError(err) {
  return err?.timedOut === true || TRANSIENT_GH.test(String(err?.stderr ?? ''));
}

/**
 * Calls fn, retrying a transient failure with a short backoff (one line per
 * retry); a non-transient failure, or the last transient one, is thrown.
 *
 * @param {() => unknown} fn
 * @param {{ backoff?: number[], wait?: (ms: number) => void, deadline?: number | null, now?: () => number }} [opts]
 */
export function retryTransient(fn, opts = {}) {
  const backoff = opts.backoff ?? RETRY_BACKOFF_MS;
  const wait =
    opts.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const deadline = opts.deadline ?? waiterDeadline;
  const now = opts.now ?? Date.now;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = fn();
      if (waiterState) Object.assign(waiterState, { failures: 0, last: '' });
      return result;
    } catch (err) {
      if (err?.budgetExhausted) throw err;
      const firstLine = String(err.stderr || err.message)
        .trim()
        .split('\n')[0];
      if (waiterState)
        Object.assign(waiterState, { failures: waiterState.failures + 1, last: firstLine });
      if (!isTransientGhError(err)) throw err;
      if (deadline && now() >= deadline) throw err;
      if (attempt >= backoff.length && !deadline) throw err;
      const delay = backoff[Math.min(attempt, backoff.length - 1)];
      console.error(
        `gh failed (${firstLine}); retry ${attempt + 1}${deadline ? ' (until the waiter deadline)' : `/${backoff.length}`} in ${delay / 1000}s`
      );
      wait(delay);
    }
  }
}

/**
 * Runs a gh command against the repo and parses its JSON output. Every poll
 * loop reads through here, so a transient API error retries instead of ending the wait.
 *
 * @param {string[]} args
 */
function ghJson(args) {
  const out = retryTransient(() => run('gh', [...args, '--repo', REPO]));
  return out ? JSON.parse(out) : null;
}

/** Environment with the pinned Node first on PATH */
function pinnedEnv(extra = {}) {
  return { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, ...extra };
}

/** Absolute path of the main checkout (the parent of the shared .git directory) */
function mainCheckout() {
  return dirname(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

/**
 * Sleeps for the given time.
 *
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Splits `key=value` arguments from positional ones.
 *
 * @param {string[]} argv
 * @returns {{ positional: string[], keys: Record<string, string>, flags: Set<string> }}
 */
export function parseArgs(argv) {
  const positional = [];
  const keys = {};
  const flags = new Set();
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const i = body.indexOf('=');
      if (i === -1) flags.add(body);
      else keys[body.slice(0, i)] = body.slice(i + 1);
    } else if (/^[A-Za-z_][\w-]*=/.test(arg)) {
      const i = arg.indexOf('=');
      keys[arg.slice(0, i)] = arg.slice(i + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, keys, flags };
}

/**
 * Reads the PR fields every command needs.
 *
 * @param {string|number} pr
 */
function prInfo(pr) {
  return ghJson([
    'pr',
    'view',
    String(pr),
    '--json',
    'number,title,body,headRefName,headRefOid,baseRefName,mergeable,state,isDraft,files,mergeCommit',
  ]);
}

/**
 * Latest run of a workflow for a commit and event, or null.
 *
 * @param {string} sha
 * @param {string} workflow
 * @param {string} event
 */
function latestRun(sha, workflow, event) {
  const runs = ghJson([
    'run',
    'list',
    '--commit',
    sha,
    '--workflow',
    workflow,
    '--event',
    event,
    '--json',
    'databaseId,status,conclusion,startedAt',
    '--limit',
    '1',
  ]);
  return runs?.[0] ?? null;
}

/**
 * Decides what a finished wait reports, from the conclusions per workflow. A
 * failure always fails; a cancelled run on main means a later push replaced it
 * (CI cancels superseded runs), while on a PR whose head didn't move it is a
 * failure like any other.
 *
 * @param {Record<string, string>} conclusions workflow → conclusion
 * @param {{ push?: boolean }} [mode]
 * @returns {{ code: number, summary: string }}
 */
export function judgeConclusions(conclusions, mode = {}) {
  const entries = Object.entries(conclusions);
  const summary = entries.map(([wf, c]) => `${wf} ${c}`).join(', ');
  if (entries.every(([, c]) => c === 'success')) return { code: EXIT.ok, summary };
  const failed = entries.some(([, c]) => c !== 'success' && c !== 'cancelled');
  if (!failed && mode.push) {
    return {
      code: EXIT.superseded,
      summary: `${summary} (cancelled: superseded by a newer run; wait for that one)`,
    };
  }
  return { code: EXIT.failed, summary };
}

/**
 * Waits until CI (and Security, for PRs into main and pushes to main) finished
 * for a PR head or a main commit. A PR whose head moves while waiting reports
 * `superseded`, so an old waiter never answers for a new push.
 *
 * @param {string[]} argv `<pr>` or `<sha> --push`, optional `--timeout=<minutes>`
 */
async function ciWait(argv) {
  const { keys } = parseArgs(argv);
  return withWaiterDeadline(keys.timeout ?? 45, () => ciWaitLoop(argv));
}

/**
 * Runs a waiter with an overall deadline that caps every gh call and its
 * retries. Any error caught at or past the deadline (a killed call, a 502
 * rethrown after the last retry), or a call refused for lack of budget, ends
 * the wait as `timeout`, exit 4, naming the gh failures when there were any. A
 * timeout that is not a positive number is a usage error, exit 2.
 *
 * @param {number | string} minutes
 * @param {() => Promise<number>} wait
 */
export async function withWaiterDeadline(minutes, wait) {
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0)
    return usage('--timeout=<minutes> must be a positive number');
  const deadline = Date.now() + Number(minutes) * 60_000;
  waiterDeadline = deadline;
  waiterState = { subject: '', minutes: Number(minutes), failures: 0, last: '', seen: {} };
  try {
    return await wait();
  } catch (err) {
    if (!err.budgetExhausted && Date.now() < deadline) throw err;
    const reason =
      err.budgetExhausted || waiterState.failures > 0
        ? timeoutMessage(waiterState, true)
        : err.stderr || err.message;
    console.log(`timeout: ${reason}`);
    return EXIT.timeout;
  } finally {
    waiterDeadline = null;
    waiterState = null;
  }
}

/**
 * Runs a gh write that may succeed server-side before it is killed: after a
 * timeout it re-reads the state and carries on if the effect happened.
 *
 * @param {() => unknown} write
 * @param {() => boolean} happened
 * @param {string} what
 */
export function writeWithRecheck(write, happened, what) {
  try {
    return write();
  } catch (err) {
    if (err?.timedOut !== true) throw err;
    if (happened()) return null;
    throw Object.assign(new Error(`${err.message}; ${what} state unknown, check gh pr view`), {
      timedOut: true,
    });
  }
}

/**
 * Polls until the workflows finished; `ciWait` wraps it with the deadline.
 *
 * @param {string[]} argv as for `ciWait`
 */
/**
 * The latest push run's commit on main when it contains `sha`, with the
 * commits that came after it (author and subject): when other merges
 * (dependabot, another thread) cancel a push run, the waiter follows the
 * run that now decides `main` (S15). Null when nothing newer contains it.
 *
 * @param {string} sha
 */
function supersedingPush(sha) {
  const latest = (ghJson(['run', 'list', '--branch', 'main', '--event', 'push', '--workflow', 'CI', '--json', 'headSha', '--limit', '1']) ?? [])[0];
  if (!latest || latest.headSha === sha) return null;
  freshOriginRef('main');
  if (spawnSync('git', ['merge-base', '--is-ancestor', sha, latest.headSha]).status !== 0) return null;
  const commits = run('git', ['log', '--first-parent', '--format=%h %an: %s', `${sha}..${latest.headSha}`])
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return { sha: latest.headSha, commits };
}

/**
 * Waits up to 3 minutes for GitHub to show a pushed commit as the PR head:
 * a waiter started right after a push otherwise sees the old head, then the
 * new one, and exits superseded (S19 #828: both waiters did).
 *
 * @param {number} prNumber
 * @param {string} want full or short SHA of the pushed commit
 * @returns {Promise<string | null>} the full head SHA, or null on timeout
 */
async function waitForHead(prNumber, want) {
  for (let i = 0; i < 36; i++) {
    const head = prInfo(prNumber).headRefOid;
    if (head.startsWith(want)) return head;
    if (i === 0) console.log(`waiting for PR #${prNumber} to show head ${want.slice(0, 10)} (now ${head.slice(0, 10)})`);
    await sleep(5000);
  }
  console.log(`timeout: PR #${prNumber} never showed head ${want.slice(0, 10)} within 3 minutes; check the push`);
  return null;
}

async function ciWaitLoop(argv) {
  const { positional, flags, keys } = parseArgs(argv);
  const target = positional[0];
  if (!target) return usage('ci-wait <pr> [--head=<sha>] | ci-wait <sha> --push');
  const deadline = waiterDeadline;
  const push = flags.has('push');
  let pr = null;
  waiterState.subject = target.slice(0, 10);
  let sha = push ? resolveSha(target) : target;
  let workflows = ['CI', 'Security'];
  if (!push) {
    pr = prInfo(target);
    for (const line of orphanWorktreeProcesses(prScope(pr)))
      console.log(`WARN ${line} (the implementer started it without a PID file, or killed its parent: gate 8 refuses the merge until it's gone)`);
    if (flags.has('head') || keys.head === '') return usage('ci-wait <pr> --head=<sha>: give the SHA after =');
    sha = keys.head ? await waitForHead(pr.number, keys.head) : pr.headRefOid;
    if (!sha) return EXIT.timeout;
    if (pr.baseRefName !== 'main') workflows = ['CI'];
  }
  const event = push ? 'push' : 'pull_request';
  waiterState.subject = sha.slice(0, 10);
  const noRunDeadline = Date.now() + 3 * 60_000;
  console.log(
    `waiting for ${workflows.join(' + ')} (${event}) on ${sha.slice(0, 10)}${pr ? ` (PR #${pr.number})` : ''}`
  );
  for (;;) {
    if (pr) {
      const head = prInfo(pr.number).headRefOid;
      if (head !== sha) {
        console.log(
          `superseded: PR #${pr.number} head moved to ${head.slice(0, 10)}; wait for that one`
        );
        return EXIT.superseded;
      }
    }
    const runs = Object.fromEntries(workflows.map((wf) => [wf, latestRun(sha, wf, event)]));
    waiterState.seen = Object.fromEntries(
      workflows.filter((wf) => runs[wf]).map((wf) => [wf, runs[wf].status])
    );
    if (workflows.every((wf) => runs[wf]?.status === 'completed')) {
      const { code, summary } = judgeConclusions(
        Object.fromEntries(workflows.map((wf) => [wf, runs[wf].conclusion])),
        { push }
      );
      const next = code === EXIT.superseded && push ? supersedingPush(sha) : null;
      if (next) {
        console.log(`${summary}\nsuperseded by ${next.sha.slice(0, 10)}; commits after yours:\n${next.commits}\nwaiting for that run instead`);
        sha = next.sha;
        waiterState.subject = sha.slice(0, 10);
        continue;
      }
      if (code !== EXIT.ok && pr && prInfo(pr.number).headRefOid !== sha) {
        console.log(`${summary}; superseded: PR #${pr.number} head moved while waiting`);
        return EXIT.superseded;
      }
      console.log(summary);
      return code;
    }
    if (pr && !runs.CI && Date.now() > noRunDeadline) {
      console.log(noRunMessage(pr.number, prInfo(pr.number).mergeable));
      return EXIT.timeout;
    }
    if (Date.now() > deadline) {
      console.log(`timeout: ${timeoutMessage(waiterState, false)}`);
      return EXIT.timeout;
    }
    for (const wf of workflows)
      console.log(statusLine(wf, runs[wf]?.status ?? 'not started', runs[wf]?.startedAt));
    await sleep(POLL_MS);
  }
}

/**
 * Waits for one workflow run (a repeat dispatch) and prints its jobs.
 *
 * @param {string[]} argv `<run id>`, optional `--timeout=<minutes>` (default 60)
 */
async function runWait(argv) {
  const { positional, keys } = parseArgs(argv);
  if (!positional[0]) return usage('run-wait <run id> [--timeout=<minutes>]');
  return withWaiterDeadline(keys.timeout ?? 60, () => runWaitLoop(positional[0]));
}

/**
 * Polls one run until it completed, or the waiter deadline passes.
 *
 * @param {string} id
 */
async function runWaitLoop(id) {
  const deadline = waiterDeadline;
  waiterState.subject = `run ${id}`;
  for (;;) {
    const r = ghJson(['run', 'view', id, '--json', 'status,conclusion,headSha,jobs']);
    waiterState.seen = { [`run ${id}`]: r.status };
    if (r.status === 'completed') {
      for (const j of r.jobs) console.log(`${j.conclusion.padEnd(9)} ${j.name}`);
      console.log(`run ${id} on ${r.headSha.slice(0, 10)}: ${r.conclusion}`);
      printLostJobs(id, r.jobs);
      return r.conclusion === 'success' ? EXIT.ok : EXIT.failed;
    }
    if (Date.now() > deadline) {
      console.log(`timeout: ${timeoutMessage(waiterState, false)}`);
      return EXIT.timeout;
    }
    for (const j of r.jobs.filter((job) => job.status !== 'completed'))
      console.log(statusLine(j.name, j.status, j.startedAt));
    await sleep(POLL_MS);
  }
}

/**
 * Dispatches the CI repeat run for smoke files on a PR's branch and prints its id.
 *
 * @param {string[]} argv `<pr> <smoke files...>`, optional `--repeat=10 --node=22|24|26` (files space-separated; no brace expansion)
 */
async function repeat(argv) {
  const { keys } = parseArgs(argv);
  return withWaiterDeadline(keys.timeout ?? 10, () => repeatLoop(argv));
}

/**
 * The body of `ship repeat`, inside a total deadline (default 10 minutes),
 * with a status line before each step: in S22 a dispatch hung 30 minutes
 * with no output, and nothing said which step it was on.
 *
 * @param {string[]} argv
 */
async function repeatLoop(argv) {
  const { positional, keys, flags } = parseArgs(argv);
  const [prNumber, ...files] = positional;
  if (!prNumber || files.length === 0)
    return usage('repeat <pr> <smoke files...> [--repeat=10] [--node=22|24|26] [--replace] [--timeout=<minutes>]');
  const dispatch = repeatDispatch(files, keys);
  if (dispatch.error) return usage(dispatch.error);
  const status = (text) => {
    console.log(`· ${text}`);
    if (waiterState) waiterState.subject = `repeat (${text})`;
  };
  status(`reading PR #${prNumber}`);
  const pr = prInfo(prNumber);
  const dispatchRuns = () =>
    ghJson([
      'run',
      'list',
      '--workflow',
      'ci.yml',
      '--branch',
      pr.headRefName,
      '--event',
      'workflow_dispatch',
      '--json',
      'databaseId,headSha,status',
      '--limit',
      '20',
    ]) ?? [];
  status(`listing repeat runs on ${pr.headRefName}`);
  let running = unfinishedRepeat(dispatchRuns());
  if (running && flags.has('replace')) {
    const cancel = () => {
      try {
        run('gh', ['run', 'cancel', String(running.databaseId), '--repo', REPO], { timeoutMs: WRITE_TIMEOUT_MS });
        return true;
      } catch (error) {
        console.log(`could not cancel run ${running.databaseId} yet (${running.status}): ${error.message.split('\n')[0]}`);
        return false;
      }
    };
    console.log(`cancelling repeat run ${running.databaseId} (--replace)`);
    let cancelled = cancel();
    for (let i = 0; i < 36 && running; i++) {
      await sleep(5000);
      running = unfinishedRepeat(dispatchRuns());
      if (running && !cancelled && i % 6 === 5) cancelled = cancel();
    }
  }
  if (running) {
    console.log(
      `repeat run ${running.databaseId} is still ${running.status} on ${pr.headRefName}: a second dispatch would queue behind it or cancel a queued one; wait with ship run-wait ${running.databaseId}, then dispatch`
    );
    return EXIT.failed;
  }
  const before = new Set(dispatchRuns().map((r) => r.databaseId));
  status(`dispatching ci.yml on ${pr.headRefName} (${dispatch.args.filter((a) => a.startsWith('node=') || a.startsWith('repeat=')).join(', ')})`);
  try {
    run(
      'gh',
      ['workflow', 'run', 'ci.yml', '--repo', REPO, '--ref', pr.headRefName, ...dispatch.args],
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
  } catch (error) {
    if (!error.timedOut && !error.budgetExhausted) throw error;
    console.log(
      `dispatch state unknown: gh workflow run did not answer in time; check gh run list --workflow ci.yml --branch ${pr.headRefName} --event workflow_dispatch before dispatching again`
    );
    return EXIT.timeout;
  }
  status('waiting for the run to show up (up to 50 s)');
  for (let i = 0; i < 10; i++) {
    await sleep(5000);
    const hit = dispatchRuns().find(
      (r) => r.headSha === pr.headRefOid && !before.has(r.databaseId)
    );
    if (hit) {
      console.log(
        `repeat run ${hit.databaseId} on ${pr.headRefOid.slice(0, 10)}; wait with: ship run-wait ${hit.databaseId}`
      );
      return EXIT.ok;
    }
  }
  console.log(
    'dispatched, but the run did not show up within 50 s; look with gh run list --event workflow_dispatch'
  );
  return EXIT.failed;
}

/**
 * The first repeat run on the branch that hasn't finished: a second dispatch
 * in the same concurrency group would queue behind it or cancel a queued one.
 *
 * @param {{ databaseId: number, status: string }[]} runs workflow_dispatch runs of the branch
 */
export function unfinishedRepeat(runs) {
  return runs.find((r) => r.status !== 'completed') ?? null;
}

/**
 * Failed jobs with no failed step: the runner was lost or shut down, or the
 * job hit its timeout, before a step could fail; the job log tells which.
 *
 * @param {{ name: string, conclusion: string, steps?: { conclusion: string }[] }[]} jobs
 */
export function jobsLostWithoutResult(jobs) {
  return jobs
    .filter((j) => j.conclusion === 'failure' && j.name !== 'CI OK')
    .filter((j) => !(j.steps ?? []).some((s) => s.conclusion === 'failure'))
    .map((j) => j.name);
}

/**
 * Prints the re-run hint for jobs that failed without a failed step.
 *
 * @param {string|number} runId
 * @param {object[]} jobs
 */
function printLostJobs(runId, jobs) {
  const lost = jobsLostWithoutResult(jobs);
  if (lost.length)
    console.log(
      `note: ${lost.join(', ')} failed without a failed step (runner lost or shut down, or a timeout): read the job log; a lost runner gets gh run rerun ${runId} --failed`
    );
}

/**
 * Packages whose installed version (node_modules/.package-lock.json)
 * differs from package-lock.json, or that are missing; optional packages
 * not installed (other platforms) are skipped. Only versions are compared:
 * a local `npm install` rewrites the lockfile's libc fields.
 *
 * @param {{ packages?: Record<string, { version?: string, optional?: boolean }> }} lock
 * @param {{ packages?: Record<string, { version?: string }> }} installed
 */
export function staleDependencies(lock, installed) {
  const have = installed.packages ?? {};
  return Object.entries(lock.packages ?? {})
    .filter(([path]) => path.startsWith('node_modules/'))
    .filter(([path, entry]) =>
      have[path] ? have[path].version !== entry.version : !entry.optional && !entry.devOptional
    )
    .map(([path, entry]) => `${path.slice('node_modules/'.length)} ${have[path]?.version ?? 'missing'} → ${entry.version}`);
}

/**
 * Warns when the main checkout's node_modules don't match package-lock.json
 * (S16: after three dependabot merges an implementer wrote a dead type
 * extension against stale types). Every worktree links these node_modules.
 *
 * @returns {boolean} true when they match
 */
function checkDependencies() {
  const main = mainCheckout();
  const read = (file) => JSON.parse(readFileSync(join(main, file), 'utf8'));
  if (!existsSync(join(main, 'node_modules', '.package-lock.json'))) {
    console.log('WARN no node_modules in the main checkout: run npm ci there');
    return false;
  }
  let stale;
  try {
    stale = staleDependencies(read('package-lock.json'), read('node_modules/.package-lock.json'));
  } catch (error) {
    console.log(`WARN could not compare node_modules with package-lock.json: ${error.message}`);
    return false;
  }
  if (!stale.length) return true;
  console.log(
    `WARN node_modules in the main checkout don't match package-lock.json (${stale.length}: ${stale.slice(0, 4).join(', ')}${stale.length > 4 ? ', …' : ''}): run npm ci there, not npm install (it rewrites the lockfile's libc fields)`
  );
  return false;
}

/**
 * Fetches a branch of origin and returns its ref, failing with a plain
 * message when the ref is still missing (S15: `origin/main` vanished once
 * from the main checkout mid-session).
 *
 * @param {string} branch
 * @returns {string} `origin/<branch>`
 */
function freshOriginRef(branch) {
  run('git', ['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const ok = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).status === 0;
  if (!ok) throw new Error(`origin/${branch} is missing even after git fetch origin ${branch}`);
  return `origin/${branch}`;
}

/**
 * True when a `ship simplify --finish` marker still covers the PR head: its
 * recorded commit is an ancestor of the head, and the product lines added
 * since are at most its own uncommitted edits plus 50 (the refactor: commit
 * of those edits, small fix-ups). A later large fix round needs a new pass.
 *
 * @param {string} marker
 * @param {string} head
 */
function simplifyStillCovers(marker, head) {
  if (!existsSync(marker)) return false;
  const [at, edits] = readFileSync(marker, 'utf8').trim().split(' ');
  if (!at || spawnSync('git', ['merge-base', '--is-ancestor', at, head]).status !== 0) return false;
  return productLines(run('git', ['diff', '--numstat', at, head])) <= (Number(edits) || 0) + 50;
}

/** Written by a passing `ship simplify <pr> --finish`; gate 1 reads it */
function simplifyMarker(prNumber) {
  return `/tmp/ship-simplify-${prNumber}.done`;
}

/**
 * True for a file `npm run format:check` covers (TypeScript under src/,
 * JavaScript and JSON files at the repo root); other files keep their own formatting.
 *
 * @param {string} file repo-relative path
 */
export function isFormatChecked(file) {
  return /^src\/.*\.ts$/.test(file) || /^[^/]+\.(js|json)$/.test(file);
}

/**
 * After the orchestrator's /simplify edits: formats the edited files with
 * Prettier and type-checks the worktree, so the implementer gets edits that
 * pass `npm run check` (S19: a red CI in #825 and an extra style: commit in #824).
 *
 * @param {string} path the PR's worktree
 */
function finishSimplify(path) {
  const edited = [
    ...run('git', ['-C', path, 'diff', '--name-only', 'HEAD']).split('\n'),
    ...run('git', ['-C', path, 'ls-files', '--others', '--exclude-standard']).split('\n'),
  ]
    .filter((f) => isFormatChecked(f) && existsSync(join(path, f)));
  const results = [];
  if (edited.length) results.push(step(`prettier --write (${edited.length} files)`, `npx prettier --write ${edited.map((f) => `'${f}'`).join(' ')}`, path));
  else console.log('ok   no edited code files to format');
  results.push(step('npm run type-check', 'npm run type-check', path));
  const tests = unitTestsFor(edited, run('git', ['-C', path, 'ls-files', 'src']).split('\n'));
  if (tests.length) results.push(step(`unit tests of the edited files (${tests.length})`, `npx tsx --test ${tests.map((f) => `'${f}'`).join(' ')}`, path));
  else console.log('ok   no unit tests found next to the edited files');
  return results.every(Boolean) ? EXIT.ok : EXIT.failed;
}

/**
 * Unit test files for edited source files: `__tests__/<name>.test.ts` or
 * `<name>.unit.test.ts` in the file's directory or one above (smoke tests
 * excluded: they need a build and Chrome). S20: --finish only knew type-check passed.
 *
 * @param {string[]} edited repo-relative paths
 * @param {string[]} tracked repo-relative paths under src/
 */
export function unitTestsFor(edited, tracked) {
  const tests = tracked.filter((f) => /__tests__\/.*\.test\.ts$/.test(f) && !/\.smoke\.test\.ts$/.test(f));
  const found = edited
    .filter((f) => /^src\/.*\.ts$/.test(f) && !/__tests__/.test(f))
    .flatMap((f) => {
      const dir = dirname(f);
      const name = f.slice(dir.length + 1).replace(/\.ts$/, '');
      return tests.filter((t) => {
        const base = t.slice(t.lastIndexOf('/') + 1);
        return (t.startsWith(`${dir}/__tests__/`) || t.startsWith(`${dirname(dir)}/__tests__/`)) &&
          (base === `${name}.test.ts` || base === `${name}.unit.test.ts`);
      });
    });
  const direct = edited.filter((f) => tests.includes(f));
  return [...new Set([...found, ...direct])];
}

/**
 * Prepares the orchestrator's /simplify pass on a PR: the PR's worktree, its
 * base, and the diff in a file, plus the args to pass, since /simplify works
 * on the current directory (S18: agents started by hand for each worktree).
 *
 * @param {string[]} argv `<pr>`
 */
function simplify(argv) {
  const { positional, flags } = parseArgs(argv);
  const prNumber = positional[0];
  if (!prNumber) return usage('simplify <pr> [--finish]');
  const pr = prInfo(prNumber);
  const path = worktreeOfBranch(run('git', ['worktree', 'list', '--porcelain']), pr.headRefName);
  if (!path) {
    console.log(`FAIL no worktree has branch ${pr.headRefName}: run /simplify where the PR's code is checked out`);
    return EXIT.failed;
  }
  if (flags.has('finish')) {
    const code = finishSimplify(path);
    if (code === EXIT.ok) {
      const head = run('git', ['-C', path, 'rev-parse', 'HEAD']);
      const edits = productLines(run('git', ['-C', path, 'diff', '--numstat', 'HEAD']));
      writeFileSync(simplifyMarker(pr.number), `${head} ${edits}\n`);
    }
    return code;
  }
  run('git', ['fetch', '-q', 'origin', `pull/${pr.number}/head`]);
  const base = run('git', ['merge-base', freshOriginRef(pr.baseRefName), pr.headRefOid]);
  const file = `/tmp/simplify-${pr.number}.diff`;
  run('git', ['-C', path, 'diff', `--output=${file}`, base, pr.headRefOid]);
  const lines = productLines(run('git', ['-C', path, 'diff', '--numstat', base, pr.headRefOid]));
  console.log(
    [
      `worktree: ${path}`,
      `base:     ${base}`,
      `diff:     ${file} (${lines} product lines)`,
      `args for /simplify: "Review only the changes in ${file}; the code is in ${path}.${lines < 500 ? ' Use one agent, on reuse and simplification only.' : ''} Apply your fixes in ${path} and leave them uncommitted."`,
      `then: ship simplify ${pr.number} --finish (Prettier and type-check on the edits), and SendMessage the implementer to run the affected tests and commit them as refactor:`,
    ].join('\n')
  );
  return EXIT.ok;
}

/**
 * Top-level suite times from a node --test spec log: lines `✔ name (12.3ms)`
 * or `✖ …` with no indentation after the GitHub log prefix.
 *
 * @param {string} log
 * @returns {Map<string, number>} suite → milliseconds
 */
export function suiteTimes(log) {
  const times = new Map();
  for (const line of log.split('\n')) {
    const text = line.replace(/^[^\t]*\t[^\t]*\t\d{4}-\d\d-\d\dT[\d:.]+Z /, '');
    const m = /^[✔✖] (.+) \((\d+(?:\.\d+)?)ms\)$/.exec(text);
    if (m) times.set(m[1], (times.get(m[1]) ?? 0) + Number(m[2]));
  }
  return times;
}

/**
 * Prints the slowest smoke suites of a CI run, or of two runs side by side
 * (S20: extracted by hand three times for #809's before/after).
 *
 * @param {string[]} argv `<run id> [<other run id>] [--job=<regex>] [--top=15]`
 */
function suiteTimesCommand(argv) {
  const { positional, keys } = parseArgs(argv);
  if (!positional[0]) return usage('suite-times <run id> [<other run id>] [--job=<regex>] [--top=15]');
  let jobFilter;
  try {
    jobFilter = new RegExp(keys.job ?? 'Smoke');
  } catch (error) {
    return usage(`suite-times: --job is not a valid regex: ${error.message}`);
  }
  const top = Number(keys.top ?? 15) || 15;
  const timesOf = (runId) => {
    const jobs = ghJson(['run', 'view', runId, '--json', 'jobs']).jobs.filter((j) => jobFilter.test(j.name));
    const all = new Map();
    for (const job of jobs) {
      const log = spawnSync('gh', ['run', 'view', '--job', String(job.databaseId), '--log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: WRITE_TIMEOUT_MS }).stdout ?? '';
      const platform = /macOS/.test(job.name) ? 'macOS' : 'Linux';
      for (const [suite, ms] of suiteTimes(log)) all.set(`${suite} [${platform}]`, (all.get(`${suite} [${platform}]`) ?? 0) + ms);
    }
    return all;
  };
  const first = timesOf(positional[0]);
  const second = positional[1] ? timesOf(positional[1]) : null;
  const rows = [...first].sort((a, b) => b[1] - a[1]).slice(0, top);
  for (const [suite, ms] of rows) {
    const other = second?.get(suite);
    console.log(`${(ms / 1000).toFixed(1).padStart(7)} s${second ? ` → ${other === undefined ? '   -' : (other / 1000).toFixed(1).padStart(6)} s` : ''}  ${suite}`);
  }
  return EXIT.ok;
}

/**
 * Creates an agent worktree on a new branch from origin/main with node_modules linked.
 *
 * @param {string[]} argv `<name> <branch>`, optional `base=<ref>`
 */
function worktree(argv) {
  const { positional, keys } = parseArgs(argv);
  const [name, branch] = positional;
  if (!name || !branch) return usage('worktree <issue number or name> <branch> [base=origin/main]');
  const main = mainCheckout();
  const path = resolve(main, '..', `bdg-${name}`);
  const base = keys.base ?? freshOriginRef('main');
  checkDependencies();
  run('git', ['worktree', 'add', '-q', path, '-b', branch, base]);
  symlinkSync(join(main, 'node_modules'), join(path, 'node_modules'));
  console.log(path);
  return EXIT.ok;
}

/**
 * Builds a detached worktree at a commit, runs steps in it with the pinned
 * Node, and always removes it.
 *
 * @param {string} commit
 * @param {string} path
 * @param {(cwd: string) => boolean} steps returns true when everything passed
 */
function inTempWorktree(commit, path, steps) {
  const main = mainCheckout();
  if (existsSync(path)) run('git', ['worktree', 'remove', '--force', path]);
  run('git', ['worktree', 'add', '-q', '--detach', path, commit]);
  try {
    symlinkSync(join(main, 'node_modules'), join(path, 'node_modules'));
    return steps(path);
  } finally {
    run('git', ['worktree', 'remove', '--force', path]);
  }
}

/**
 * Runs a shell step with the pinned Node and prints only its last lines.
 *
 * @param {string} label
 * @param {string} command
 * @param {string} cwd
 * @param {object} [env]
 */
function step(label, command, cwd, env = {}) {
  const r = spawnSync('sh', ['-c', command], {
    cwd,
    env: pinnedEnv(env),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const all = `${r.stdout}\n${r.stderr}`
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((l) => l.trim());
  const matched = all.filter((l) => /^# (pass|fail)|^not ok|problems|error TS|Error:/.test(l));
  const lines = matched.length || r.status === 0 ? matched : all.slice(-5);
  console.log(
    `${r.status === 0 ? 'ok  ' : 'FAIL'} ${label}${lines.length ? `\n     ${lines.slice(-6).join('\n     ')}` : ''}`
  );
  return r.status === 0;
}

/**
 * Gate 6: merges the PR into its current base branch without touching any branch,
 * then typechecks, builds and runs the given test files on the result. A pass
 * is recorded so `gates` can see it was done against this main and this head.
 *
 * @param {string[]} argv `<pr> [test files...]`
 */
function mergeCheck(argv) {
  const [prNumber, ...files] = argv;
  if (!prNumber) return usage('merge-check <pr> [unit or smoke test files...]');
  const pr = prInfo(prNumber);
  run('git', ['fetch', '-q', 'origin', `pull/${pr.number}/head`]);
  const main = run('git', ['rev-parse', freshOriginRef(pr.baseRefName)]);
  const merged = spawnSync('git', ['merge-tree', '--write-tree', main, pr.headRefOid], {
    encoding: 'utf8',
  });
  if (merged.status !== 0) {
    console.log(
      `FAIL conflict merging PR #${pr.number} into main ${main.slice(0, 10)}:\n${merged.stdout.split('\n').slice(1, 12).join('\n')}`
    );
    return EXIT.failed;
  }
  const tree = merged.stdout.split('\n')[0];
  const commit = run('git', [
    'commit-tree',
    tree,
    '-p',
    main,
    '-p',
    pr.headRefOid,
    '-m',
    'merge-check',
  ]);
  console.log(
    `merge-check of PR #${pr.number} (${pr.headRefOid.slice(0, 10)}) on main ${main.slice(0, 10)}`
  );
  const env = {
    BDG_TEST_SESSION_PARENT: `/tmp/bt-mc${pr.number}`,
    BDG_TEST_HOME_DIR: `/tmp/bt-mc${pr.number}-h`,
  };
  const smoke = files.filter((f) => f.includes('.smoke.'));
  const unit = files.filter((f) => !f.includes('.smoke.'));
  const passed = inTempWorktree(commit, `/tmp/mc-${pr.number}`, (cwd) => {
    const results = [
      step('npm run check', 'npm run check', cwd),
      step('npm run build', 'npm run build', cwd),
    ];
    if (unit.length) results.push(step('unit', `npx tsx --test ${unit.join(' ')}`, cwd, env));
    if (smoke.length)
      results.push(
        step('smoke', `npx tsx --test --test-concurrency=1 ${smoke.join(' ')}`, cwd, env)
      );
    return results.every(Boolean);
  });
  if (passed) writeFileSync(`/tmp/ship-mc-${pr.number}.ok`, `${main} ${pr.headRefOid}\n`);
  return passed ? EXIT.ok : EXIT.failed;
}

/**
 * Files changed on main since the PR's merge base that the PR also changes.
 *
 * @param {string[]} mainFiles
 * @param {string[]} prFiles
 */
export function overlappingFiles(mainFiles, prFiles) {
  const pr = new Set(prFiles);
  return [...new Set(mainFiles)].filter((f) => pr.has(f));
}

/**
 * Reads the mergeable state, re-asking while GitHub still computes it.
 *
 * @param {number} prNumber
 */
async function mergeableState(prNumber) {
  for (let i = 0; i < 6; i++) {
    const state = prInfo(prNumber).mergeable;
    if (state !== 'UNKNOWN') return state;
    await sleep(10_000);
  }
  return 'UNKNOWN';
}

/**
 * Prints one gate line and records its result.
 *
 * @param {boolean[]} results
 * @param {boolean} ok
 * @param {string} label
 */
function gateLine(results, ok, label) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

/**
 * Gate 5: CI, CI OK, optional macOS and Security on the PR head.
 *
 * @param {boolean[]} results
 * @param {object} pr
 * @param {boolean} macos
 */
function ciGates(results, pr, macos) {
  const head = pr.headRefOid;
  const ci = latestRun(head, 'CI', 'pull_request');
  gateLine(
    results,
    ci?.status === 'completed' && ci.conclusion === 'success',
    `5 CI (pull_request) on head: ${ci ? `${ci.status} ${ci.conclusion ?? ''}` : 'no run'}`
  );
  if (ci?.status === 'completed') {
    const jobs = ghJson(['run', 'view', String(ci.databaseId), '--json', 'jobs']).jobs;
    const job = (re) => jobs.find((j) => re.test(j.name));
    printLostJobs(ci.databaseId, jobs);
    gateLine(
      results,
      job(/^CI OK$/)?.conclusion === 'success',
      `5 required check CI OK: ${job(/^CI OK$/)?.conclusion ?? 'missing'}`
    );
    if (macos) {
      const shards = jobs.filter((j) => /macOS/.test(j.name)).map((j) => j.conclusion);
      gateLine(
        results,
        shards.length > 0 && shards.every((c) => c === 'success'),
        `5 macOS smoke: ${shards.join(', ') || 'missing'}`
      );
    }
  }
  if (pr.baseRefName === 'main') {
    const sec = latestRun(head, 'Security', 'pull_request');
    gateLine(
      results,
      sec?.conclusion === 'success',
      `5 Security on head: ${sec ? `${sec.status} ${sec.conclusion ?? ''}` : 'no run'}`
    );
  }
}

/**
 * The latest decided CI run on main (cancelled runs skipped): main must be
 * green before anything merges.
 *
 * @param {boolean[]} results
 * @param {boolean} fixesMain skip the green check for the PR that fixes a red main
 */
function mainGate(results, fixesMain) {
  const runs =
    ghJson([
      'run',
      'list',
      '--branch',
      'main',
      '--workflow',
      'CI',
      '--event',
      'push',
      '--json',
      'status,conclusion,headSha,databaseId',
      '--limit',
      '10',
    ]) ?? [];
  const { ok, text } = mainGateVerdict(runs, fixesMain);
  gateLine(results, ok, text);
}

/**
 * A merge-check result still holds when it was run on this head and the
 * base has since moved only by commits that leave the PR's files alone
 * (S16 #804: two re-runs, ~10 min, for unrelated commits on main).
 *
 * @param {{ checkedHead?: string, laterFiles: string[] | null }} check head of the recorded run; files the base changed since (null: the recorded base is not an ancestor)
 * @param {string} head the PR head now
 * @param {string[]} prFiles
 */
export function mergeCheckStillValid(check, head, prFiles) {
  if (!check.checkedHead || check.checkedHead !== head || check.laterFiles === null) return false;
  return overlappingFiles(check.laterFiles, prFiles).length === 0;
}

/**
 * Gate 6: mergeable, and tested against the base branch when the base
 * changed the PR's files since the PR branched off.
 *
 * @param {boolean[]} results
 * @param {object} pr
 * @param {string} baseRef
 * @param {string} forkPoint
 * @param {string[]} prFiles
 */
async function freshBaseGate(results, pr, baseRef, forkPoint, prFiles) {
  const mergeable = await mergeableState(pr.number);
  gateLine(results, mergeable === 'MERGEABLE', `6 mergeable: ${mergeable}`);
  const baseFiles = run('git', ['diff', '--name-only', forkPoint, baseRef])
    .split('\n')
    .filter(Boolean);
  const overlap = overlappingFiles(baseFiles, prFiles);
  if (overlap.length === 0) {
    gateLine(results, true, `6 ${baseRef} has not changed the PR's files since it branched off`);
    return;
  }
  const marker = `/tmp/ship-mc-${pr.number}.ok`;
  const [checkedBase, checkedHead] = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split(' ') : [];
  const laterFiles =
    checkedBase && spawnSync('git', ['merge-base', '--is-ancestor', checkedBase, baseRef]).status === 0
      ? run('git', ['diff', '--name-only', checkedBase, baseRef]).split('\n').filter(Boolean)
      : null;
  const done = mergeCheckStillValid({ checkedHead, laterFiles }, pr.headRefOid, prFiles);
  const files = `${overlap.slice(0, 4).join(', ')}${overlap.length > 4 ? ', …' : ''}`;
  gateLine(
    results,
    done,
    `6 ${baseRef} changed ${overlap.length} of the PR's files (${files}): ${done ? `merge-check passed on this head at ${checkedBase.slice(0, 10)}; ${baseRef} since then leaves the PR's files alone` : 'run ship merge-check, or have the implementer rebase'}`
  );
}

/** Product diff size above which the orchestrator runs /simplify on the PR */
export const SIMPLIFY_THRESHOLD = 200;

/**
 * True for a file whose lines count as product code: under `src/`, not a
 * test, a smoke test or a test utility.
 *
 * @param {string} path
 */
export function isProductFile(path) {
  return (
    path.startsWith('src/') &&
    !/(^|\/)(__tests__|__testutils__)\//.test(path) &&
    !/\.test\.[cm]?[jt]s$/.test(path)
  );
}

/**
 * Added plus deleted product lines in `git diff --numstat` output (binary files count 0).
 *
 * @param {string} numstat
 */
export function productLines(numstat) {
  return numstat
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, deleted, path] = line.split('\t');
      return isProductFile(path) ? sum + (Number(added) || 0) + (Number(deleted) || 0) : sum;
    }, 0);
}

/** What a release PR may change (S12 #770, S19 #830): --release refuses anything else */
const RELEASE_FILES = ['CHANGELOG.md', 'package.json', 'package-lock.json'];

/**
 * A release PR's version check: package.json's version at the head, and the
 * PR title naming the same `vX.Y.Z` (S19: #830 went through bare gh because
 * gate 7 refused its CHANGELOG change, and skipped every other gate).
 *
 * @param {string} packageJson package.json at the PR head
 * @param {string} title PR title
 */
export function releaseVersion(packageJson, title) {
  let version;
  try {
    version = JSON.parse(packageJson).version;
  } catch {
    return { ok: false, text: 'no readable package.json at the head' };
  }
  const named = /v(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(title ?? '')?.[1];
  if (!named) return { ok: false, text: `the title names no vX.Y.Z (package.json has ${version})` };
  return named === version
    ? { ok: true, text: `package.json ${version} matches the title` }
    : { ok: false, text: `package.json ${version}, title v${named}` };
}

/**
 * Gate 1, mechanical part: a product diff over the threshold needs a
 * `refactor:` commit from the /simplify pass, or "nothing to simplify" in
 * the PR body. A `refactor:` commit counts only after an earlier commit
 * that isn't `test:`: a refactoring PR's own commits are the change, not a
 * pass over it (S16 #805: its only commit passed the gate, /simplify never ran).
 *
 * @param {number} lines product lines of the PR diff
 * @param {string[]} subjects commit subjects of the PR
 * @param {string} [body] PR body
 */
export function simplifyVerdict(lines, subjects, body, { simplifyRan = false } = {}) {
  const label = `1 /simplify pass (${lines} product lines)`;
  if (lines <= SIMPLIFY_THRESHOLD) return { ok: true, text: `${label}: not needed` };
  if (simplifyRan) return { ok: true, text: `${label}: ship simplify --finish ran on this PR` };
  const isRefactor = (s) => /^refactor(\([^)]*\))?!?: /.test(s);
  const isTest = (s) => /^test(\([^)]*\))?!?: /.test(s);
  const isMerge = (s) => /^Merge /.test(s);
  const firstChange = subjects.find((s) => !isTest(s) && !isMerge(s));
  const refactoringPr = firstChange !== undefined && isRefactor(firstChange);
  const commit = refactoringPr
    ? undefined
    : subjects.find(
        (s, i) =>
          isRefactor(s) && subjects.slice(0, i).some((earlier) => !isTest(earlier) && !isMerge(earlier))
      );
  if (commit) return { ok: true, text: `${label}: "${commit}"` };
  if (/nothing to simplify/i.test(body ?? ''))
    return { ok: true, text: `${label}: the PR body says nothing to simplify` };
  const only = refactoringPr
    ? 'its first change is a refactor: commit (a refactoring PR or a refactor: prep commit), so no refactor: commit counts as the pass (fix rounds included, S21 #841); run ship simplify --finish, or say so'
    : subjects.some(isRefactor)
      ? 'its refactor: commits are the change itself, not a pass over it'
      : 'no refactor: commit';
  return { ok: false, text: `${label}: ${only}, and no "nothing to simplify" in the PR body` };
}

/**
 * Gate 3, mechanical part: the red commit type-checks, so its tests fail on
 * an assertion and not on a missing export. A pass is cached per commit.
 *
 * @param {boolean[]} results
 * @param {number} prNumber
 * @param {string} red red commit SHA
 */
function redBuildGate(results, prNumber, red) {
  const marker = `/tmp/ship-red-${prNumber}.ok`;
  const label = `3 red commit ${red.slice(0, 10)} type-checks`;
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === red) {
    gateLine(results, true, `${label} (checked before)`);
    return;
  }
  const passed = inTempWorktree(red, `/tmp/red-${prNumber}`, (cwd) =>
    step('npm run type-check on the red commit', 'npm run type-check', cwd)
  );
  if (passed) writeFileSync(marker, `${red}\n`);
  gateLine(results, passed, label);
}

/**
 * Checks the mechanical gates on the PR's current head and prints one line
 * per gate; the judgment gates are printed as reminders. `--tier` is
 * required, so a tier-1 PR isn't held to the red-commit rule by default.
 *
 * @param {string[]} argv `<pr> --tier=1|2|3`, optional `--macos`, `--no-issue` (a PR with no issue to close), `--repeat=<run id>` (or `--timing` to demand one), `--fixes-main` (skip gate 5 for the PR that fixes a red main; refused when main is green)
 */
async function gates(argv) {
  const { positional, keys, flags } = parseArgs(argv);
  const tier = Number(keys.tier);
  if (!positional[0] || ![1, 2, 3].includes(tier))
    return usage('gates <pr> --tier=1|2|3 [--macos] [--timing] [--repeat=<run id>] [--no-issue] [--fixes-main] [--release]');
  const pr = prInfo(positional[0]);
  const head = pr.headRefOid;
  const results = [];
  console.log(`gates for PR #${pr.number} at ${head.slice(0, 10)} (tier ${tier})`);
  run('git', ['fetch', '-q', 'origin', `pull/${pr.number}/head`]);
  const baseRef = freshOriginRef(pr.baseRefName);
  const forkPoint = run('git', ['merge-base', baseRef, head]);
  const prFiles = run('git', ['diff', '--name-only', forkPoint, head]).split('\n').filter(Boolean);

  const commits = run('git', ['log', '--reverse', '--no-merges', '--format=%H %s', `${forkPoint}..${head}`])
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
  const numstat = run('git', ['diff', '--numstat', forkPoint, head]);
  const simplify = simplifyVerdict(productLines(numstat), commits.map((c) => c.subject), pr.body, {
    simplifyRan: simplifyStillCovers(simplifyMarker(pr.number), head),
  });
  gateLine(results, simplify.ok, simplify.text);
  if (tier > 1) {
    const first = commits[0];
    const isRed = /^test: /.test(first?.subject ?? '');
    gateLine(results, isRed, `3 first commit is the red commit: "${first?.subject ?? ''}"`);
    if (isRed) redBuildGate(results, pr.number, first.sha);
  }
  if (keys.repeat) {
    const r = ghJson(['run', 'view', keys.repeat, '--json', 'headSha,conclusion,status']);
    gateLine(
      results,
      r.headSha === head && r.conclusion === 'success',
      `4 repeat run ${keys.repeat}: ${r.status} ${r.conclusion ?? ''} on ${r.headSha.slice(0, 10)}${r.headSha === head ? '' : ' (not the head)'}`
    );
  } else if (flags.has('timing')) {
    gateLine(
      results,
      false,
      '4 repeat run: none given (ship repeat <pr> <smoke files>, then --repeat=<id>)'
    );
  }
  ciGates(results, pr, flags.has('macos'));
  mainGate(results, flags.has('fixes-main'));
  await freshBaseGate(results, pr, baseRef, forkPoint, prFiles);
  const release = flags.has('release');
  if (release) {
    const version = releaseVersion(spawnSync('git', ['show', `${head}:package.json`], { encoding: 'utf8' }).stdout, pr.title);
    const other = prFiles.filter((f) => !RELEASE_FILES.includes(f));
    gateLine(results, prFiles.includes('CHANGELOG.md'), '7 release: CHANGELOG.md changed');
    gateLine(results, other.length === 0, `7 release: only ${RELEASE_FILES.join(', ')} changed${other.length ? ` (also ${other.join(', ')})` : ''}`);
    gateLine(results, version.ok, `7 release: ${version.text}`);
  } else gateLine(results, !prFiles.includes('CHANGELOG.md'), '7 CHANGELOG.md untouched');
  const parts = partOfIssues(pr.body);
  const messages = run('git', ['log', '--no-merges', '--format=%h %B%x00', `${forkPoint}..${head}`]);
  const stray = strayClosingCommits(messages, closedIssues(pr.body));
  gateLine(
    results,
    stray.length === 0,
    `7 no commit message closes an issue the PR body doesn't${stray.length ? `: ${stray.map((c) => `${c.sha} closes #${c.issue}`).join(', ')} (GitHub closes it on merge; reword the commit)` : ''}`
  );
  if (flags.has('no-issue') || release) {
    const linked = prIssues(pr.number) ?? [];
    gateLine(
      results,
      linked.length === 0,
      `7 ${release ? '--release' : '--no-issue'}: GitHub links no issue to close${linked.length ? `, but it links #${linked.join(', #')} (a "Closes #N" quoted in the body closes it on merge; reword it)` : ''}`
    );
  }
  else {
    const closed = closedIssues(pr.body);
    const named = [...closed.map((n) => `#${n}`), ...parts.map((n) => `part of #${n}`)];
    gateLine(
      results,
      named.length > 0,
      `7 PR body names its issue: ${named.length ? named.join(', ') : 'no "Closes #<N>", and no "Part of #<N>" at the start of a line (add one, or --no-issue for a PR with no issue)'}`
    );
  }
  const scope = prScope(pr);
  const left = leftoverLines(scope);
  gateLine(
    results,
    left.length === 0,
    `8 leftovers of #${scope.join(', #')}: ${left.length ? left.join('; ') : 'none'}`
  );

  console.log(
    'judge yourself: 1 review findings resolved and re-checked · 2 fresh-agent test done (tier 2-3) · 3 reviewer ran the red commit · 7 docs match the behaviour'
  );
  return results.every(Boolean) ? EXIT.ok : EXIT.failed;
}

/**
 * Issue numbers the PR body closes with `Closes`, `Fixes` or `Resolves`
 * (any case, optional colon; `#N` or this repo's issue URL), as strings.
 * Fenced code blocks are ignored; "doesn't close #5" still counts.
 *
 * @param {string} [body]
 */
export function closedIssues(body) {
  const text = withoutFencedCode(body);
  const ref = `(?:#|https://github\\.com/${REPO}/issues/)(\\d+)(?![\\w/-])`;
  const keyword = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\\s+';
  const found = [...text.matchAll(new RegExp(keyword + ref, 'gi'))];
  return [...new Set(found.map((m) => m[1]))];
}

/**
 * A PR body without its fenced code blocks, so an example `Closes #5` in a
 * code sample never counts.
 *
 * @param {string} [body]
 */
function withoutFencedCode(body) {
  return (body ?? '').replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?(^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, '');
}

/**
 * Commits whose message closes an issue the PR body doesn't close: GitHub
 * closes it on merge whatever the PR says (S19: `test: fix #465 specify…`
 * closed #465, which the PR was only part of).
 *
 * @param {string} log `git log --format='%h %B%x00'` output
 * @param {string[]} closes issues the PR body closes
 * @returns {{ sha: string, issue: string }[]}
 */
export function strayClosingCommits(log, closes) {
  return log
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [sha] = entry.split(' ', 1);
      return closedIssues(entry.slice(sha.length))
        .filter((issue) => !closes.includes(issue))
        .map((issue) => ({ sha, issue }));
    });
}

/**
 * Issue numbers a PR body names with `Part of #N` at the start of a line
 * (optionally a list item or quote), as strings; fenced code is ignored.
 * "Last part of #797" in a sentence doesn't count (S22). S17:
 * five PRs made by `ship brief … PART=1` failed gate 7 and needed
 * `--no-issue`, which hides a missing issue entirely.
 *
 * @param {string} [body]
 */
export function partOfIssues(body) {
  const text = withoutFencedCode(body);
  const ref = `(?:#|https://github\\.com/${REPO}/issues/)(\\d+)(?![\\w/-])`;
  const found = [
    ...text.matchAll(new RegExp(`^[ \\t]*(?:[-*>#]+[ \\t]*|\\d+\\.[ \\t]+)?(?:\\*\\*)?part of:?(?:\\*\\*)?\\s+${ref}`, 'gim')),
  ];
  return [...new Set(found.map((m) => m[1]))];
}

/**
 * Numbers of the issues a PR closes, as strings.
 *
 * @param {number} prNumber
 */
function prIssues(prNumber) {
  const pr = ghJson(['pr', 'view', String(prNumber), '--json', 'closingIssuesReferences']);
  return pr?.closingIssuesReferences.map((i) => String(i.number));
}

/**
 * Appends entries to a snapshot file, adding the newline a snapshot written
 * without a trailing one lacks, so two names never glue together.
 *
 * @param {string} file
 * @param {string[]} names
 */
export function appendSnapshotEntries(file, names) {
  const text = readFileSync(file, 'utf8');
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${text}${separator}${names.join('\n')}\n`);
}

/**
 * Checks the arguments of `ship snapshot`: none takes a snapshot, and
 * `--accept <name>…` accepts names that hold no newline and exist in at
 * least one of the snapshotted directories (a name in both is accepted in both).
 *
 * @param {string[]} argv
 * @param {Record<string, string>} dirs snapshot key → directory
 * @returns {{ accept: { key: string, name: string }[] | null } | { error: string }}
 */
export function parseSnapshotArgs(argv, dirs) {
  if (!argv.length) return { accept: null };
  if (argv.length === 1 && argv[0] === '--accept-live') return { acceptLive: true };
  if (argv.length === 1 && argv[0] === '--accept-main') return { acceptMain: true };
  const names = argv.slice(1);
  if (argv[0] !== '--accept' || !names.length)
    return { error: 'snapshot takes no arguments, --accept <name>…, --accept-live or --accept-main' };
  const bad = names.find((n) => n.includes('\n') || n.includes('\r'));
  if (bad !== undefined) return { error: `name contains a newline: ${JSON.stringify(bad)}` };
  const unsafe = names.find((n) => n === '' || n === '.' || n === '..' || /[\\/]/.test(n));
  if (unsafe !== undefined)
    return { error: `name must be a plain entry of the directory, not ${JSON.stringify(unsafe)}` };
  const accept = [];
  for (const name of names) {
    const keys = Object.keys(dirs).filter((k) => existsSync(join(dirs[k], name)));
    if (!keys.length)
      return { error: `${name} does not exist in ${Object.values(dirs).join(' or ')}` };
    accept.push(...keys.map((key) => ({ key, name })));
  }
  return { accept };
}

/**
 * True when a Unix socket accepts a connection within the timeout: bdg's
 * only liveness signal for a session.
 *
 * @param {string} path
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function socketAccepts(path, timeoutMs = 1000) {
  return new Promise((done) => {
    const socket = createConnection(path);
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

/**
 * `ship snapshot --accept-live`: when the user's own session in ~/.bdg is
 * live (its daemon.sock accepts a connection), accepts every current ~/.bdg
 * entry as presence-only, so its log and PID files don't fail gate 8.
 *
 * @param {string} dir the ~/.bdg directory
 */
async function acceptLiveSession(dir) {
  if (!existsSync(SNAPSHOT.bdg))
    return usage('snapshot --accept-live: needs a snapshot from ship snapshot');
  if (!(await socketAccepts(join(dir, 'daemon.sock'))))
    return usage(`snapshot --accept-live: no live session in ${dir} (daemon.sock does not accept a connection)`);
  const names = listDir(dir);
  appendSnapshotEntries(SNAPSHOT.bdg, names);
  writeFileSync(LIVE_MARKER, `${dir}\n`);
  console.log(`accepted the live session in ~/.bdg: ${names.join(', ')}`);
  return EXIT.ok;
}

/**
 * Snapshots ~/.bdg and ~/Downloads at session start, for gate 8. With
 * `--accept <name>…` it appends entries to the matching snapshot instead
 * (a file the user put in ~/Downloads, or their own live session's file in
 * ~/.bdg); `--accept-live` accepts all of a live session in ~/.bdg. Both
 * need an existing snapshot. Any other argument is a usage error and
 * leaves the snapshot alone.
 *
 * @param {string[]} [argv]
 */
async function snapshot(argv = []) {
  const dirs = { bdg: join(homedir(), '.bdg'), downloads: join(homedir(), 'Downloads') };
  const parsed = parseSnapshotArgs(argv, dirs);
  if ('error' in parsed) return usage(`snapshot [--accept <name>… | --accept-live | --accept-main]: ${parsed.error}`);
  if (parsed.acceptLive) return acceptLiveSession(dirs.bdg);
  if (parsed.acceptMain) {
    writeFileSync(SNAPSHOT.main, mainCheckoutStatus().join('\n'));
    console.log('accepted the main checkout as it is now (your own edits there, or another thread\'s)');
    return EXIT.ok;
  }
  if (parsed.accept) {
    if (parsed.accept.some(({ key }) => !existsSync(SNAPSHOT[key])))
      return usage('snapshot --accept <name>…: needs a snapshot from ship snapshot');
    for (const key of Object.keys(dirs)) {
      const names = parsed.accept.filter((a) => a.key === key).map((a) => a.name);
      if (names.length) appendSnapshotEntries(SNAPSHOT[key], names);
    }
    console.log(`accepted: ${parsed.accept.map(({ key, name }) => `${name} (~/${key === 'bdg' ? '.bdg' : 'Downloads'})`).join(', ')}`);
    return EXIT.ok;
  }
  checkDependencies();
  rmSync(LIVE_MARKER, { force: true });
  writeFileSync(SNAPSHOT.main, mainCheckoutStatus().join('\n'));
  writeFileSync(SNAPSHOT.time, `${Date.now()}\n`);
  writeFileSync(SNAPSHOT.bdg, snapshotLines(listEntries(dirs.bdg)).join('\n'));
  writeFileSync(SNAPSHOT.downloads, snapshotLines(listEntries(dirs.downloads)).join('\n'));
  console.log(`snapshot of ~/.bdg and ~/Downloads in ${SNAPSHOT.bdg}, ${SNAPSHOT.downloads}`);
  return EXIT.ok;
}

/**
 * Lists a directory's entries, or none when it doesn't exist.
 *
 * @param {string} dir
 */
function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** Entries the OS writes on its own (Finder), never a leftover */
const OS_ENTRIES = new Set(['.DS_Store']);

/**
 * Lists a directory's entries with their modification time and size, or
 * none when it doesn't exist; an entry removed while listing, and an entry
 * the OS writes on its own, are skipped.
 *
 * @param {string} dir
 * @returns {{ name: string, mtimeMs: number, size: number }[]}
 */
export function listEntries(dir) {
  return listDir(dir).flatMap((name) => {
    if (OS_ENTRIES.has(name)) return [];
    try {
      const { mtimeMs, size } = lstatSync(join(dir, name));
      return [{ name, mtimeMs, size }];
    } catch {
      return [];
    }
  });
}

/**
 * The change signature of a directory entry: whole-millisecond mtime and size.
 *
 * @param {{ mtimeMs: number, size: number }} entry
 */
function entrySignature(entry) {
  return `${Math.trunc(entry.mtimeMs)}\t${entry.size}`;
}

/**
 * Snapshot lines, one `name<TAB>mtime<TAB>size` per entry, so gate 8 sees
 * an existing file that was written to, not only a new name.
 *
 * @param {{ name: string, mtimeMs: number, size: number }[]} entries
 */
export function snapshotLines(entries) {
  return entries.map((e) => `${e.name}\t${entrySignature(e)}`);
}

/**
 * Parses a snapshot into name → signature. A bare name (a snapshot from
 * before signatures, or an `--accept` entry) maps to null: only its
 * presence is checked. A later line for a name replaces an earlier one.
 *
 * @param {string} text
 * @returns {Map<string, string | null>}
 */
export function parseSnapshot(text) {
  const entries = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const signed = /^(.*)\t(\d+)\t(\d+)$/.exec(line);
    entries.set(signed ? signed[1] : line, signed ? `${signed[2]}\t${signed[3]}` : null);
  }
  return entries;
}

/**
 * Entries added since the snapshot, and entries whose mtime or size changed.
 *
 * @param {Map<string, string | null>} before
 * @param {{ name: string, mtimeMs: number, size: number }[]} current
 */
export function snapshotChanges(before, current) {
  const added = current.filter((e) => !before.has(e.name)).map((e) => e.name);
  const changed = current
    .filter((e) => {
      const signature = before.get(e.name);
      return signature != null && signature !== entrySignature(e);
    })
    .map((e) => e.name);
  return { added, changed };
}

/**
 * True when a PID was reused: the process now holding it started after
 * the PID file was written (`cmd & echo $! > file` writes it right after
 * the start; 10 s slack). S20: two stale review PID files from S16 named
 * macOS system daemons, which "kill only PIDs read back from your files"
 * would have killed.
 *
 * @param {number} startedAtMs start time of the process holding the PID
 * @param {number} fileMtimeMs
 */
export function pidReused(startedAtMs, fileMtimeMs) {
  return Number.isFinite(startedAtMs) && startedAtMs > fileMtimeMs + 10_000;
}

/**
 * The PID a PID file names when that process is alive and is the one the
 * file was written for, else null.
 *
 * @param {string} file
 */
function livePidOf(file) {
  let pid;
  let mtimeMs;
  try {
    pid = Number(readFileSync(file, 'utf8').trim());
    mtimeMs = lstatSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (!pid || !alive(pid)) return null;
  const started = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).stdout?.trim();
  return pidReused(Date.parse(started ?? ''), mtimeMs) ? null : pid;
}

/** True when the process with this PID is alive */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * True when a PID file or temporary worktree name belongs to one of the
 * given issue or PR numbers or names, matched whole (`/tmp/bdg-impl-611-fixtures.pid`,
 * `/tmp/review-611`). A suffixed name (`465a`, brief NAME=) is in scope only
 * when it is listed: the issue number alone never takes in a sibling PR's
 * `465c` files (S18: 465c's fixtures blocked 465a's merge).
 *
 * @param {string} name
 * @param {string[]} scope
 */
export function inScope(name, scope) {
  return scope.some((n) => new RegExp(`(^|[-/])${n}(-|\\.pid$|$)`).test(name));
}

/**
 * Temporary worktrees the ship steps create, from `git worktree list --porcelain`.
 *
 * @param {string} porcelain
 */
export function tempWorktrees(porcelain) {
  return porcelain
    .split('\n')
    .filter((l) => /^worktree \/(private\/)?tmp\/(review|review2|red|mc)-/.test(l))
    .map((l) => l.slice('worktree '.length));
}

/**
 * What was left behind: new or written-to entries in ~/.bdg and ~/Downloads
 * since the snapshot (a missing snapshot counts as a leftover, so it can't pass
 * silently), live processes from PID files, and temporary worktrees. With a
 * scope, only PID files and worktrees of those issue or PR numbers count.
 *
 * @param {string[]} [scope]
 */
function leftoverLines(scope) {
  const lines = [];
  for (const [key, dir] of [
    ['bdg', '.bdg'],
    ['downloads', 'Downloads'],
  ]) {
    if (!existsSync(SNAPSHOT[key])) {
      lines.push(`no snapshot of ~/${dir} (run ship snapshot at session start)`);
      continue;
    }
    const before = parseSnapshot(readFileSync(SNAPSHOT[key], 'utf8'));
    const liveAccepted = key === 'bdg' && existsSync(LIVE_MARKER);
    const entries = listEntries(join(homedir(), dir)).filter(
      (e) => !liveAccepted || !isSessionFileName(e.name)
    );
    const { added, changed } = snapshotChanges(before, entries);
    if (added.length) lines.push(`new in ~/${dir}: ${added.join(', ')}`);
    if (changed.length)
      lines.push(
        `written to in ~/${dir} since the snapshot: ${changed.join(', ')} (a user's own file: ship snapshot --accept <name>; their live session: --accept-live)`
      );
  }
  if (existsSync(SNAPSHOT.main)) {
    const added = mainCheckoutChanges(readFileSync(SNAPSHOT.main, 'utf8').split('\n'), mainCheckoutStatus());
    if (added.length) lines.push(`new in the main checkout since the snapshot: ${added.join(', ')}`);
  }
  for (const line of orphanWorktreeProcesses(scope)) lines.push(line);
  for (const line of strayTestChromes(scope)) lines.push(line);
  const agentDaemon = agentDaemonInBdgHome();
  if (agentDaemon) lines.push(`an agent's bdg session is live in ~/.bdg: ${agentDaemon}`);
  for (const file of readdirSync('/tmp').filter((f) => /^bdg-.*\.pid$/.test(f))) {
    if (scope && !inScope(file, scope)) continue;
    if (scope && /^bdg-fixtures-[\w.-]+\.pid$/.test(file)) continue;
    const pid = livePidOf(join('/tmp', file));
    if (pid) lines.push(`live PID ${pid} from /tmp/${file}`);
  }
  const temp = tempWorktrees(run('git', ['worktree', 'list', '--porcelain'])).filter(
    (p) => !scope || inScope(p, scope)
  );
  if (temp.length) lines.push(`temporary worktrees: ${temp.join(', ')}`);
  return lines;
}

/**
 * The name a PR's worktree carries (`../bdg-465a` → `465a`), or null.
 *
 * @param {string} headRefName
 */
function ownWorktreeName(headRefName) {
  const path = worktreeOfBranch(run('git', ['worktree', 'list', '--porcelain']), headRefName);
  const name = path ? /\/bdg-([\w.-]+)$/.exec(path)?.[1] : null;
  return name && name !== 'verify' ? name : null;
}

/**
 * The names whose files and processes belong to a PR: its number, the
 * issues it closes or is part of, and its own worktree name. A sibling's
 * suffixed name is never in it.
 *
 * @param {object} pr from prInfo
 */
function prScope(pr) {
  return [
    ...new Set(
      [String(pr.number), ...(prIssues(pr.number) ?? []), ...partOfIssues(pr.body), ownWorktreeName(pr.headRefName)].filter(Boolean)
    ),
  ];
}

/** PID file of the fixture server the orchestrator starts for PR or issue N */
function fixturesPidFile(n) {
  return `/tmp/bdg-fixtures-${n}.pid`;
}

/**
 * True when a command line is the fixture server `ship fixtures` starts.
 *
 * @param {string} command
 */
export function isFixturesCommand(command) {
  return command.includes('serveFixtures');
}

/**
 * The PID in N's fixtures PID file when that process is alive and is the
 * fixture server (its command line says so: a PID reused after a crash or
 * reboot is never signalled), else null.
 *
 * @param {string} n
 */
function runningFixturesPid(n) {
  const file = fixturesPidFile(n);
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (!pid || !alive(pid)) return null;
  const command = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
  return isFixturesCommand(command ?? '') ? pid : null;
}

/**
 * Stops the orchestrator's fixture server for N (its whole process group:
 * tsx runs the server in a child) and removes its PID file; a stale file
 * is only removed.
 *
 * @param {string} n
 * @returns {'stopped' | 'stale' | null} null when there was no PID file
 */
function stopFixtures(n) {
  const file = fixturesPidFile(n);
  if (!existsSync(file)) return null;
  const pid = runningFixturesPid(n);
  if (pid) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  }
  rmSync(file);
  return pid ? 'stopped' : 'stale';
}

/**
 * Starts the fixture servers from a worktree for the tester, with a PID file
 * `ship merge` knows: it stops them instead of failing gate 8 (S14: two
 * merges blocked by the orchestrator's own fixtures). Prints the URLs.
 *
 * @param {string[]} argv `<N> [dir=<worktree>]` or `<N> --stop`
 */
async function fixtures(argv) {
  const { positional, keys, flags } = parseArgs(argv);
  const n = positional[0];
  if (!n || !/^[A-Za-z0-9][\w.-]*$/.test(n))
    return usage('fixtures <N, or a name that starts with it, e.g. 529a> [dir=<worktree>] | fixtures <N or name> --stop');
  if (flags.has('stop')) {
    const result = stopFixtures(n);
    console.log(
      result === 'stopped'
        ? `stopped the fixtures of #${n}`
        : result === 'stale'
          ? `removed a stale PID file of #${n} (no fixture server behind it)`
          : `no fixtures of #${n} running`
    );
    return EXIT.ok;
  }
  const logFile = `/tmp/bdg-fixtures-${n}.log`;
  const pidFile = fixturesPidFile(n);
  if (runningFixturesPid(n) && existsSync(logFile)) {
    console.log(readFileSync(logFile, 'utf8').trim());
    return EXIT.ok;
  }
  rmSync(pidFile, { force: true });
  const dir = keys.dir ?? resolve(mainCheckout(), '..', `bdg-${n}`);
  const tsx = join(dir, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) return usage(`fixtures ${n}: no ${tsx} (is ${dir} a worktree with node_modules linked?)`);
  const out = openSync(logFile, 'w');
  const child = spawn(tsx, ['src/__testutils__/serveFixtures.ts'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', out, out],
    env: pinnedEnv(),
  });
  closeSync(out);
  child.on('error', (error) => console.log(`FAIL the fixtures of #${n} did not start: ${error.message}`));
  if (!child.pid) return EXIT.failed;
  writeFileSync(pidFile, `${child.pid}\n`);
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const text = readFileSync(logFile, 'utf8');
    if (text.includes('fixtures:')) {
      const urls = text
        .split('\n')
        .filter((line) => line.trim() && !/Ctrl-C/.test(line))
        .join('\n');
      console.log(`${urls}\nstop: ship fixtures ${n} --stop (ship merge does it for the PR's numbers)`);
      return EXIT.ok;
    }
    if (!alive(child.pid)) break;
  }
  console.log(`FAIL the fixtures of #${n} did not start:\n${readFileSync(logFile, 'utf8').split('\n').slice(-8).join('\n')}`);
  stopFixtures(n);
  return EXIT.failed;
}

/** Marker of an accepted live user session: its known files stay accepted */
const LIVE_MARKER = '/tmp/ship-accepted-live-session';

/** Files a bdg session writes in its session directory (`src/session/paths.ts` and friends) */
const SESSION_FILE_NAMES = [
  'daemon.sock',
  'daemon.pid',
  'daemon.log',
  'session.json',
  'session.meta.json',
  'chrome.pid',
  'port.txt',
  'port.lock',
  'last-session.json',
  'query-cache.json',
];

/**
 * True for a file a bdg session writes, including rotated logs and the
 * `.tmp` files of atomic writes (`daemon.log.1`, `session.json.123.tmp`).
 *
 * @param {string} name
 */
export function isSessionFileName(name) {
  return SESSION_FILE_NAMES.some((known) => name === known || name.startsWith(`${known}.`));
}

/**
 * `git status --porcelain` entries of the main checkout, untracked files
 * included.
 */
function mainCheckoutStatus() {
  const r = spawnSync('git', ['-C', mainCheckout(), 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git status in the main checkout failed: ${(r.stderr || '').trim()}`);
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

/**
 * Main-checkout status entries that weren't there at the snapshot, except
 * log.md, which `ship log` writes (S21: a tester's g2.json in the main
 * checkout went unseen by gate 8).
 *
 * @param {string[]} before porcelain lines at `ship snapshot`
 * @param {string[]} now porcelain lines now
 */
export function mainCheckoutChanges(before, now) {
  const path = (line) => /^.. (.*)$/.exec(line)?.[1] ?? line.trim().replace(/^\S+\s+/, '');
  const had = new Set(before.map(path));
  return now
    .map(path)
    .filter((path) => path && !had.has(path) && path !== '.claude/skills/ship/log.md');
}

/**
 * Live processes whose command line runs from an agent worktree of the
 * scope (`<parent>/bdg-<name>/`) and that no /tmp/bdg-*.pid file names:
 * started without a PID file, so the forbidden block's "kill only PIDs
 * read back from your files" can't be followed (S18 #820, S20 #797b killed
 * processes found by listing).
 *
 * @param {string[]} [scope] PR numbers and names; all worktrees without one
 */
function orphanWorktreeProcesses(scope) {
  const parent = dirname(mainCheckout());
  const pidFiles = new Set(
    readdirSync('/tmp')
      .filter((f) => /^bdg-.*\.pid$/.test(f))
      .map((f) => livePidOf(join('/tmp', f)))
      .filter(Boolean)
  );
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout ?? '';
  return worktreeOrphans(ps, parent, scope, pidFiles).map(
    (p) => `process ${p.pid} from ${p.worktree} has no PID file: ${p.command.slice(0, 120)}`
  );
}

/**
 * Chrome processes with a throwaway profile (`--user-data-dir` under /tmp,
 * /private/tmp, /var/folders, ~/.tmp or an agent worktree) that no PID file
 * covers: a test's Chrome left running (S25: one from #862's matrix; one from
 * a 2026-10-14 attach test, alive four days). With a PR scope only those
 * started since `ship snapshot` count, so an older one doesn't block a merge.
 *
 * @param {string[]} [scope]
 */
function strayTestChromes(scope) {
  const pidFiles = new Set(
    readdirSync('/tmp')
      .filter((f) => /^bdg-.*\.pid$/.test(f))
      .map((f) => livePidOf(join('/tmp', f)))
      .filter(Boolean)
  );
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8' }).stdout ?? '';
  const since = scope && existsSync(SNAPSHOT.time) ? Number(readFileSync(SNAPSHOT.time, 'utf8').trim()) || 0 : 0;
  const sessionPid = (profile) => (foreignSession(dirname(profile), scope) ? liveSessionChrome(dirname(profile)) : null);
  return testChromeOrphans(ps, { home: homedir(), parent: dirname(mainCheckout()) }, pidFiles, since, sessionPid).map(
    (p) => `test Chrome ${p.pid} (profile ${p.profile}) has no PID file`
  );
}

/**
 * The Chrome PID a live bdg session in `dir` keeps in `chrome.pid`, or null
 * when its daemon is gone: bdg keeps `chrome.pid` after a daemon crash, so a
 * Chrome that outlived its daemon is still an orphan.
 *
 * @param {string} dir session directory
 */
export function liveSessionChrome(dir) {
  return livePidOf(join(dir, 'daemon.pid')) ? livePidOf(join(dir, 'chrome.pid')) : null;
}

/**
 * Whether a session directory belongs to work outside a PR's scope (another
 * thread's harness, another PR's agents), so its live session doesn't block
 * this PR's merge. Never without a scope (`ship leftovers` lists them all),
 * never a directory naming a scope number (`/tmp/bdg-t-873-a`, `/tmp/rv-873-t`)
 * and never the session's verifier (`/tmp/verify-<date>`).
 *
 * @param {string} dir
 * @param {string[]} [scope]
 */
export function foreignSession(dir, scope) {
  if (!scope?.length || /\/verify-/.test(dir)) return false;
  return !scope.some((s) => new RegExp(`(^|[^0-9a-z])${s}([^0-9a-z]|$)`, 'i').test(dir));
}

/**
 * Main Chrome processes (not helpers) in `ps -axo pid=,ppid=,lstart=,command=`
 * output whose `--user-data-dir` is a throwaway location, started after
 * `sinceMs`, with no PID file on themselves or an ancestor. `sessionPid`
 * names the Chrome of a live bdg session outside the PR's scope, from the
 * `chrome.pid` next to its profile (`<session>/chrome-profile`), which covers
 * it too (S26: a fuzzer's live sessions under `/tmp/fuzz-863-*` blocked two
 * merges).
 *
 * @param {string} ps
 * @param {{ home: string, parent: string }} where
 * @param {Set<number>} pidFiles
 * @param {number} sinceMs
 * @param {(profile: string) => number | null} [sessionPid] the Chrome PID of a live session outside the scope that owns this profile
 */
export function testChromeOrphans(ps, where, pidFiles, sinceMs, sessionPid = () => null) {
  const throwaway = [/^\/tmp\//, /^\/private\/tmp\//, /^\/var\/folders\//, new RegExp(`^${where.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.tmp/`), new RegExp(`^${where.parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bdg-`)];
  const procs = ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, started, command]) => ({ pid: Number(pid), ppid: Number(ppid), started: Date.parse(started), command }));
  const parentOf = new Map(procs.map((p) => [p.pid, p.ppid]));
  const covered = (pid) => {
    for (let at = pid, hops = 0; at > 1 && hops < 64; at = parentOf.get(at) ?? 0, hops++) if (pidFiles.has(at)) return true;
    return false;
  };
  return procs
    .filter((p) => /(Google Chrome|chrome|Chromium)(\s|$)/.test(p.command) && !/Helper|--type=/.test(p.command))
    .map((p) => ({ ...p, profile: /--user-data-dir=(\S+)/.exec(p.command)?.[1] }))
    .filter((p) => p.profile && throwaway.some((re) => re.test(p.profile)))
    .filter((p) => !(p.started < sinceMs))
    .filter((p) => !covered(p.pid) && sessionPid(p.profile) !== p.pid);
}

/**
 * Processes in `ps -axo pid=,ppid=,command=` output running from a scoped
 * worktree with no PID file on themselves or any ancestor (`cmd & echo $!`
 * records npx, and the server it starts runs a few levels below). A path
 * written as `<main>/../bdg-N/` counts as `<parent>/bdg-N/`.
 *
 * @param {string} ps
 * @param {string} parent directory holding the worktrees
 * @param {string[] | undefined} scope
 * @param {Set<number>} pidFiles PIDs read from /tmp/bdg-*.pid
 */
export function worktreeOrphans(ps, parent, scope, pidFiles) {
  const procs = ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command: command.replace(/\/[^/\s]+\/\.\.\//g, '/') }));
  const parentOf = new Map(procs.map((p) => [p.pid, p.ppid]));
  const covered = (pid) => {
    for (let at = pid, hops = 0; at > 1 && hops < 64; at = parentOf.get(at) ?? 0, hops++)
      if (pidFiles.has(at)) return true;
    return false;
  };
  return procs
    .map((p) => ({ ...p, worktree: new RegExp(`${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(bdg-[\\w.-]+)/`).exec(p.command)?.[1] }))
    .filter((p) => p.worktree && p.worktree !== 'bdg-verify')
    .filter((p) => !scope || scope.some((n) => p.worktree === `bdg-${n}`))
    .filter((p) => !covered(p.pid));
}

/**
 * True when a daemon command line runs bdg from an agent worktree
 * (`<parent>/bdg-<N>/…`, `<parent>/bdg-verify/…`), not the user's own bdg.
 *
 * @param {string} command
 * @param {string} parent the directory holding the main checkout and the worktrees
 */
export function isAgentCommand(command, parent) {
  return command.includes(`${parent}/bdg-`);
}

/**
 * The command line of a live daemon in ~/.bdg started from an agent worktree,
 * or null. That is an agent's session in the user's directory (S11), which
 * gate 8 reports even when the user's live session is accepted.
 */
function agentDaemonInBdgHome() {
  const file = join(homedir(), '.bdg', 'daemon.pid');
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (!pid || !alive(pid)) return null;
  const command = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return isAgentCommand(command, dirname(mainCheckout())) ? command : null;
}

/**
 * Prints the leftovers, and with --clean removes PID files whose process is gone.
 *
 * @param {string[]} argv
 */
function leftovers(argv) {
  const { flags } = parseArgs(argv);
  if (flags.has('clean')) {
    for (const file of readdirSync('/tmp').filter((f) => /^bdg-.*\.pid$/.test(f))) {
      if (!livePidOf(join('/tmp', file))) rmSync(join('/tmp', file));
    }
  }
  const lines = leftoverLines();
  console.log(lines.length ? lines.join('\n') : 'no leftovers');
  return lines.length ? EXIT.failed : EXIT.ok;
}

/**
 * After a merge into `main`, closes an issue the PR body closes (`Closes #N`)
 * when GitHub left it open, with a comment naming the PR (S25: #860 stayed
 * open after #875). "Part of" issues and stacked PRs (another base) are left
 * alone; a failure here is reported, never turned into a failed merge.
 *
 * @param {object} pr
 */
function closeIssuesLeftOpen(pr) {
  if (pr.baseRefName !== 'main') return;
  for (const n of closedIssues(pr.body)) {
    try {
      const issue = ghJson(['issue', 'view', n, '--json', 'state']);
      if (issue?.state !== 'OPEN') continue;
      run('gh', ['issue', 'close', n, '--repo', REPO, '--comment', `Closed by #${pr.number}, which says "Closes #${n}"; GitHub didn't close it on merge.`], {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
      console.log(`closed #${n}: the PR body closes it, GitHub left it open`);
    } catch (error) {
      console.log(`merged, but could not check or close #${n}: ${String(error.stderr || error.message).split('\n')[0]}`);
    }
  }
}

/**
 * Fast-forwards the main checkout to origin/main after a merge, when it is
 * on main. `git merge --ff-only` works with the uncommitted log.md rows that
 * `ship log` leaves, where `git pull --rebase` refuses (S18).
 */
function fastForwardMainCheckout() {
  const main = mainCheckout();
  const branch = spawnSync('git', ['-C', main, 'branch', '--show-current'], { encoding: 'utf8' }).stdout.trim();
  if (branch !== 'main') return console.log(`main checkout is on ${branch || 'a detached HEAD'}: not fast-forwarded`);
  freshOriginRef('main');
  const ff = spawnSync('git', ['-C', main, 'merge', '--ff-only', '-q', 'origin/main'], { encoding: 'utf8' });
  console.log(
    ff.status === 0
      ? 'main checkout fast-forwarded to origin/main'
      : `main checkout not fast-forwarded: ${(ff.stderr || ff.stdout).trim().split('\n')[0]}`
  );
}

/**
 * Merges a PR whose gates hold, on the exact head they were checked on, then
 * removes its worktree and branch when the worktree has nothing uncommitted.
 *
 * @param {string[]} argv `<pr>` plus the gates options
 */
async function merge(argv) {
  const prNumber = argv[0];
  if (!prNumber) return usage('merge <pr> --tier=1|2|3 [--macos] [--timing] [--repeat=<run id>] [--no-issue] [--fixes-main] [--release]');
  const pr = prInfo(prNumber);
  process.chdir(mainCheckout());
  for (const n of prScope(pr))
    if (stopFixtures(n) === 'stopped') console.log(`stopped your fixtures of ${n} (ship fixtures)`);
  if ((await gates(argv)) !== EXIT.ok) {
    console.log('not merged: a gate failed');
    return EXIT.failed;
  }
  if (prInfo(prNumber).headRefOid !== pr.headRefOid) {
    console.log('not merged: the head moved while the gates ran');
    return EXIT.superseded;
  }
  if (pr.isDraft)
    run('gh', ['pr', 'ready', String(pr.number), '--repo', REPO], { timeoutMs: WRITE_TIMEOUT_MS });
  const mergeArgs = [
    'pr',
    'merge',
    String(pr.number),
    '--repo',
    REPO,
    '--merge',
    '--match-head-commit',
    pr.headRefOid,
    '--subject',
    `${pr.title} (#${pr.number})`,
  ];
  writeWithRecheck(
    () => run('gh', mergeArgs, { timeoutMs: WRITE_TIMEOUT_MS }),
    () => prInfo(prNumber).state === 'MERGED',
    `merge of PR #${pr.number}`
  );
  let mergeSha = null;
  for (let i = 0; i < 5 && !mergeSha; i++) {
    mergeSha = prInfo(prNumber).mergeCommit?.oid ?? null;
    if (!mergeSha) await sleep(3000);
  }
  console.log(`merged PR #${pr.number} as ${mergeSha}`);
  removeBranchWorktree(pr.headRefName);
  rmSync(`/tmp/ship-mc-${pr.number}.ok`, { force: true });
  closeIssuesLeftOpen(pr);
  fastForwardMainCheckout();
  console.log(`next: ship ci-wait ${mergeSha} --push`);
  return EXIT.ok;
}

/**
 * The path of the worktree that has exactly this branch checked out, from
 * `git worktree list --porcelain`, or null.
 *
 * @param {string} porcelain
 * @param {string} branch
 */
export function worktreeOfBranch(porcelain, branch) {
  const block = porcelain
    .split('\n\n')
    .find((b) => b.split('\n').includes(`branch refs/heads/${branch}`));
  return block ? block.split('\n')[0].slice('worktree '.length) : null;
}

/**
 * Removes the worktree and local branch of a merged PR. Keeps the worktree
 * when it holds uncommitted changes, and the branch unless main contains it.
 *
 * @param {string} branch
 */
function removeBranchWorktree(branch) {
  if (branch === 'main') return;
  const path = worktreeOfBranch(run('git', ['worktree', 'list', '--porcelain']), branch);
  if (path && !existsSync(path)) {
    run('git', ['worktree', 'prune']);
  } else if (path) {
    const status = run('git', ['-C', path, 'status', '--short']);
    if (status) {
      console.log(`kept ${path}: uncommitted changes\n${status}`);
      return;
    }
    run('git', ['worktree', 'remove', path]);
    console.log(`removed worktree ${path}`);
  }
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0)
    return;
  const merged = spawnSync('git', ['merge-base', '--is-ancestor', branch, freshOriginRef('main')]);
  if (merged.status !== 0) {
    console.log(`kept branch ${branch}: origin/main doesn't contain it`);
    return;
  }
  run('git', ['branch', '-D', branch]);
  console.log(`deleted branch ${branch}`);
}

/**
 * Splits briefs.md into its shared blocks and its brief templates.
 *
 * @param {string} text
 * @returns {{ blocks: Record<string, string>, briefs: Record<string, string> }}
 */
export function parseBriefs(text) {
  const grab = (kind) => {
    const out = {};
    const re = new RegExp(`<!-- ${kind}:([\\w-]+) -->\\n([\\s\\S]*?)\\n<!-- /${kind} -->`, 'g');
    for (const m of text.matchAll(re)) out[m[1]] = m[2];
    return out;
  };
  return { blocks: grab('block'), briefs: grab('brief') };
}

/** Placeholders the agent itself fills in at run time, not the orchestrator */
const LITERAL_PLACEHOLDERS = new Set([
  '<url>',
  '<sha>',
  '<old sha>',
  '<port>',
  '<pid>',
  '<words>',
  '<file>',
  '<area>',
]);

/** PID-file tag per role, for the forbidden block */
const ROLE_TAGS = { implementer: 'impl', reviewer: 'review', tester: 't', verifier: 'verify' };

/**
 * Renders one brief: inserts the shared blocks (`{{name}}`, nested once more),
 * then replaces `<KEY>` placeholders with the given values.
 *
 * @param {string} text the contents of briefs.md
 * @param {string} role
 * @param {Record<string, string>} values
 * @returns {{ brief: string, unfilled: string[] }}
 */
export function renderBrief(text, role, values) {
  const { blocks, briefs } = parseBriefs(text);
  if (!(role in briefs))
    throw new Error(`no brief "${role}"; known: ${Object.keys(briefs).join(', ')}`);
  const insert = (s) => s.replace(/\{\{([\w-]+)\}\}/g, (all, name) => blocks[name] ?? all);
  let brief = insert(insert(briefs[role]));
  if (values.NAME && values.N)
    brief = brief.split('#<N>').join(`#${values.N}`).split('<N>').join(values.NAME);
  for (const [key, value] of Object.entries(values)) brief = brief.split(`<${key}>`).join(value);
  const unfilled = unfilledPlaceholders(brief, templatePlaceholders(text)).filter(
    (p) => p !== '<ISSUE>' && p !== '<DESIGN>'
  );
  const unknown = [...new Set(brief.match(/\{\{[\w-]+\}\}/g) ?? [])];
  if (unknown.length) throw new Error(`unknown blocks: ${unknown.join(', ')}`);
  return { brief, unfilled };
}

/** Markers around the quoted issue, so its text is never read as a placeholder */
const ISSUE_START = '<!-- issue -->';
const ISSUE_END = '<!-- /issue -->';

/** Quoted text a brief carries verbatim (issues, a design note), skipped by the placeholder check */
const QUOTED_REGION = /<!-- (issue|design) -->[\s\S]*?<!-- \/\1 -->/g;

/**
 * A design note as it goes into a design review brief, between markers.
 *
 * @param {string} text
 */
export function formatDesign(text) {
  return `<!-- design -->\n## Design\n\n${text.trim().split('<!-- /design -->').join('<!-- /design (quoted) -->')}\n<!-- /design -->`;
}

/**
 * The issue as it goes into a brief: title, body and every comment, between
 * markers. `gh issue view --comments` prints nothing for an issue without
 * comments, so briefs quote it instead of asking the agent to fetch it.
 *
 * @param {{ number: number, title: string, body: string, comments?: { author?: { login: string }, createdAt?: string, body: string }[] }} issue
 */
export function formatIssue(issue) {
  const comments = (issue.comments ?? []).map(
    (c) => `### Comment by ${c.author?.login ?? 'unknown'} (${(c.createdAt ?? '').slice(0, 10)})\n\n${c.body.trim()}`
  );
  return [
    ISSUE_START,
    `## Issue #${issue.number}: ${issue.title}`,
    '',
    (issue.body ?? '').trim() || '(no description)',
    ...comments.flatMap((c) => ['', c]),
  ]
    .join('\n')
    .split(ISSUE_END)
    .join('<!-- /issue (quoted) -->')
    .concat(`\n${ISSUE_END}`);
}

/**
 * The placeholders the brief templates use: every `<…>` inside a brief or
 * a shared block of briefs.md, except literal ones and HTML comments. Only
 * these count as open; a `<dialog>` or `<TMPDIR>` the orchestrator writes
 * into a brief does not (S15: a false alarm in almost every brief).
 *
 * @param {string} briefsText the contents of briefs.md
 * @returns {Set<string>}
 */
export function templatePlaceholders(briefsText) {
  const { blocks, briefs } = parseBriefs(briefsText);
  const found = [...Object.values(blocks), ...Object.values(briefs)].flatMap(
    (t) => t.match(/<[^<>\n]{2,1200}>/g) ?? []
  );
  return new Set(found.filter((p) => !LITERAL_PLACEHOLDERS.has(p) && !p.startsWith('<!--')));
}

/**
 * Template placeholders still open in a brief, outside its quoted issue or design.
 *
 * @param {string} text
 * @param {Set<string>} placeholders from templatePlaceholders
 */
export function unfilledPlaceholders(text, placeholders) {
  const outside = text.replace(QUOTED_REGION, '');
  return [...new Set(outside.match(/<[^<>\n]{2,1200}>/g) ?? [])].filter((p) => placeholders.has(p));
}

/**
 * Checks a filled brief before it is sent: not empty, no placeholder left.
 * An empty brief went out twice in S14 (a `$S brief > file` that zsh didn't split).
 *
 * @param {string} text
 * @param {Set<string>} placeholders from templatePlaceholders
 * @returns {string[]} problems, none when the brief can be sent
 */
export function briefProblems(text, placeholders) {
  if (text.trim().length < 200) return [`the brief is empty or too short (${text.trim().length} characters)`];
  const open = unfilledPlaceholders(text, placeholders);
  return open.length ? [`placeholders still open: ${open.join(' ')}`] : [];
}

/** What a tier 1 implementer brief says instead of the red-commit rules */
const NO_RED_COMMIT =
  '- **No red commit** (tier 1: docs, CI, tooling, or a refactor under existing tests): the PR body says which applies and names the existing tests that cover the change.\n';

/** What the design brief checks for a new command or option instead of a false-positive matrix (S23 #848: half the brief rewritten by hand) */
const DESIGN_FEATURE = `This design is a new command or option, not a detection heuristic. Check:
- **The CLI shape:** command and option names next to the existing ones (\`bdg --help --json\`) and the renames table (\`src/utils/renames.ts\`); positional arguments against flags; what \`--help --json\` will show; an exit code for each failure the note lists.
- **Every claim the note makes about Chrome or CDP:** try each one with \`bdg cdp\` on a scratch page. Does the method exist in this Chrome, does the event fire when the note says, does the limit hold? A claim that turns out false is a finding.
- **What an agent gets:** where the result shows up (human and \`--json\`), its size limits, and what happens on reload, navigation, tab switch and when the session ends.
`;

/** What a tier 1 reviewer brief says instead of the red-commit check (S20: removed by hand twice) */
const NO_RED_REVIEW =
  '**Red commit.** None: tier 1 (docs, CI, tooling, or a refactor under existing tests). Check that the PR body says which applies and that existing tests cover the change.\n';

/**
 * Adjusts a rendered brief: tier 1 drops the red-commit rules (between
 * `<!-- red -->` markers) for one line saying why there is none; a part of
 * an issue says `Part of #N`, not `Closes #N`, so the issue stays open
 * (S16 #805, #806: both edited by hand).
 *
 * @param {string} text
 * @param {{ tier1?: boolean, part?: boolean }} variant
 */
export function briefVariant(text, variant) {
  const withRed = text
    .replace(/<!-- design-heuristic -->\n([\s\S]*?)<!-- \/design-heuristic -->\n?/g, (_, rules) =>
      variant.feature ? DESIGN_FEATURE : rules
    )
    .replace(/<!-- red -->\n([\s\S]*?)<!-- \/red -->\n/g, (_, rules) => (variant.tier1 ? NO_RED_COMMIT : rules))
    .replace(/<!-- red-review -->\n([\s\S]*?)<!-- \/red-review -->\n/g, (_, rules) =>
      variant.tier1 ? NO_RED_REVIEW : rules
    );
  return variant.part
    ? withRed.replace(/`Closes #(\d+)`/g, '`Part of #$1` on a line of its own (not `Closes`: this PR does one part, the issue stays open)')
    : withRed;
}

/**
 * Fills placeholders the orchestrator wrote into a brief by hand (S20: a
 * `<BASE>..<HEAD>` in added text failed --check): `brief --check=<file>`
 * takes the same KEY=value pairs and PR=<pr> as rendering and replaces them
 * in the file before checking, outside the quoted issue and design.
 *
 * @param {string} file
 * @param {Record<string, string>} keys
 */
function fillBriefFile(file, keys) {
  const { check: _check, out: _out, ...given } = keys;
  const values = { ...(given.PR ? prBriefValues(given.PR) : {}), ...given };
  if (!Object.keys(values).length) return;
  const text = readFileSync(file, 'utf8');
  const filled = fillOutsideQuotes(text, values);
  if (filled !== text) {
    writeFileSync(file, filled);
    console.log(`filled ${Object.keys(values).join(', ')} in ${file}`);
  }
}

/**
 * Replaces `<KEY>` placeholders in text, leaving quoted issue and design regions alone.
 *
 * @param {string} text
 * @param {Record<string, string>} values
 */
export function fillOutsideQuotes(text, values) {
  const fill = (part) =>
    Object.entries(values).reduce((acc, [key, value]) => acc.split(`<${key}>`).join(value), part);
  let out = '';
  let last = 0;
  for (const match of text.matchAll(QUOTED_REGION)) {
    out += fill(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fill(text.slice(last));
}

/**
 * The note a brief gets when this machine routes HTTP through a proxy: bdg
 * runs then see every request via the proxy as http/1.1, so h2 paths can't
 * be checked (S21: #840's reviewer missed h2). Only for roles that run bdg.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} role
 */
export function proxyNote(env, role) {
  const set = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'].filter((k) => env[k]);
  if (!set.length || role === 'implementer') return null;
  const without = set.map((k) => `-u ${k}`).join(' ');
  return `**Proxy.** This machine sets ${set.join(', ')}. Bypass it for bdg only (gh, git and npm may need it): put \`env ${without}\` inside the \`bdg\` script your brief creates, in front of its \`node …/dist/index.js\` (\`exec env ${without} node …\`), and start sessions with \`--chrome-flags="--no-proxy-server"\`. Without the bypass every request goes through the proxy as http/1.1.`;
}

/**
 * Issue numbers from `N=786` or `ISSUES=786,459 801`; anything else gives none.
 *
 * @param {string} [list]
 */
export function issueNumbers(list) {
  const parts = (list ?? '').split(/[\s,]+/).filter(Boolean);
  return parts.length && parts.every((p) => /^\d+$/.test(p)) ? [...new Set(parts)] : [];
}

/**
 * BASE, HEAD, RED and BRANCH of a PR, from its head fetched from GitHub
 * (the branch need not exist locally). RED stays open when the PR has no
 * commit past its base, so `brief --check` catches it.
 *
 * @param {string} prNumber
 */
function prBriefValues(prNumber) {
  const pr = prInfo(prNumber);
  run('git', ['fetch', '-q', 'origin', `pull/${pr.number}/head`]);
  const base = run('git', ['merge-base', freshOriginRef(pr.baseRefName), pr.headRefOid]);
  const red = run('git', ['rev-list', '--reverse', `${base}..${pr.headRefOid}`]).split('\n')[0] ?? '';
  const values = { BASE: base, HEAD: pr.headRefOid, BRANCH: pr.headRefName };
  return red ? { ...values, RED: red } : values;
}

/**
 * Renders a brief. N=<issue> quotes the issue (title, body, comments);
 * PR=<pr> fills BASE, HEAD, RED and BRANCH from the PR; explicit KEY=value
 * wins. With --out=<file> it writes the file instead of printing it; the
 * placeholders still to fill go to stderr. `brief --check=<file>` refuses an
 * empty brief or one with open placeholders, before it is sent.
 *
 * @param {string[]} argv `<role> KEY=value...` [--out=<file>], or `--check=<file>`
 */
function brief(argv) {
  const { positional, keys } = parseArgs(argv);
  const briefsText = readFileSync(join(SKILL_DIR, 'briefs.md'), 'utf8');
  const placeholders = templatePlaceholders(briefsText);
  if (keys.check) {
    if (existsSync(keys.check)) fillBriefFile(keys.check, keys);
    const problems = existsSync(keys.check)
      ? briefProblems(readFileSync(keys.check, 'utf8'), placeholders)
      : [`no file ${keys.check}`];
    console.log(problems.length ? `FAIL ${keys.check}: ${problems.join('; ')}` : `ok   ${keys.check} is ready to send`);
    return problems.length ? EXIT.failed : EXIT.ok;
  }
  if (!positional[0])
    return usage('brief <implementer|reviewer|tester|verifier|design> N=<n> [ISSUES=<n,n…>] [PR=<pr>] [DESIGN=<file>] [TIER=1] [PART=1] ... [--out=<file>] | brief --check=<file>');
  const { out, ...given } = keys;
  const values = {
    MAIN: mainCheckout(),
    ROLE: ROLE_TAGS[positional[0]] ?? positional[0],
    AGENT: 'a',
    ...(given.PR ? prBriefValues(given.PR) : {}),
    ...given,
  };
  const { DESIGN: designFile, ISSUES: issueList, TIER: tier, PART: part, KIND: kind, ...rest } = values;
  const defaults = positional[0] === 'implementer' ? { CAP: '80' } : {};
  const rendered = briefVariant(renderBrief(briefsText, positional[0], { ...defaults, ...rest }).brief, {
    tier1: tier === '1',
    part: part === '1',
    feature: kind === 'feature',
  });
  const numbers = issueNumbers(issueList ?? rest.N);
  if (issueList && !numbers.length)
    return usage(`brief: ISSUES=${issueList} must be issue numbers, e.g. ISSUES=786,459`);
  const issues = rendered.includes('<ISSUE>')
    ? numbers.map((n) => ghJson(['issue', 'view', n, '--json', 'number,title,body,comments']))
    : [];
  if (rendered.includes('<DESIGN>') && !(designFile && existsSync(designFile)))
    return usage(`brief ${positional[0]}: needs DESIGN=<file> with the design note`);
  const design = rendered.includes('<DESIGN>') ? formatDesign(readFileSync(designFile, 'utf8')) : '';
  const proxy = proxyNote(process.env, positional[0]);
  const text = (proxy ? `${rendered}\n\n${proxy}` : rendered)
    .split('<ISSUE>')
    .join(issues.length ? issues.map(formatIssue).join('\n\n') : '(no issue)')
    .split('<DESIGN>')
    .join(design);
  if (out) writeFileSync(out, `${text}\n`);
  else console.log(text);
  const open = unfilledPlaceholders(text, placeholders);
  if (open.length) console.error(`still to fill: ${open.join(' ')}`);
  if (out) console.error(`written to ${out}; after filling it in: ship brief --check=${out}`);
  return EXIT.ok;
}

/**
 * Inserts a row at the end of the main PR table of log.md (the table whose
 * header starts with `| merged`), before any later section such as Escaped.
 *
 * @param {string} text log.md content
 * @param {string} row
 */
export function insertLogRow(text, row) {
  const lines = text.split('\n');
  const header = lines.findIndex((l) => l.startsWith('| merged'));
  if (header === -1) throw new Error('log.md has no PR table (header "| merged")');
  let end = header + 1;
  while (lines[end + 1]?.startsWith('|')) end++;
  lines.splice(end + 1, 0, row);
  return lines.join('\n');
}

/**
 * Inserts one row per merged PR into log.md, the data the retro reads.
 *
 * @param {string[]} argv `<pr> tier= review=b/s/n tester=bugs rounds= model= tokens= note=`
 */
function log(argv) {
  const { positional, keys, flags } = parseArgs(argv);
  if (flags.has('pending')) return pendingLogRows();
  if (!positional[0])
    return usage(
      'log <pr> tier=2 review=0/1/2 tester=1 rounds=1 model=sonnet tokens=240k note="…" | log --pending'
    );
  const pr = ghJson([
    'pr',
    'view',
    positional[0],
    '--json',
    'number,closingIssuesReferences,mergedAt,body',
  ]);
  const issues =
    [...new Set([...pr.closingIssuesReferences.map((i) => String(i.number)), ...partOfIssues(pr.body)])]
      .map((n) => `#${n}`)
      .join(' ') || '-';
  const cell = (k) => (keys[k] ?? '-').replace(/\|/g, '/');
  const row = `| ${(pr.mergedAt ?? new Date().toISOString()).slice(0, 10)} | #${pr.number} | ${issues} | ${cell('tier')} | ${cell('review')} | ${cell('tester')} | ${cell('rounds')} | ${cell('model')} | ${cell('tokens')} | ${cell('note')} |`;
  const file = join(SKILL_DIR, 'log.md');
  writeFileSync(file, insertLogRow(readFileSync(file, 'utf8'), row));
  mkdirSync(dirname(LOG_BACKUP), { recursive: true });
  appendFileSync(LOG_BACKUP, `${row}\n`);
  console.log(`${row}\n(also kept in ${LOG_BACKUP}; ship log --pending lists rows log.md lacks)`);
  return EXIT.ok;
}

/** Every row `ship log` wrote, outside the checkout: S15's rows were lost before the retro PR */
const LOG_BACKUP = join(homedir(), '.cache', 'ship', 'log-rows.md');

/**
 * Rows of the backup that log.md doesn't have, matched by their PR cell.
 *
 * @param {string} logText
 * @param {string} backupText
 */
export function missingLogRows(logText, backupText) {
  const pr = (row) => row.split('|')[2]?.trim();
  const present = new Set(logText.split('\n').filter((l) => l.startsWith('|')).map(pr));
  const rows = backupText.split('\n').filter((l) => l.startsWith('| '));
  return [...new Map(rows.map((r) => [pr(r), r])).values()].filter((r) => !present.has(pr(r)));
}

/** Prints the logged rows log.md has lost, for the retro PR to put back. */
function pendingLogRows() {
  const backup = existsSync(LOG_BACKUP) ? readFileSync(LOG_BACKUP, 'utf8') : '';
  const missing = missingLogRows(readFileSync(join(SKILL_DIR, 'log.md'), 'utf8'), backup);
  console.log(missing.length ? missing.join('\n') : 'log.md has every logged row');
  return missing.length ? EXIT.failed : EXIT.ok;
}

const COMMANDS = {
  snapshot: [
    snapshot,
    "session start: snapshot ~/.bdg and ~/Downloads (gate 8); --accept <name>… adds a user's own ~/Downloads or ~/.bdg file to the snapshot; --accept-live accepts all files of the user's live session in ~/.bdg, and its session files written later",
  ],
  'suite-times': [suiteTimesCommand, '<run id> [<other run id>] [--job=<regex>] [--top=15]: slowest smoke suites from CI logs, or two runs side by side'],
  simplify: [simplify, "<pr> [--finish]: the PR's worktree, base, diff file and /simplify args; --finish formats and type-checks the edits"],
  fixtures: [
    fixtures,
    '<N> [dir=<worktree>] | <N> --stop: the fixture servers for a tester, from ../bdg-<N>; ship merge stops them',
  ],
  worktree: [worktree, '<N> <branch>: agent worktree from origin/main, node_modules linked'],
  brief: [
    brief,
    '<role> N=<issue> [PR=<pr>] KEY=value… [--out=<file>]: render a brief (quotes the issue; PR fills BASE/HEAD/RED/BRANCH); --check=<file>: refuse an empty or unfilled brief',
  ],
  'ci-wait': [ciWait, '<pr> [--head=<sha>] | <sha> --push: wait for CI (+ Security); --head waits for that pushed commit; exit 3 when superseded'],
  repeat: [repeat, '<pr> <smoke files…> [--node=22|24|26] [--replace] [--timeout=10]: dispatch the repeat=10 run on the PR head; --replace cancels a running one first'],
  'run-wait': [
    runWait,
    '<run id> [--timeout=<min>]: wait for a dispatched run, print its jobs; exit 4 on timeout',
  ],
  'merge-check': [mergeCheck, '<pr> [test files…]: gate 6 on current main, in a temp worktree'],
  gates: [gates, '<pr> --tier=N [--macos] [--timing] [--repeat=<id>] [--no-issue] [--fixes-main]: mechanical gates'],
  merge: [merge, '<pr> --tier=N [gate flags]: gates, merge on that head, clean up'],
  leftovers: [leftovers, '[--clean]: gate 8; --clean drops PID files of dead processes'],
  log: [
    log,
    '<pr> tier= review= tester= rounds= model= tokens= note=: append to log.md (and a backup in ~/.cache/ship); --pending: backup rows log.md lacks',
  ],
};

/**
 * Prints a usage line and returns the usage exit code.
 *
 * @param {string} line
 */
function usage(line) {
  console.error(`usage: ship ${line}`);
  return EXIT.usage;
}

/** Prints every command with its one-line description */
function help() {
  for (const [name, [, text]] of Object.entries(COMMANDS))
    console.log(`${name.padEnd(13)} ${text}`);
  return EXIT.ok;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [name, ...rest] = process.argv.slice(2);
  const entry = COMMANDS[name];
  try {
    if (entry) process.exitCode = await entry[0](rest);
    else if (!name || name === 'help') process.exitCode = help();
    else process.exitCode = usage(`<command>: unknown "${name}"; see ship help`);
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = EXIT.failed;
  }
}
