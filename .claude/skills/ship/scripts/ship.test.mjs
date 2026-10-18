/**
 * Tests for the pure parts of ship.mjs: argument parsing, CI verdicts, the
 * gate-6 overlap and brief rendering (including the real briefs.md).
 *
 * Run: node --test .claude/skills/ship/scripts/ship.test.mjs (also part of npm test)
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  appendSnapshotEntries,
  briefProblems,
  briefVariant,
  fillOutsideQuotes,
  formatDesign,
  formatIssue,
  isAgentCommand,
  issueNumbers,
  mergeCheckStillValid,
  missingLogRows,
  isFixturesCommand,
  isFormatChecked,
  isSessionFileName,
  templatePlaceholders,
  unfilledPlaceholders,
  unitTestsFor,
  worktreeOrphans,
  socketAccepts,
  callTimeout,
  closedIssues,
  EXIT,
  inScope,
  isProductFile,
  mainCheckoutChanges,
  insertLogRow,
  isTransientGhError,
  jobsLostWithoutResult,
  listEntries,
  mainGateVerdict,
  MIN_CALL_BUDGET_MS,
  noRunMessage,
  repeatDispatch,
  resolveSha,
  statusLine,
  timeoutMessage,
  unfinishedRepeat,
  judgeConclusions,
  overlappingFiles,
  parseArgs,
  parseBriefs,
  parseSnapshot,
  pidReused,
  partOfIssues,
  parseSnapshotArgs,
  productLines,
  proxyNote,
  releaseVersion,
  renderBrief,
  simplifyVerdict,
  SIMPLIFY_THRESHOLD,
  snapshotChanges,
  staleDependencies,
  snapshotLines,
  strayClosingCommits,
  suiteTimes,
  retryTransient,
  run,
  withWaiterDeadline,
  writeWithRecheck,
  tempWorktrees,
  worktreeOfBranch,
} from './ship.mjs';

const BRIEFS = readFileSync(join(import.meta.dirname, '..', 'briefs.md'), 'utf8');

test('parseArgs splits positional, key=value and flags', () => {
  const { positional, keys, flags } = parseArgs([
    '675',
    'tier=3',
    '--macos',
    '--repeat=123',
    'note=a=b',
  ]);
  assert.deepEqual(positional, ['675']);
  assert.deepEqual(keys, { tier: '3', repeat: '123', note: 'a=b' });
  assert.deepEqual([...flags], ['macos']);
});

test('parseArgs keeps file paths positional', () => {
  assert.deepEqual(parseArgs(['src/a.smoke.test.ts', './b.ts']).positional, [
    'src/a.smoke.test.ts',
    './b.ts',
  ]);
});

test('judgeConclusions: all success is ok', () => {
  assert.equal(judgeConclusions({ CI: 'success', Security: 'success' }).code, EXIT.ok);
});

test('judgeConclusions: a cancelled run on main is superseded by a later push', () => {
  const { code, summary } = judgeConclusions(
    { CI: 'cancelled', Security: 'success' },
    { push: true }
  );
  assert.equal(code, EXIT.superseded);
  assert.match(summary, /superseded/);
});

test('judgeConclusions: a cancelled run on a PR whose head did not move fails', () => {
  assert.equal(judgeConclusions({ CI: 'cancelled', Security: 'success' }).code, EXIT.failed);
});

test('judgeConclusions: a failure wins over a cancelled run', () => {
  assert.equal(
    judgeConclusions({ CI: 'cancelled', Security: 'failure' }, { push: true }).code,
    EXIT.failed
  );
});

test('judgeConclusions: a failure fails', () => {
  assert.equal(judgeConclusions({ CI: 'failure', Security: 'success' }).code, EXIT.failed);
});

test('overlappingFiles keeps only files both sides changed', () => {
  assert.deepEqual(overlappingFiles(['a', 'b', 'b', 'c'], ['b', 'c', 'd']), ['b', 'c']);
  assert.deepEqual(overlappingFiles([], ['x']), []);
});

test('renderBrief inserts blocks and fills placeholders', () => {
  const text = [
    '<!-- block:env -->',
    'export X=/tmp/bt-<N>',
    '<!-- /block -->',
    '<!-- block:rules -->',
    'rules for <N>; {{env}}',
    '<!-- /block -->',
    '<!-- brief:demo -->',
    'Issue <N> in <MAIN>.',
    '{{rules}}',
    'Scope: <what to do>',
    '<!-- /brief -->',
  ].join('\n');
  const { brief, unfilled } = renderBrief(text, 'demo', { N: '42', MAIN: '/repo' });
  assert.equal(brief, 'Issue 42 in /repo.\nrules for 42; export X=/tmp/bt-42\nScope: <what to do>');
  assert.deepEqual(unfilled, ['<what to do>']);
});

test('renderBrief rejects an unknown role and an unknown block', () => {
  assert.throws(() => renderBrief('<!-- brief:a -->\nx\n<!-- /brief -->', 'b', {}), /no brief "b"/);
  assert.throws(
    () => renderBrief('<!-- brief:a -->\n{{nope}}\n<!-- /brief -->', 'a', {}),
    /unknown blocks/
  );
});

test('briefs.md has the five briefs and every block they use', () => {
  const { briefs } = parseBriefs(BRIEFS);
  assert.deepEqual(Object.keys(briefs).sort(), ['design', 'implementer', 'reviewer', 'tester', 'verifier']);
  for (const role of Object.keys(briefs)) {
    assert.doesNotThrow(() => renderBrief(BRIEFS, role, { N: '1', MAIN: '/m', SHA: 'abc' }), role);
  }
});

test('the reviewer brief checks the red commit on the pinned head, not the worktree HEAD', () => {
  const { brief } = renderBrief(BRIEFS, 'reviewer', { N: '7', MAIN: '/m' });
  assert.doesNotMatch(brief, /\.\.HEAD/);
  assert.match(brief, /<BASE>\.\.<HEAD>/);
});

test('every brief states a tool-call cap', () => {
  for (const role of ['implementer', 'reviewer', 'tester', 'verifier']) {
    assert.match(renderBrief(BRIEFS, role, {}).brief, /At most \S+ tool calls/, role);
  }
});

test('parseArgs keeps everything after the first = of a --key', () => {
  assert.deepEqual(parseArgs(['--note=a=b']).keys, { note: 'a=b' });
});

const PORCELAIN = [
  'worktree /repo',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree /dev/bdg-abc',
  'HEAD bbb',
  'branch refs/heads/fix/abc',
  '',
  'worktree /dev/bdg-a',
  'HEAD ccc',
  'branch refs/heads/fix/a',
  '',
  'worktree /private/tmp/review-611',
  'HEAD ddd',
  'detached',
  '',
  'worktree /private/tmp/mc-6110',
  'HEAD eee',
  'detached',
].join('\n');

test('worktreeOfBranch matches the whole branch name, not a prefix', () => {
  assert.equal(worktreeOfBranch(PORCELAIN, 'fix/a'), '/dev/bdg-a');
  assert.equal(worktreeOfBranch(PORCELAIN, 'fix/abc'), '/dev/bdg-abc');
  assert.equal(worktreeOfBranch(PORCELAIN, 'fix/ab'), null);
});

test("tempWorktrees finds the ship steps' worktrees under /tmp and /private/tmp", () => {
  assert.deepEqual(tempWorktrees(PORCELAIN), ['/private/tmp/review-611', '/private/tmp/mc-6110']);
});

test('inScope matches a number as a whole token only', () => {
  assert.equal(inScope('bdg-impl-611-fixtures.pid', ['611']), true);
  assert.equal(inScope('bdg-fixtures-611.pid', ['611']), true);
  assert.equal(inScope('/private/tmp/review-611', ['611']), true);
  assert.equal(inScope('/private/tmp/mc-6110', ['611']), false);
  assert.equal(inScope('bdg-impl-6110-fixtures.pid', ['611']), false);
  assert.equal(inScope('bdg-t-612-a-http.pid', ['611', '673']), false);
});

test('isTransientGhError spots network and 5xx failures, not 404 or auth', () => {
  for (const m of [
    'Post "https://api.github.com/graphql": unexpected EOF',
    'read: connection reset by peer',
    'net/http: TLS handshake timeout',
    'HTTP 502: Bad Gateway',
    'HTTP 503',
  ])
    assert.equal(isTransientGhError({ stderr: m }), true, m);
  for (const m of ['HTTP 404: Not Found', 'HTTP 401: Bad credentials', 'unknown flag: --bogus'])
    assert.equal(isTransientGhError({ message: 'Command failed', stderr: m }), false, m);
});

test('isTransientGhError ignores numbers in the command line', () => {
  const pr502 = {
    message: 'Command failed: gh pr view 502 --repo x',
    stderr: 'HTTP 404: Not Found',
  };
  const limit = { message: 'Command failed: gh run list --limit 500', stderr: 'unknown flag' };
  assert.equal(isTransientGhError(pr502), false);
  assert.equal(isTransientGhError(limit), false);
});

test('retry covers reads only: run() has no retry, ghJson and the resolveSha gh read wrap it', () => {
  const src = readFileSync(join(import.meta.dirname, 'ship.mjs'), 'utf8');
  const runFn = src.slice(src.indexOf('function run('), src.indexOf('/** Smallest remaining waiter budget'));
  assert.ok(!runFn.includes('retryTransient'));
  assert.equal(src.match(/retryTransient\(\(\) =>/g).length, 2);
  assert.ok(/function resolveSha[\s\S]*?retryTransient\(\(\) =>\s*exec\('gh'/.test(src));
  assert.ok(/function ghJson[\s\S]*?retryTransient\(\(\) => run\('gh'/.test(src));
});

test('insertLogRow adds to the main table, before a non-empty or empty Escaped section', () => {
  const main = '| merged | PR |\n|---|---|\n| a | #1 |';
  for (const escaped of ['| found | PR |\n|---|---|\n| b | #2 |\n', '']) {
    const text = `# Log\n\n${main}\n\n## Escaped\n\n${escaped}`;
    const out = insertLogRow(text, '| c | #3 |');
    assert.equal(out, text.replace(`${main}\n`, `${main}\n| c | #3 |\n`));
  }
  assert.equal(insertLogRow(`${main}\n`, '| c | #3 |'), `${main}\n| c | #3 |\n`);
  assert.throws(() => insertLogRow('# nothing', 'x'), /no PR table/);
});

test('retryTransient retries a transient failure, then returns', () => {
  const waits = [];
  let calls = 0;
  const out = retryTransient(
    () => {
      if (++calls < 3)
        throw Object.assign(new Error('Command failed'), { stderr: 'unexpected EOF' });
      return 'ok';
    },
    { backoff: [1, 2, 3], wait: (ms) => waits.push(ms) }
  );
  assert.equal(out, 'ok');
  assert.deepEqual(waits, [1, 2]);
});

test('retryTransient gives up after the bounded retries', () => {
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 503' });
        },
        { backoff: [1, 1], wait: () => {} }
      ),
    { stderr: /503/ }
  );
  assert.equal(calls, 3);
});

test('retryTransient fails at once on a non-transient error', () => {
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 404: Not Found' });
        },
        { backoff: [1, 1], wait: () => {} }
      ),
    { stderr: /404/ }
  );
  assert.equal(calls, 1);
});

test('run kills a command that outlives its timeout and names command and timeout', () => {
  const started = Date.now();
  assert.throws(() => run('sleep', ['5'], { timeoutMs: 200 }), {
    timedOut: true,
    message: /sleep 5.*timed out after 0\.2s/,
  });
  assert.ok(Date.now() - started < 3000);
});

test('a timed-out call is transient: retried with backoff, then reported', () => {
  const waits = [];
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          return run('sleep', ['5'], { timeoutMs: 100 });
        },
        { backoff: [1, 2], wait: (ms) => waits.push(ms) }
      ),
    { timedOut: true, message: /sleep 5.*timed out after 0\.1s/ }
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1, 2]);
});

test('a waiter deadline ends the retries once the clock passes it', () => {
  let t = 1000;
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          t = 1500;
          throw Object.assign(new Error('timed out'), { timedOut: true });
        },
        { backoff: [1, 1], wait: () => {}, deadline: 1200, now: () => t }
      ),
    { timedOut: true }
  );
  assert.equal(calls, 1);
});

test('callTimeout caps a call at the remaining waiter budget', () => {
  assert.equal(callTimeout(60_000, 100_000, 40_000), 60_000);
  assert.equal(callTimeout(60_000, 50_000, 40_000), 10_000);
  assert.equal(callTimeout(0, 50_000, 40_000), 10_000);
  assert.equal(callTimeout(5000, null, 40_000), 5000);
});

test('callTimeout refuses to start a call with less than the minimum budget left', () => {
  assert.equal(MIN_CALL_BUDGET_MS, 2000);
  assert.throws(() => callTimeout(60_000, 41_999, 40_000), { budgetExhausted: true });
  assert.equal(callTimeout(60_000, 42_000, 40_000), 2000);
});

test('run does not start a command when the waiter budget is nearly spent', () => {
  assert.throws(() => run('sleep', ['5'], { deadline: Date.now() + 500 }), {
    budgetExhausted: true,
    timedOut: true,
  });
});

test('a call refused for lack of budget is not retried', () => {
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          throw Object.assign(new Error('no budget'), { timedOut: true, budgetExhausted: true });
        },
        { backoff: [1, 1], wait: () => assert.fail('waited') }
      ),
    { budgetExhausted: true }
  );
  assert.equal(calls, 1);
});

test('resolveSha expands a short SHA with git rev-parse and leaves a full one alone', () => {
  const full = 'a'.repeat(40);
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    return full;
  };
  assert.equal(resolveSha('aaaaaaaaaa', exec), full);
  assert.equal(calls[0][0], 'git');
  assert.ok(calls[0].includes('rev-parse'));
  assert.ok(calls[0].join(' ').includes('aaaaaaaaaa'));
  calls.length = 0;
  assert.equal(resolveSha(full, exec), full);
  assert.equal(calls.length, 0);
});

test('resolveSha asks GitHub when git does not know the commit, and fails when nobody does', () => {
  const full = 'b'.repeat(40);
  const viaGh = (cmd) => {
    if (cmd === 'git') throw new Error('unknown revision');
    return full;
  };
  assert.equal(resolveSha('bbbbbbb', viaGh), full);
  assert.throws(
    () =>
      resolveSha('bbbbbbb', () => {
        throw new Error('nope');
      }),
    /bbbbbbb/
  );
});

test('timeoutMessage: no run seen names the SHA and the minutes', () => {
  const state = { subject: 'abcdef1234', minutes: 60, failures: 0, last: '', seen: {} };
  assert.match(timeoutMessage(state, false), /no CI run found for abcdef1234 after 60 min/);
});

test('timeoutMessage: gh failures are reported with the last error, not a timeout of the call', () => {
  const state = {
    subject: 'abcdef1234',
    minutes: 60,
    failures: 3,
    last: 'unexpected EOF',
    seen: {},
  };
  assert.match(timeoutMessage(state, true), /gh failed 3 times: unexpected EOF/);
  assert.match(timeoutMessage(state, false), /gh failed 3 times: unexpected EOF/);
});

test('timeoutMessage: runs seen but unfinished list their status', () => {
  const state = {
    subject: 'abcdef1234',
    minutes: 45,
    failures: 1,
    last: 'x',
    seen: { CI: 'in_progress', Security: 'queued' },
  };
  assert.equal(
    timeoutMessage(state, false),
    'CI still in_progress, Security still queued after 45 min'
  );
});

test('a budget error before the deadline ends the waiter with the gh failure count', async () => {
  const lines = [];
  const log = console.log;
  console.log = (l) => lines.push(l);
  try {
    const code = await withWaiterDeadline(10, async () => {
      assert.throws(() =>
        retryTransient(
          () => {
            throw Object.assign(new Error('Command failed'), { stderr: 'unexpected EOF' });
          },
          { backoff: [1], wait: () => {} }
        )
      );
      throw Object.assign(new Error('no budget'), { timedOut: true, budgetExhausted: true });
    });
    assert.equal(code, EXIT.timeout);
    assert.match(lines[0], /gh failed 2 times: unexpected EOF/);
  } finally {
    console.log = log;
  }
});

test('noRunMessage names a conflicting PR instead of advising close and reopen', () => {
  assert.equal(
    noRunMessage(720, 'CONFLICTING'),
    'PR #720 conflicts with its base: GitHub runs no pull_request CI; rebase'
  );
  assert.match(noRunMessage(720, 'MERGEABLE'), /close and reopen PR #720/);
});

test('statusLine prints the elapsed whole minutes of a started job', () => {
  const now = Date.parse('2026-10-14T12:30:00Z');
  assert.equal(
    statusLine('Smoke Tests (macOS)', 'in_progress', '2026-10-14T12:07:00Z', now),
    'Smoke Tests (macOS) in_progress 23 min'
  );
  assert.equal(statusLine('CI', 'queued', null, now), 'CI queued');
});

test('statusLine prints no elapsed time for a zero, unparsable or missing start and clamps the future', () => {
  const now = Date.parse('2026-10-14T12:30:00Z');
  for (const bad of ['0001-01-01T00:00:00Z', 'not a date', '', undefined])
    assert.equal(statusLine('x', 'queued', bad, now), 'x queued', String(bad));
  assert.equal(statusLine('x', 'queued', '2026-10-14T12:40:00Z', now), 'x queued 0 min');
});

test('resolveSha refuses a SHA that starts with a dash before running git', () => {
  const exec = () => assert.fail('no command may run');
  assert.throws(() => resolveSha('--output=/tmp/x', exec), /cannot start with "-"/);
  assert.throws(() => resolveSha('-abc1234', exec), /cannot start with "-"/);
});

test('resolveSha retries a transient gh failure of its fallback read', () => {
  const full = 'e'.repeat(40);
  let ghCalls = 0;
  const exec = (cmd) => {
    if (cmd === 'git') throw new Error('unknown revision');
    if (++ghCalls === 1) throw Object.assign(new Error('gh failed'), { stderr: 'HTTP 502' });
    return full;
  };
  assert.equal(resolveSha('eeeeeee', exec), full);
  assert.equal(ghCalls, 2);
});

test('repeatDispatch passes node and space-separated files as workflow inputs', () => {
  const { args } = repeatDispatch(['a.smoke.test.ts', 'b.smoke.test.ts'], { node: '26' });
  assert.deepEqual(args.slice(-6), [
    '-f',
    'smoke_files=a.smoke.test.ts b.smoke.test.ts',
    '-f',
    'repeat=10',
    '-f',
    'node=26',
  ]);
});

test('repeatDispatch defaults to Node 22 and rejects an unknown Node or brace-expanded files', () => {
  assert.ok(repeatDispatch(['a.ts'], {}).args.includes('node=22'));
  assert.match(repeatDispatch(['a.ts'], { node: '20' }).error, /22, 24 or 26/);
  assert.match(repeatDispatch(['{a,b}.ts'], {}).error, /brace/);
});

test('mainGateVerdict: green main passes, red main fails, as before', () => {
  const green = [{ status: 'completed', conclusion: 'success', headSha: 'a'.repeat(40) }];
  const red = [{ status: 'completed', conclusion: 'failure', headSha: 'b'.repeat(40), databaseId: 9 }];
  assert.equal(mainGateVerdict(green, false).ok, true);
  assert.equal(mainGateVerdict(red, false).ok, false);
});

test('mainGateVerdict --fixes-main skips only a red main and names the run', () => {
  const red = [{ status: 'completed', conclusion: 'failure', headSha: 'b'.repeat(40), databaseId: 9 }];
  const verdict = mainGateVerdict(red, true);
  assert.equal(verdict.ok, true);
  assert.match(verdict.text, /skipped: this PR fixes main, run 9/);
});

test('mainGateVerdict --fixes-main is refused when main is green or has no completed run', () => {
  const green = [{ status: 'completed', conclusion: 'success', headSha: 'a'.repeat(40), databaseId: 8 }];
  assert.equal(mainGateVerdict(green, true).ok, false);
  assert.match(mainGateVerdict(green, true).text, /main is green/);
  assert.equal(mainGateVerdict([], true).ok, false);
});

test('a waiter ends as timeout (exit 4) on any error at the deadline, and resets the deadline', async () => {
  const lines = [];
  const log = console.log;
  console.log = (l) => lines.push(l);
  try {
    const code = await withWaiterDeadline(0.0005, async () => {
      await new Promise((r) => setTimeout(r, 100));
      throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 502' });
    });
    assert.equal(code, EXIT.timeout);
    assert.match(lines[0], /^timeout: .*502/);
    assert.equal(run('sleep', ['0.3']), '');
    await assert.rejects(
      withWaiterDeadline(10, async () => {
        throw new Error('boom');
      }),
      /boom/
    );
  } finally {
    console.log = log;
  }
});

test('writeWithRecheck: a timed-out write that took effect succeeds, otherwise state is unknown', () => {
  const timedOut = () => {
    throw Object.assign(new Error('`gh pr merge 1` timed out after 180s'), { timedOut: true });
  };
  assert.equal(
    writeWithRecheck(timedOut, () => true, 'merge'),
    null
  );
  assert.throws(() => writeWithRecheck(timedOut, () => false, 'merge of PR #1'), {
    message: /timed out after 180s; merge of PR #1 state unknown, check gh pr view/,
  });
  assert.throws(
    () =>
      writeWithRecheck(
        () => {
          throw new Error('denied');
        },
        () => true,
        'merge'
      ),
    /denied/
  );
});

test('a waiter timeout that is not a positive number is a usage error, not an instant timeout', async () => {
  const err = console.error;
  console.error = () => {};
  try {
    for (const bad of ['abc', '0', '-5', '']) {
      let ran = false;
      const code = await withWaiterDeadline(bad, async () => {
        ran = true;
        return EXIT.ok;
      });
      assert.equal(code, EXIT.usage, bad);
      assert.equal(ran, false);
    }
  } finally {
    console.error = err;
  }
});

test('appendSnapshotEntries separates names when the snapshot has no trailing newline', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ship-snap-')), 'snap.txt');
  writeFileSync(file, 'a.png\nb.png');
  appendSnapshotEntries(file, ['mine.pdf', 'other.txt']);
  assert.equal(readFileSync(file, 'utf8'), 'a.png\nb.png\nmine.pdf\nother.txt\n');
  appendSnapshotEntries(file, ['third']);
  assert.equal(readFileSync(file, 'utf8'), 'a.png\nb.png\nmine.pdf\nother.txt\nthird\n');
});

test('appendSnapshotEntries handles an empty snapshot', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ship-snap-')), 'snap.txt');
  writeFileSync(file, '');
  appendSnapshotEntries(file, ['x']);
  assert.equal(readFileSync(file, 'utf8'), 'x\n');
});

test('parseSnapshotArgs accepts no arguments or a valid --accept call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  writeFileSync(join(dir, 'mine.pdf'), '');
  assert.deepEqual(parseSnapshotArgs([], { downloads: dir }), { accept: null });
  assert.deepEqual(parseSnapshotArgs(['--accept', 'mine.pdf'], { downloads: dir }), {
    accept: [{ key: 'downloads', name: 'mine.pdf' }],
  });
});

test('parseSnapshotArgs routes each name to the directory that has it, both when in both', () => {
  const bdg = mkdtempSync(join(tmpdir(), 'ship-bdg-'));
  const downloads = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  writeFileSync(join(bdg, 'daemon.sock'), '');
  writeFileSync(join(downloads, 'mine.pdf'), '');
  writeFileSync(join(bdg, 'both'), '');
  writeFileSync(join(downloads, 'both'), '');
  assert.deepEqual(parseSnapshotArgs(['--accept', 'daemon.sock', 'mine.pdf', 'both'], { bdg, downloads }), {
    accept: [
      { key: 'bdg', name: 'daemon.sock' },
      { key: 'downloads', name: 'mine.pdf' },
      { key: 'bdg', name: 'both' },
      { key: 'downloads', name: 'both' },
    ],
  });
});

test('parseSnapshotArgs rejects anything else so the snapshot is never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  writeFileSync(join(dir, 'x'), '');
  for (const argv of [['--acept', 'x'], ['x', '--accept'], ['--accept'], ['x']])
    assert.ok('error' in parseSnapshotArgs(argv, { downloads: dir }), argv.join(' '));
});

test('parseSnapshotArgs names a name found in neither directory and refuses newlines', () => {
  const bdg = mkdtempSync(join(tmpdir(), 'ship-bdg-'));
  const downloads = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  assert.match(parseSnapshotArgs(['--accept', 'gone.txt'], { bdg, downloads }).error, /gone\.txt does not exist in .*ship-bdg-.* or .*ship-dl-/);
  writeFileSync(join(bdg, 'a\nb'), '');
  assert.match(parseSnapshotArgs(['--accept', 'a\nb'], { bdg, downloads }).error, /newline/);
});

test('closedIssues reads Closes, Fixes and Resolves in any case, and nothing else', () => {
  assert.deepEqual(closedIssues('Closes #12'), ['12']);
  assert.deepEqual(closedIssues('fixes: #3\nRESOLVED #4 and closes #3'), ['3', '4']);
  assert.deepEqual(closedIssues('Leftovers of #708, see #12'), []);
  assert.deepEqual(closedIssues('Disclosed #5'), []);
  assert.deepEqual(closedIssues(''), []);
  assert.deepEqual(closedIssues(undefined), []);
});

test('closedIssues needs a digit boundary, accepts this repo\'s issue URL, ignores fenced code', () => {
  assert.deepEqual(closedIssues('Closes #12abc'), []);
  assert.deepEqual(closedIssues('Closes #12.'), ['12']);
  assert.deepEqual(closedIssues('Closes https://github.com/szymdzum/browser-debugger-cli/issues/12'), ['12']);
  assert.deepEqual(closedIssues('Closes https://github.com/other/repo/issues/12'), []);
  assert.deepEqual(closedIssues('text\n```\nCloses #7\n```\nFixes #8'), ['8']);
  assert.deepEqual(closedIssues('~~~md\nCloses #7\n~~~'), []);
});

test('parseSnapshotArgs refuses empty, dot and path-like names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  for (const name of ['', '.', '..', '../etc/hosts', 'a/b'])
    assert.match(parseSnapshotArgs(['--accept', name], { downloads: dir }).error, /plain entry/, name);
});

test('resolveSha lets a budget error through unchanged and never applies the waiter budget to git', () => {
  const full = 'c'.repeat(40);
  let gitOpts;
  const exec = (cmd, args, opts) => {
    if (cmd === 'git') {
      gitOpts = opts;
      throw new Error('unknown revision');
    }
    throw Object.assign(new Error('less than 2s left'), { budgetExhausted: true, timedOut: true });
  };
  assert.throws(() => resolveSha('ccccccc', exec), { budgetExhausted: true, message: 'less than 2s left' });
  assert.deepEqual(gitOpts, { deadline: null });
  assert.equal(resolveSha('ccccccc', () => full), full);
});

test('a budget error in resolveSha ends the waiter as a timeout', async () => {
  const lines = [];
  const log = console.log;
  console.log = (l) => lines.push(l);
  try {
    const code = await withWaiterDeadline(10, async () => {
      resolveSha('ddddddd', (cmd) => {
        if (cmd === 'git') throw new Error('unknown revision');
        throw Object.assign(new Error('no budget'), { budgetExhausted: true, timedOut: true });
      });
      return EXIT.ok;
    });
    assert.equal(code, EXIT.timeout);
    assert.match(lines[0], /^timeout: no CI run found for/);
  } finally {
    console.log = log;
  }
});

test('gh failures that recovered are not blamed when the budget later runs out', async () => {
  const lines = [];
  const log = console.log;
  console.log = (l) => lines.push(l);
  try {
    const code = await withWaiterDeadline(10, async () => {
      let n = 0;
      retryTransient(
        () => {
          if (n++ === 0) throw Object.assign(new Error('x'), { stderr: 'unexpected EOF' });
          return 'ok';
        },
        { backoff: [1], wait: () => {} }
      );
      throw Object.assign(new Error('no budget'), { timedOut: true, budgetExhausted: true });
    });
    assert.equal(code, EXIT.timeout);
    assert.match(lines[0], /^timeout: no CI run found/);
    assert.doesNotMatch(lines[0], /gh failed/);
  } finally {
    console.log = log;
  }
});

test('snapshotLines and parseSnapshot round-trip names with their mtime and size', () => {
  const entries = [
    { name: 'daemon.log', mtimeMs: 1760000000123.7, size: 420 },
    { name: 'a b.txt', mtimeMs: 5, size: 0 },
  ];
  const parsed = parseSnapshot(snapshotLines(entries).join('\n'));
  assert.deepEqual(
    [...parsed],
    [
      ['daemon.log', '1760000000123\t420'],
      ['a b.txt', '5\t0'],
    ]
  );
});

test('parseSnapshot reads bare names (old snapshots, --accept) as presence-only, later lines win', () => {
  const parsed = parseSnapshot('old.pdf\ndaemon.log\t10\t20\ndaemon.log\n\n');
  assert.deepEqual(
    [...parsed],
    [
      ['old.pdf', null],
      ['daemon.log', null],
    ]
  );
});

test('snapshotChanges reports new entries and entries written to, not untouched or accepted ones', () => {
  const before = parseSnapshot(
    snapshotLines([
      { name: 'daemon.log', mtimeMs: 100, size: 10 },
      { name: 'session.meta.json', mtimeMs: 100, size: 5 },
      { name: 'grown', mtimeMs: 100, size: 5 },
    ]).join('\n') + '\nmine.sock\n'
  );
  const current = [
    { name: 'daemon.log', mtimeMs: 200, size: 10 },
    { name: 'session.meta.json', mtimeMs: 100.9, size: 5 },
    { name: 'grown', mtimeMs: 100, size: 6 },
    { name: 'mine.sock', mtimeMs: 999, size: 0 },
    { name: 'chrome.pid', mtimeMs: 300, size: 6 },
  ];
  assert.deepEqual(snapshotChanges(before, current), {
    added: ['chrome.pid'],
    changed: ['daemon.log', 'grown'],
  });
});

test('isProductFile counts src/ code, not tests, smoke tests, test utilities or other trees', () => {
  assert.equal(isProductFile('src/commands/dom/click.ts'), true);
  assert.equal(isProductFile('src/commands/__tests__/click.test.ts'), false);
  assert.equal(isProductFile('src/__tests__/smoke/eval.smoke.test.ts'), false);
  assert.equal(isProductFile('src/__testutils__/fixturePages/effects.ts'), false);
  assert.equal(isProductFile('src/utils/url.test.ts'), false);
  assert.equal(isProductFile('docs/CLI_REFERENCE.md'), false);
  assert.equal(isProductFile('.claude/skills/ship/scripts/ship.mjs'), false);
});

test('productLines sums added and deleted product lines from numstat, binary files as 0', () => {
  const numstat = [
    '20\t5\tsrc/a.ts',
    '100\t0\tsrc/__tests__/a.test.ts',
    '-\t-\tsrc/logo.png',
    '7\t3\tdocs/CLI_REFERENCE.md',
    '4\t2\tsrc/{old => new}/b.ts',
  ].join('\n');
  assert.equal(productLines(numstat), 31);
});

test('simplifyVerdict: a small diff needs nothing, a large one a refactor commit or the PR body line', () => {
  assert.equal(simplifyVerdict(SIMPLIFY_THRESHOLD, [], '').ok, true);
  const large = SIMPLIFY_THRESHOLD + 1;
  assert.equal(simplifyVerdict(large, ['test: red', 'fix: green'], 'body').ok, false);
  assert.match(simplifyVerdict(large, ['test: red'], '').text, /no refactor: commit/);
  assert.equal(simplifyVerdict(large, ['test: red', 'fix: green', 'refactor: share helper'], '').ok, true);
  assert.equal(simplifyVerdict(large, ['fix: x', 'refactor(dom): x'], '').ok, true);
  assert.equal(simplifyVerdict(large, ['fix: x'], 'Simplify: Nothing to simplify.').ok, true);
  assert.equal(simplifyVerdict(large, ['fix: refactor: x'], '').ok, false);
});

test('listEntries skips .DS_Store, so Finder never fails gate 8', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-dl-'));
  writeFileSync(join(dir, '.DS_Store'), 'x');
  writeFileSync(join(dir, 'report.pdf'), 'abc');
  assert.deepEqual(
    listEntries(dir).map((e) => [e.name, e.size]),
    [['report.pdf', 3]]
  );
  assert.deepEqual(listEntries(join(dir, 'missing')), []);
});

test('parseSnapshotArgs takes --accept-live alone, and nothing after it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-bdg-'));
  assert.deepEqual(parseSnapshotArgs(['--accept-live'], { bdg: dir }), { acceptLive: true });
  assert.deepEqual(parseSnapshotArgs(['--accept-main'], { bdg: dir }), { acceptMain: true });
  assert.ok('error' in parseSnapshotArgs(['--accept-live', 'x'], { bdg: dir }));
  assert.ok('error' in parseSnapshotArgs(['--accept', '--accept-live'], { bdg: dir }));
});

test('unfinishedRepeat finds a queued or running dispatch, not finished ones', () => {
  assert.equal(unfinishedRepeat([]), null);
  assert.equal(unfinishedRepeat([{ databaseId: 1, status: 'completed' }]), null);
  assert.deepEqual(
    unfinishedRepeat([
      { databaseId: 1, status: 'completed' },
      { databaseId: 2, status: 'queued' },
      { databaseId: 3, status: 'in_progress' },
    ]),
    { databaseId: 2, status: 'queued' }
  );
});

test('jobsLostWithoutResult names failed jobs without a failed step, not test failures or CI OK', () => {
  const jobs = [
    { name: 'Smoke (Node 22)', conclusion: 'failure', steps: [{ conclusion: 'success' }, { conclusion: 'failure' }] },
    { name: 'Smoke (macOS)', conclusion: 'failure', steps: [{ conclusion: 'success' }, { conclusion: 'cancelled' }] },
    { name: 'Build', conclusion: 'failure', steps: [] },
    { name: 'Lint', conclusion: 'success', steps: [{ conclusion: 'success' }] },
    { name: 'CI OK', conclusion: 'failure', steps: [{ conclusion: 'success' }] },
  ];
  assert.deepEqual(jobsLostWithoutResult(jobs), ['Smoke (macOS)', 'Build']);
});

test('socketAccepts is true for a listening socket, false for a stale or missing one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-sock-'));
  const live = join(dir, 'daemon.sock');
  const server = createServer((c) => c.end());
  await new Promise((r) => server.listen(live, r));
  try {
    assert.equal(await socketAccepts(live), true);
  } finally {
    await new Promise((r) => server.close(r));
  }
  writeFileSync(join(dir, 'stale.sock'), '');
  assert.equal(await socketAccepts(join(dir, 'stale.sock')), false);
  assert.equal(await socketAccepts(join(dir, 'missing.sock')), false);
});

test('formatIssue quotes title, body and comments between markers; an empty body says so', () => {
  const text = formatIssue({
    number: 7,
    title: 'Click on <dialog> is silent',
    body: 'Steps <here>',
    comments: [{ author: { login: 'szymdzum' }, createdAt: '2026-10-16T10:00:00Z', body: 'Decision: A' }],
  });
  assert.match(text, /^<!-- issue -->\n## Issue #7: Click on <dialog> is silent\n\nSteps <here>/);
  assert.match(text, /### Comment by szymdzum \(2026-10-16\)\n\nDecision: A\n<!-- \/issue -->$/);
  assert.match(formatIssue({ number: 8, title: 't', body: '' }), /\(no description\)/);
});

test('unfilledPlaceholders counts only template placeholders, outside the quoted issue', () => {
  const placeholders = new Set(['<BASE>', '<scope>', '<KEY>']);
  const text = `Fix <BASE> and <url> on <dialog>\n${formatIssue({ number: 1, title: '<dialog>', body: '<KEY> <x y>' })}\n<scope> <TMPDIR>`;
  assert.deepEqual(unfilledPlaceholders(text, placeholders), ['<BASE>', '<scope>']);
});

test('templatePlaceholders reads briefs and blocks of the real briefs.md, not HTML or prose', () => {
  const placeholders = templatePlaceholders(BRIEFS);
  for (const p of ['<BASE>', '<HEAD>', '<RED>', '<ISSUE>', '<DESIGN>', '<files and modules worth reading first>'])
    assert.ok(placeholders.has(p), p);
  for (const p of ['<dialog>', '<TMPDIR>', '<title>', '<role>', '<main>', '<url>', '<!-- /brief -->'])
    assert.ok(!placeholders.has(p), p);
});

test('issueNumbers takes one number or a list, nothing that is not all numbers', () => {
  assert.deepEqual(issueNumbers('786'), ['786']);
  assert.deepEqual(issueNumbers('786,459 801,786'), ['786', '459', '801']);
  assert.deepEqual(issueNumbers('s15'), []);
  assert.deepEqual(issueNumbers(undefined), []);
});

test('formatDesign quotes the note between markers the placeholder check skips', () => {
  const note = formatDesign('Rule: watch <dialog open> and <describe(el)>; <!-- /design --> inside');
  assert.equal(note.match(/<!-- \/design -->/g).length, 1);
  assert.deepEqual(unfilledPlaceholders(note, new Set(['<dialog open>'])), []);
});

test('the design brief renders with its blocks and leaves DESIGN and ISSUE for ship brief', () => {
  const { brief, unfilled } = renderBrief(BRIEFS, 'design', { N: '786', MAIN: '/m' });
  assert.match(brief, /Review a design for issue #786/);
  assert.ok(brief.includes('<DESIGN>') && brief.includes('<ISSUE>'));
  assert.ok(!unfilled.includes('<DESIGN>') && !unfilled.includes('<ISSUE>'));
});

test('briefProblems refuses an empty brief and one with open placeholders, not HTML in it', () => {
  const placeholders = new Set(['<RED>']);
  assert.match(briefProblems('', placeholders)[0], /empty or too short/);
  const filled = 'x'.repeat(300);
  assert.deepEqual(briefProblems(`${filled} <dialog> <h2 id="feedback">`, placeholders), []);
  assert.match(briefProblems(`${filled} <RED>`, placeholders)[0], /placeholders still open: <RED>/);
});

test('isSessionFileName knows session files, rotated logs and atomic-write temp files', () => {
  for (const name of ['daemon.sock', 'daemon.log.1', 'last-session.json', 'query-cache.json', 'session.json.123.tmp'])
    assert.equal(isSessionFileName(name), true, name);
  for (const name of ['report.har', 'chrome-profile', 'daemon', 'my-session.json'])
    assert.equal(isSessionFileName(name), false, name);
});

test('isAgentCommand spots a daemon run from an agent worktree, not the main checkout', () => {
  const parent = '/Users/me/Developer';
  assert.equal(isAgentCommand(`node ${parent}/bdg-774/dist/daemon.js`, parent), true);
  assert.equal(isAgentCommand(`node ${parent}/bdg-verify/dist/daemon.js`, parent), true);
  assert.equal(isAgentCommand(`node ${parent}/browser-debugger-cli/dist/daemon.js`, parent), false);
  assert.equal(isAgentCommand('node /opt/homebrew/lib/node_modules/browser-debugger-cli/dist/daemon.js', parent), false);
});

test('formatIssue escapes an end marker inside the issue, so the quote ends only once', () => {
  const text = formatIssue({ number: 3, title: 't', body: 'a <!-- /issue --> <KEY>' });
  assert.equal(text.match(/<!-- \/issue -->/g).length, 1);
  assert.deepEqual(unfilledPlaceholders(`${text}\n${'x'.repeat(10)}`, new Set(['<KEY>'])), []);
});

test('isFixturesCommand accepts only the fixture server, never a reused PID', () => {
  assert.equal(isFixturesCommand('node /x/bdg-782/node_modules/.bin/tsx src/__testutils__/serveFixtures.ts'), true);
  assert.equal(isFixturesCommand('/bin/zsh -l'), false);
  assert.equal(isFixturesCommand(''), false);
});

test('missingLogRows lists backup rows whose PR log.md lacks, once each', () => {
  const log = '| merged | PR |\n|---|---|\n| 2026-10-16 | #794 | #661 |';
  const backup = '| 2026-10-16 | #794 | #661 |\n| 2026-10-16 | #795 | #590 |\n| 2026-10-16 | #795 | #590 | again |\n';
  assert.deepEqual(missingLogRows(log, backup), ['| 2026-10-16 | #795 | #590 | again |']);
  assert.deepEqual(missingLogRows(log, ''), []);
});

test("simplifyVerdict doesn't count a refactoring PR's own refactor: commits as the /simplify pass", () => {
  const large = SIMPLIFY_THRESHOLD + 1;
  const only = simplifyVerdict(large, ['refactor: type the CDP calls of src/runtime/page'], '');
  assert.equal(only.ok, false);
  assert.match(only.text, /its first change is a refactor: commit/);
  assert.equal(simplifyVerdict(large, ['test: red', 'refactor: x'], '').ok, false);
  assert.equal(simplifyVerdict(large, ['refactor: the change', 'refactor: simplify pass'], '').ok, false);
  assert.equal(
    simplifyVerdict(large, ['refactor: send the DOM runtime through sendTyped (#797)', 'refactor: send getMatchedStylesForNode through sendTyped'], '').ok,
    false
  );
  assert.equal(simplifyVerdict(large, ['refactor: the change'], '', { simplifyRan: true }).ok, true);
  assert.equal(simplifyVerdict(large, ['refactor: the change'], 'Nothing to simplify.').ok, true);
  assert.equal(simplifyVerdict(large, ["Merge branch 'main' into refactor/x", 'refactor: the change'], '').ok, false);
});

test('mergeCheckStillValid keeps a result for the same head when main moved around the PR files', () => {
  const prFiles = ['src/a.ts', 'src/b.ts'];
  assert.equal(mergeCheckStillValid({ checkedHead: 'h1', laterFiles: ['docs/x.md'] }, 'h1', prFiles), true);
  assert.equal(mergeCheckStillValid({ checkedHead: 'h1', laterFiles: [] }, 'h1', prFiles), true);
  assert.equal(mergeCheckStillValid({ checkedHead: 'h1', laterFiles: ['src/a.ts'] }, 'h1', prFiles), false);
  assert.equal(mergeCheckStillValid({ checkedHead: 'h0', laterFiles: [] }, 'h1', prFiles), false);
  assert.equal(mergeCheckStillValid({ checkedHead: 'h1', laterFiles: null }, 'h1', prFiles), false);
  assert.equal(mergeCheckStillValid({ laterFiles: [] }, 'h1', prFiles), false);
});

test('staleDependencies compares versions only, skips optional packages for other platforms', () => {
  const lock = {
    packages: {
      '': { version: '1.0.0' },
      'node_modules/typescript': { version: '6.0.3' },
      'node_modules/prettier': { version: '3.9.10' },
      'node_modules/@esbuild/win32-x64': { version: '0.25.0', optional: true },
      'node_modules/knip': { version: '6.41.0' },
    },
  };
  const installed = {
    packages: {
      'node_modules/typescript': { version: '6.0.3', libc: ['glibc'] },
      'node_modules/prettier': { version: '3.9.9' },
    },
  };
  assert.deepEqual(staleDependencies(lock, installed), ['prettier 3.9.9 → 3.9.10', 'knip missing → 6.41.0']);
  assert.deepEqual(staleDependencies(lock, lock), []);
  assert.deepEqual(
    staleDependencies({ packages: { 'node_modules/fsevents': { version: '2.3.3', devOptional: true } } }, { packages: {} }),
    []
  );
});

test('briefVariant: tier 1 drops the red-commit rules, a part says Part of instead of Closes', () => {
  const { brief } = renderBrief(BRIEFS, 'implementer', { N: '797', MAIN: '/m', BRANCH: 'refactor/x' });
  assert.match(brief, /Red commit first/);
  const tier1 = briefVariant(brief, { tier1: true });
  assert.doesNotMatch(tier1, /Red commit first|<!-- red -->/);
  assert.match(tier1, /No red commit\*\* \(tier 1/);
  const part = briefVariant(brief, { part: true });
  assert.match(part, /`Part of #797` \(not `Closes`/);
  assert.doesNotMatch(part, /`Closes #797`/);
  assert.doesNotMatch(briefVariant(brief, {}), /<!-- \/?red -->/);
});

test('partOfIssues reads "Part of #N" in any case, not fenced code or other numbers', () => {
  assert.deepEqual(partOfIssues('Part of #529. Also part of: #809'), ['529', '809']);
  assert.deepEqual(partOfIssues('part of https://github.com/szymdzum/browser-debugger-cli/issues/465'), ['465']);
  assert.deepEqual(partOfIssues('```\nPart of #1\n```\nCloses #2 #3'), []);
  assert.deepEqual(partOfIssues('part of #12a'), []);
});

test('renderBrief with NAME suffixes every path but keeps #N for the issue', () => {
  const { brief } = renderBrief(BRIEFS, 'implementer', { N: '529', NAME: '529a', MAIN: '/m', BRANCH: 'fix/529a' });
  assert.match(brief, /Implement issue #529 /);
  assert.match(brief, /worktree 529a fix\/529a/);
  assert.match(brief, /\.\.\/bdg-529a/);
  assert.match(brief, /\/tmp\/bt-529a /);
  assert.doesNotMatch(brief, /bdg-529[^a]|bt-529[^a]|#529a/);
  const { brief: review } = renderBrief(BRIEFS, 'reviewer', { N: '529', NAME: '529b', MAIN: '/m', HEAD: 'h', BASE: 'b', RED: 'r', BRANCH: 'x' });
  assert.match(review, /\/tmp\/review-529b/);
  assert.match(review, /\/tmp\/red-529b/);
  assert.match(review, /issue #529;/);
});


test("inScope takes a suffixed name only when listed, never a sibling PR's", () => {
  assert.equal(inScope('bdg-impl-465a-fixtures.pid', ['822', '465', '465a']), true);
  assert.equal(inScope('/tmp/review-465a', ['822', '465', '465a']), true);
  assert.equal(inScope('bdg-fixtures-465c.pid', ['822', '465', '465a']), false);
  assert.equal(inScope('bdg-impl-465c-fixtures.pid', ['465']), false);
  assert.equal(inScope('bdg-impl-4650-fixtures.pid', ['465']), false);
  assert.equal(inScope('bdg-impl-465-fixtures.pid', ['465']), true);
});

test('releaseVersion matches package.json to the vX.Y.Z in a release PR title', () => {
  const pkg = JSON.stringify({ name: 'browser-debugger-cli', version: '0.20.0' });
  assert.equal(releaseVersion(pkg, 'chore: release v0.20.0').ok, true);
  assert.match(releaseVersion(pkg, 'chore: release v0.21.0').text, /package.json 0.20.0, title v0.21.0/);
  assert.match(releaseVersion(pkg, 'chore: release').text, /names no vX.Y.Z/);
  assert.equal(releaseVersion(JSON.stringify({ version: '1.0.0-rc.1' }), 'release v1.0.0-rc.1').ok, true);
  assert.match(releaseVersion('', 'release v1.0.0').text, /no readable package.json/);
});

test('isFormatChecked follows npm run format:check, never the ship scripts', () => {
  assert.equal(isFormatChecked('src/commands/dom/click.ts'), true);
  assert.equal(isFormatChecked('package.json'), true);
  assert.equal(isFormatChecked('eslint.config.js'), true);
  assert.equal(isFormatChecked('.claude/skills/ship/scripts/ship.mjs'), false);
  assert.equal(isFormatChecked('docs/CLI_REFERENCE.md'), false);
  assert.equal(isFormatChecked('scripts/bundle-cli.mjs'), false);
});

test('strayClosingCommits flags a commit that closes an issue the PR body only takes part in', () => {
  const log = '8d04b1fb test: fix #465 specify: the help check matched --force for -f\n\0a1b2c3d fix: rename rows (Part of #465)\n\0';
  assert.deepEqual(strayClosingCommits(log, []), [{ sha: '8d04b1fb', issue: '465' }]);
  assert.deepEqual(strayClosingCommits(log, ['465']), []);
  assert.deepEqual(strayClosingCommits('abc test: reproduce #761\n\0', []), []);
});

test('briefVariant tier 1 also replaces the reviewer red-commit check', () => {
  const { brief } = renderBrief(BRIEFS, 'reviewer', { N: '797', MAIN: '/m', HEAD: 'h', BASE: 'b', RED: 'r', BRANCH: 'x' });
  assert.match(brief, /worktree add \/tmp\/red-797/);
  const tier1 = briefVariant(brief, { tier1: true });
  assert.doesNotMatch(tier1, /worktree add \/tmp\/red-|<!-- \/?red-review -->/);
  assert.match(tier1, /\*\*Red commit\.\*\* None: tier 1/);
  assert.doesNotMatch(briefVariant(brief, {}), /<!-- \/?red-review -->/);
});

test('the tester brief takes AGENT for a second parallel tester', () => {
  const a = renderBrief(BRIEFS, 'tester', { N: '455', MAIN: '/m', HEAD: 'h', AGENT: 'a' }).brief;
  const b = renderBrief(BRIEFS, 'tester', { N: '455', MAIN: '/m', HEAD: 'h', AGENT: 'b' }).brief;
  assert.match(a, /BDG_SESSION_DIR=\/tmp\/bdg-t-455-a\b/);
  assert.match(b, /BDG_SESSION_DIR=\/tmp\/bdg-t-455-b\b/);
  assert.match(b, /\/tmp\/bdg-t-455-b-work/);
});

test('fillOutsideQuotes fills hand-written placeholders but not the quoted issue', () => {
  const text = `Review <BASE>..<HEAD>\n${formatIssue({ number: 1, title: 't', body: 'keep <BASE>' })}`;
  const filled = fillOutsideQuotes(text, { BASE: 'b1', HEAD: 'h1' });
  assert.match(filled, /^Review b1\.\.h1\n/);
  assert.match(filled, /keep <BASE>/);
});

test('unitTestsFor finds __tests__ and .unit tests next to edited files, never smoke tests', () => {
  const tracked = [
    'src/daemon/session/__tests__/cdpSetup.test.ts',
    'src/daemon/__tests__/teardown.unit.test.ts',
    'src/__tests__/smoke/eval.smoke.test.ts',
    'src/utils/__tests__/renames.test.ts',
  ];
  assert.deepEqual(unitTestsFor(['src/daemon/session/cdpSetup.ts', 'src/daemon/session/teardown.ts', 'docs/x.md'], tracked), [
    'src/daemon/session/__tests__/cdpSetup.test.ts',
    'src/daemon/__tests__/teardown.unit.test.ts',
  ]);
  assert.deepEqual(unitTestsFor(['src/utils/__tests__/renames.test.ts'], tracked), ['src/utils/__tests__/renames.test.ts']);
});

test('suiteTimes reads top-level spec suites from a GitHub job log, summing reruns', () => {
  const prefix = 'Smoke Tests (Chrome) (Node 22, shard 1/4)\tUNKNOWN STEP\t2026-10-17T20:53:58.4814807Z ';
  const log = [
    `${prefix}▶ auth state save and load`,
    `${prefix}  ✔ logs in (1690.4ms)`,
    `${prefix}✔ auth state save and load (6091.69597ms)`,
    `${prefix}✖ DOM interactions (56000ms)`,
  ].join('\n');
  assert.deepEqual([...suiteTimes(log)], [
    ['auth state save and load', 6091.69597],
    ['DOM interactions', 56000],
  ]);
});

test('worktreeOrphans names processes from a scoped worktree that no PID file covers', () => {
  const ps = [
    '  101     1 node /dev/bdg-797b/dist/daemon.js',
    '  102   101 /Applications/Chrome --user-data-dir=/dev/bdg-797b/x/',
    '  103     1 npx tsx src/__testutils__/serveFixtures.ts --cwd /dev/bdg-455/',
    '  104     1 node /dev/bdg-verify/dist/index.js',
    '  105     1 node /dev/browser-debugger-cli/dist/index.js',
  ].join('\n');
  const orphans = worktreeOrphans(ps, '/dev', ['797b'], new Set([102]));
  assert.deepEqual(orphans.map((p) => p.pid), [101]);
  assert.deepEqual(worktreeOrphans(ps, '/dev', undefined, new Set()).map((p) => p.pid), [101, 102, 103]);
});

test('worktreeOrphans walks up the parents: npx & echo $! covers the server below it', () => {
  const ps = [
    '  200     1 npm exec tsx src/__testutils__/serveFixtures.ts',
    '  201   200 sh -c tsx src/__testutils__/serveFixtures.ts',
    '  202   201 node /dev/bdg-455/node_modules/.bin/tsx src/__testutils__/serveFixtures.ts',
    '  203   202 node --import tsx /dev/bdg-455/src/__testutils__/serveFixtures.ts',
    '  300     1 node /dev/browser-debugger-cli/../bdg-455/dist/index.js',
  ].join('\n');
  assert.deepEqual(worktreeOrphans(ps, '/dev', ['455'], new Set([200])).map((p) => p.pid), [300]);
});

test('pidReused: a process that started after its PID file was written holds a reused PID', () => {
  const written = Date.parse('2026-10-17T20:59:00Z');
  assert.equal(pidReused(Date.parse('2026-10-17T23:15:22Z'), written), true);
  assert.equal(pidReused(written - 1000, written), false);
  assert.equal(pidReused(written + 5000, written), false);
  assert.equal(pidReused(NaN, written), false);
});

test('mainCheckoutChanges names files added to the main checkout since the snapshot, not log.md', () => {
  const before = [' M .claude/skills/ship/log.md'];
  const now = [' M .claude/skills/ship/log.md', '?? g2.json', '?? docs/scratch.md'];
  assert.deepEqual(mainCheckoutChanges(before, now), ['g2.json', 'docs/scratch.md']);
  assert.deepEqual(mainCheckoutChanges([], [' M .claude/skills/ship/log.md']), []);
  assert.deepEqual(mainCheckoutChanges(['?? old.txt'], ['?? old.txt']), []);
  assert.deepEqual(mainCheckoutChanges([], ['M .claude/skills/ship/SKILL.md']), ['.claude/skills/ship/SKILL.md']);
});

test('proxyNote tells agents that run bdg to bypass a configured proxy', () => {
  assert.equal(proxyNote({}, 'tester'), null);
  assert.equal(proxyNote({ HTTPS_PROXY: 'http://127.0.0.1:9000' }, 'implementer'), null);
  const note = proxyNote({ HTTPS_PROXY: 'http://127.0.0.1:9000', http_proxy: 'x' }, 'reviewer');
  assert.match(note, /env -u HTTPS_PROXY -u http_proxy bdg/);
  assert.match(note, /--no-proxy-server/);
});
