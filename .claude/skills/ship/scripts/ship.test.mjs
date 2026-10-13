/**
 * Tests for the pure parts of ship.mjs: argument parsing, CI verdicts, the
 * gate-6 overlap and brief rendering (including the real briefs.md).
 *
 * Run: node --test .claude/skills/ship/scripts/ship.test.mjs (also part of npm test)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  EXIT,
  inScope,
  insertLogRow,
  isTransientGhError,
  judgeConclusions,
  overlappingFiles,
  parseArgs,
  parseBriefs,
  renderBrief,
  retryTransient,
  run,
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

test('briefs.md has the four briefs and every block they use', () => {
  const { briefs } = parseBriefs(BRIEFS);
  assert.deepEqual(Object.keys(briefs).sort(), ['implementer', 'reviewer', 'tester', 'verifier']);
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

test('retry covers reads only: run() has no retry, ghJson alone wraps it', () => {
  const src = readFileSync(join(import.meta.dirname, 'ship.mjs'), 'utf8');
  const runFn = src.slice(src.indexOf('function run('), src.indexOf('const TRANSIENT_GH'));
  assert.ok(!runFn.includes('retryTransient'));
  assert.equal(src.match(/retryTransient\(\(\) =>/g).length, 1);
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

test('a waiter deadline caps the call timeout and ends the retries', () => {
  const started = Date.now();
  let calls = 0;
  assert.throws(
    () =>
      retryTransient(
        () => {
          calls++;
          return run('sleep', ['5'], { timeoutMs: 60_000, deadline: Date.now() + 300 });
        },
        { backoff: [1, 1], wait: () => {}, deadline: Date.now() + 300 }
      ),
    { timedOut: true }
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 3000);
});
