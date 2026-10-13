#!/usr/bin/env node
/**
 * The mechanical half of the ship skill: worktrees, CI waits, merge-checks,
 * gates, merges, leftovers, brief rendering and the PR log. The orchestrator
 * judges; this script does what must be done the same way every time.
 *
 * Run `node .claude/skills/ship/scripts/ship.mjs help` for the commands.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
};

/** Exit codes of this script, so the orchestrator can branch on them */
export const EXIT = { ok: 0, failed: 1, usage: 2, superseded: 3, timeout: 4 };

const CALL_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 180_000;
let waiterDeadline = null;

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
  let timeout = timeoutMs;
  if (deadline && timeout) timeout = Math.min(timeout, Math.max(deadline - Date.now(), 1));
  else if (deadline) timeout = Math.max(deadline - Date.now(), 1);
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
 * @param {{ backoff?: number[], wait?: (ms: number) => void, deadline?: number | null }} [opts]
 */
export function retryTransient(fn, opts = {}) {
  const backoff = opts.backoff ?? RETRY_BACKOFF_MS;
  const wait =
    opts.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const deadline = opts.deadline ?? waiterDeadline;
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= backoff.length || !isTransientGhError(err)) throw err;
      if (deadline && Date.now() >= deadline) throw err;
      const firstLine = String(err.stderr || err.message)
        .trim()
        .split('\n')[0];
      console.error(
        `gh failed (${firstLine}); retry ${attempt + 1}/${backoff.length} in ${backoff[attempt] / 1000}s`
      );
      wait(backoff[attempt]);
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
    'number,title,headRefName,headRefOid,baseRefName,mergeable,state,isDraft,files,mergeCommit',
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
    'databaseId,status,conclusion',
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
 * rethrown after the last retry) ends the wait as `timeout`, exit 4. A
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
  try {
    return await wait();
  } catch (err) {
    if (Date.now() < deadline) throw err;
    console.log(`timeout: ${err.stderr || err.message}`);
    return EXIT.timeout;
  } finally {
    waiterDeadline = null;
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
async function ciWaitLoop(argv) {
  const { positional, flags } = parseArgs(argv);
  const target = positional[0];
  if (!target) return usage('ci-wait <pr> | ci-wait <sha> --push');
  const deadline = waiterDeadline;
  const push = flags.has('push');
  let pr = null;
  let sha = target;
  let workflows = ['CI', 'Security'];
  if (!push) {
    pr = prInfo(target);
    sha = pr.headRefOid;
    if (pr.baseRefName !== 'main') workflows = ['CI'];
  }
  const event = push ? 'push' : 'pull_request';
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
    if (workflows.every((wf) => runs[wf]?.status === 'completed')) {
      const { code, summary } = judgeConclusions(
        Object.fromEntries(workflows.map((wf) => [wf, runs[wf].conclusion])),
        { push }
      );
      if (code !== EXIT.ok && pr && prInfo(pr.number).headRefOid !== sha) {
        console.log(`${summary}; superseded: PR #${pr.number} head moved while waiting`);
        return EXIT.superseded;
      }
      console.log(summary);
      return code;
    }
    if (pr && !runs.CI && Date.now() > noRunDeadline) {
      console.log(
        `no pull_request CI run 3 minutes after the push: close and reopen PR #${pr.number} (not a dispatch: CI OK must come from a pull_request run)`
      );
      return EXIT.timeout;
    }
    if (Date.now() > deadline) {
      console.log(
        `timeout: ${workflows.map((wf) => `${wf} ${runs[wf]?.status ?? 'not started'}`).join(', ')}`
      );
      return EXIT.timeout;
    }
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
  for (;;) {
    const r = ghJson(['run', 'view', id, '--json', 'status,conclusion,headSha,jobs']);
    if (r.status === 'completed') {
      for (const j of r.jobs) console.log(`${j.conclusion.padEnd(9)} ${j.name}`);
      console.log(`run ${id} on ${r.headSha.slice(0, 10)}: ${r.conclusion}`);
      return r.conclusion === 'success' ? EXIT.ok : EXIT.failed;
    }
    if (Date.now() > deadline) {
      console.log(`timeout: run ${id} ${r.status}`);
      return EXIT.timeout;
    }
    await sleep(POLL_MS);
  }
}

/**
 * Dispatches the CI repeat run for smoke files on a PR's branch and prints its id.
 *
 * @param {string[]} argv `<pr> <smoke files...>`, optional `repeat=10 node=22`
 */
async function repeat(argv) {
  const { positional, keys } = parseArgs(argv);
  const [prNumber, ...files] = positional;
  if (!prNumber || files.length === 0)
    return usage('repeat <pr> <smoke files...> [repeat=10] [node=22]');
  const pr = prInfo(prNumber);
  const dispatchRuns = () =>
    ghJson([
      'run',
      'list',
      '--branch',
      pr.headRefName,
      '--event',
      'workflow_dispatch',
      '--json',
      'databaseId,headSha',
      '--limit',
      '20',
    ]) ?? [];
  const before = new Set(dispatchRuns().map((r) => r.databaseId));
  run(
    'gh',
    [
      'workflow',
      'run',
      'ci.yml',
      '--repo',
      REPO,
      '--ref',
      pr.headRefName,
      '-f',
      `smoke_files=${files.join(' ')}`,
      '-f',
      `repeat=${keys.repeat ?? 10}`,
      '-f',
      `node=${keys.node ?? 22}`,
    ],
    { timeoutMs: WRITE_TIMEOUT_MS }
  );
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
  run('git', ['fetch', '-q', 'origin']);
  run('git', ['worktree', 'add', '-q', path, '-b', branch, keys.base ?? 'origin/main']);
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
  run('git', ['fetch', '-q', 'origin']);
  const main = run('git', ['rev-parse', `origin/${pr.baseRefName}`]);
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
    gateLine(
      results,
      job(/^CI OK$/)?.conclusion === 'success',
      `5 required check CI OK: ${job(/^CI OK$/)?.conclusion ?? 'missing'}`
    );
    if (macos)
      gateLine(
        results,
        job(/macOS/)?.conclusion === 'success',
        `5 macOS smoke: ${job(/macOS/)?.conclusion ?? 'missing'}`
      );
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
 */
function mainGate(results) {
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
      'status,conclusion,headSha',
      '--limit',
      '10',
    ]) ?? [];
  const decided = runs.find((r) => r.status === 'completed' && r.conclusion !== 'cancelled');
  const pending = runs.find((r) => r.status !== 'completed');
  const note = pending
    ? ` (a run on ${pending.headSha.slice(0, 10)} is in progress: wait for it if that merge touched this PR's files)`
    : '';
  gateLine(
    results,
    decided?.conclusion === 'success',
    `5 main is green: ${decided ? `${decided.conclusion} on ${decided.headSha.slice(0, 10)}` : 'no completed run'}${note}`
  );
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
  const want = `${run('git', ['rev-parse', baseRef])} ${pr.headRefOid}`;
  const done = existsSync(marker) && readFileSync(marker, 'utf8').trim() === want;
  const files = `${overlap.slice(0, 4).join(', ')}${overlap.length > 4 ? ', …' : ''}`;
  gateLine(
    results,
    done,
    `6 ${baseRef} changed ${overlap.length} of the PR's files (${files}): ${done ? 'merge-check passed on this base and head' : 'run ship merge-check, or have the implementer rebase'}`
  );
}

/**
 * Checks the mechanical gates on the PR's current head and prints one line
 * per gate; the judgment gates are printed as reminders. `--tier` is
 * required, so a tier-1 PR isn't held to the red-commit rule by default.
 *
 * @param {string[]} argv `<pr> --tier=1|2|3`, optional `--macos`, `--repeat=<run id>` (or `--timing` to demand one)
 */
async function gates(argv) {
  const { positional, keys, flags } = parseArgs(argv);
  const tier = Number(keys.tier);
  if (!positional[0] || ![1, 2, 3].includes(tier))
    return usage('gates <pr> --tier=1|2|3 [--macos] [--timing] [--repeat=<run id>]');
  const pr = prInfo(positional[0]);
  const head = pr.headRefOid;
  const results = [];
  console.log(`gates for PR #${pr.number} at ${head.slice(0, 10)} (tier ${tier})`);
  run('git', ['fetch', '-q', 'origin']);
  const baseRef = `origin/${pr.baseRefName}`;
  const forkPoint = run('git', ['merge-base', baseRef, head]);
  const prFiles = run('git', ['diff', '--name-only', forkPoint, head]).split('\n').filter(Boolean);

  if (tier > 1) {
    const first =
      run('git', ['log', '--reverse', '--format=%s', `${forkPoint}..${head}`]).split('\n')[0] ?? '';
    gateLine(results, /^test: /.test(first), `3 first commit is the red commit: "${first}"`);
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
  mainGate(results);
  await freshBaseGate(results, pr, baseRef, forkPoint, prFiles);
  gateLine(results, !prFiles.includes('CHANGELOG.md'), '7 CHANGELOG.md untouched');
  const scope = [String(pr.number), ...(prIssues(pr.number) ?? [])];
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
 * Numbers of the issues a PR closes, as strings.
 *
 * @param {number} prNumber
 */
function prIssues(prNumber) {
  const pr = ghJson(['pr', 'view', String(prNumber), '--json', 'closingIssuesReferences']);
  return pr?.closingIssuesReferences.map((i) => String(i.number));
}

/**
 * Snapshots ~/.bdg and ~/Downloads at session start, for gate 8.
 */
function snapshot() {
  writeFileSync(SNAPSHOT.bdg, listDir(join(homedir(), '.bdg')).join('\n'));
  writeFileSync(SNAPSHOT.downloads, listDir(join(homedir(), 'Downloads')).join('\n'));
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
 * given issue or PR numbers (`/tmp/bdg-impl-611-fixtures.pid`, `/tmp/review-611`).
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
 * What was left behind: new entries in ~/.bdg and ~/Downloads since the
 * snapshot (a missing snapshot counts as a leftover, so it can't pass
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
    const before = new Set(readFileSync(SNAPSHOT[key], 'utf8').split('\n'));
    const added = listDir(join(homedir(), dir)).filter((e) => !before.has(e));
    if (added.length) lines.push(`new in ~/${dir}: ${added.join(', ')}`);
  }
  for (const file of readdirSync('/tmp').filter((f) => /^bdg-.*\.pid$/.test(f))) {
    if (scope && !inScope(file, scope)) continue;
    const pid = Number(readFileSync(join('/tmp', file), 'utf8').trim());
    if (pid && alive(pid)) lines.push(`live PID ${pid} from /tmp/${file}`);
  }
  const temp = tempWorktrees(run('git', ['worktree', 'list', '--porcelain'])).filter(
    (p) => !scope || inScope(p, scope)
  );
  if (temp.length) lines.push(`temporary worktrees: ${temp.join(', ')}`);
  return lines;
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
      const pid = Number(readFileSync(join('/tmp', file), 'utf8').trim());
      if (!pid || !alive(pid)) rmSync(join('/tmp', file));
    }
  }
  const lines = leftoverLines();
  console.log(lines.length ? lines.join('\n') : 'no leftovers');
  return lines.length ? EXIT.failed : EXIT.ok;
}

/**
 * Merges a PR whose gates hold, on the exact head they were checked on, then
 * removes its worktree and branch when the worktree has nothing uncommitted.
 *
 * @param {string[]} argv `<pr>` plus the gates options
 */
async function merge(argv) {
  const prNumber = argv[0];
  if (!prNumber) return usage('merge <pr> --tier=1|2|3 [--macos] [--timing] [--repeat=<run id>]');
  const pr = prInfo(prNumber);
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
  run('git', ['fetch', '-q', 'origin']);
  const merged = spawnSync('git', ['merge-base', '--is-ancestor', branch, 'origin/main']);
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
  for (const [key, value] of Object.entries(values)) brief = brief.split(`<${key}>`).join(value);
  const unfilled = [...new Set(brief.match(/<[^<>\n]{2,80}>/g) ?? [])].filter(
    (p) => !LITERAL_PLACEHOLDERS.has(p)
  );
  const unknown = [...new Set(brief.match(/\{\{[\w-]+\}\}/g) ?? [])];
  if (unknown.length) throw new Error(`unknown blocks: ${unknown.join(', ')}`);
  return { brief, unfilled };
}

/**
 * Prints a rendered brief; the placeholders still to fill go to stderr.
 *
 * @param {string[]} argv `<role> KEY=value...`
 */
function brief(argv) {
  const { positional, keys } = parseArgs(argv);
  if (!positional[0])
    return usage('brief <implementer|reviewer|tester|verifier> N=<n> MAIN=<path> ...');
  const values = { MAIN: mainCheckout(), ROLE: ROLE_TAGS[positional[0]] ?? positional[0], ...keys };
  const { brief: text, unfilled } = renderBrief(
    readFileSync(join(SKILL_DIR, 'briefs.md'), 'utf8'),
    positional[0],
    values
  );
  console.log(text);
  if (unfilled.length) console.error(`still to fill: ${unfilled.join(' ')}`);
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
  const { positional, keys } = parseArgs(argv);
  if (!positional[0])
    return usage(
      'log <pr> tier=2 review=0/1/2 tester=1 rounds=1 model=sonnet tokens=240k note="…"'
    );
  const pr = ghJson([
    'pr',
    'view',
    positional[0],
    '--json',
    'number,closingIssuesReferences,mergedAt',
  ]);
  const issues = pr.closingIssuesReferences.map((i) => `#${i.number}`).join(' ') || '-';
  const cell = (k) => (keys[k] ?? '-').replace(/\|/g, '/');
  const row = `| ${(pr.mergedAt ?? new Date().toISOString()).slice(0, 10)} | #${pr.number} | ${issues} | ${cell('tier')} | ${cell('review')} | ${cell('tester')} | ${cell('rounds')} | ${cell('model')} | ${cell('tokens')} | ${cell('note')} |`;
  const file = join(SKILL_DIR, 'log.md');
  writeFileSync(file, insertLogRow(readFileSync(file, 'utf8'), row));
  console.log(row);
  return EXIT.ok;
}

const COMMANDS = {
  snapshot: [snapshot, 'session start: snapshot ~/.bdg and ~/Downloads (gate 8)'],
  worktree: [worktree, '<N> <branch>: agent worktree from origin/main, node_modules linked'],
  brief: [brief, '<role> N=<n> KEY=value…: render a brief with the shared blocks'],
  'ci-wait': [ciWait, '<pr> | <sha> --push: wait for CI (+ Security); exit 3 when superseded'],
  repeat: [repeat, '<pr> <smoke files…>: dispatch the repeat=10 run on the PR head'],
  'run-wait': [
    runWait,
    '<run id> [--timeout=<min>]: wait for a dispatched run, print its jobs; exit 4 on timeout',
  ],
  'merge-check': [mergeCheck, '<pr> [test files…]: gate 6 on current main, in a temp worktree'],
  gates: [gates, '<pr> --tier=N [--macos] [--timing] [--repeat=<id>]: mechanical gates'],
  merge: [merge, '<pr> --tier=N [gate flags]: gates, merge on that head, clean up'],
  leftovers: [leftovers, '[--clean]: gate 8; --clean drops PID files of dead processes'],
  log: [log, '<pr> tier= review= tester= rounds= model= tokens= note=: append to log.md'],
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
