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
  judgeConclusions,
  overlappingFiles,
  parseArgs,
  parseBriefs,
  renderBrief,
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

test('judgeConclusions: a cancelled run is superseded, not a failure', () => {
  const { code, summary } = judgeConclusions({ CI: 'cancelled', Security: 'success' });
  assert.equal(code, EXIT.superseded);
  assert.match(summary, /superseded/);
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
