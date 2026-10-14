/**
 * `bdg attach` tab choice (#473): page tabs from `Target.getTargets`, matched
 * by index or by a case-insensitive substring of URL or title, and the tab
 * list it prints.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchTab, pageTabs, type BrowserTargetInfo } from '@/connection/browserTabs.js';
import { CommandError } from '@/errors/index.js';
import { formatTabList } from '@/ui/formatters/attach.js';

const TARGETS: BrowserTargetInfo[] = [
  { targetId: 'A', type: 'page', title: 'Checkout', url: 'https://shop.test/checkout' },
  { targetId: 'W', type: 'service_worker', title: 'sw', url: 'https://shop.test/sw.js' },
  { targetId: 'B', type: 'page', title: 'Inbox (3)', url: 'https://mail.test/inbox' },
  { targetId: 'C', type: 'page', title: 'Mail settings', url: 'https://mail.test/settings' },
];

/**
 * The CommandError a call throws.
 *
 * @param run - The call
 * @returns The error
 */
function commandErrorOf(run: () => unknown): CommandError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CommandError, `CommandError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected a CommandError');
}

void describe('pageTabs', () => {
  void it('keeps page targets only, numbered from 0', () => {
    assert.deepEqual(
      pageTabs(TARGETS).map((tab) => [tab.index, tab.targetId]),
      [
        [0, 'A'],
        [1, 'B'],
        [2, 'C'],
      ]
    );
  });
});

void describe('matchTab', () => {
  const tabs = pageTabs(TARGETS);

  void it('matches a URL substring case-insensitively', () => {
    assert.equal(matchTab(tabs, 'CHECKOUT').targetId, 'A');
  });

  void it('matches a title substring', () => {
    assert.equal(matchTab(tabs, 'inbox (3)').targetId, 'B');
  });

  void it('takes a number as an index from the list', () => {
    assert.equal(matchTab(tabs, '2').targetId, 'C');
    assert.equal(matchTab(tabs, '0').targetId, 'A');
  });

  void it('exits 83 with the tab list when nothing matches', () => {
    const err = commandErrorOf(() => matchTab(tabs, 'nowhere'));
    assert.equal(err.exitCode, 83);
    assert.match(err.message, /No tab matches "nowhere"/);
    assert.match(err.metadata.suggestion ?? '', /\[1\] Inbox \(3\) — https:\/\/mail\.test\/inbox/);
  });

  void it('exits 81 with the candidates when several match', () => {
    const err = commandErrorOf(() => matchTab(tabs, 'mail.test'));
    assert.equal(err.exitCode, 81);
    assert.match(err.message, /2 tabs match "mail\.test"/);
    const suggestion = err.metadata.suggestion ?? '';
    assert.match(suggestion, /\[1\] Inbox/);
    assert.match(suggestion, /\[2\] Mail settings/);
    assert.doesNotMatch(suggestion, /Checkout/);
    assert.match(suggestion, /use an index/i);
  });

  void it('exits 81 for an empty or blank pattern instead of matching every tab', () => {
    for (const blank of ['', '   ']) {
      const err = commandErrorOf(() => matchTab(tabs.slice(0, 1), blank));
      assert.equal(err.exitCode, 81);
      assert.match(err.message, /empty/);
    }
  });

  void it('takes a number as an index even when a title contains it', () => {
    const numbered = pageTabs([
      ...TARGETS,
      { targetId: 'Y', type: 'page', title: 'Report 1', url: 'https://r.test/' },
    ]);
    assert.equal(matchTab(numbered, '1').targetId, 'B');
  });

  void it('exits 81 for an index out of range', () => {
    const err = commandErrorOf(() => matchTab(tabs, '3'));
    assert.equal(err.exitCode, 81);
    assert.match(err.message, /No tab at index 3 \(3 tabs open\)/);
  });
});

void describe('formatTabList', () => {
  void it('prints one 0-based line per tab', () => {
    assert.equal(
      formatTabList(pageTabs(TARGETS)),
      [
        '[0] Checkout — https://shop.test/checkout',
        '[1] Inbox (3) — https://mail.test/inbox',
        '[2] Mail settings — https://mail.test/settings',
      ].join('\n')
    );
  });

  void it('cuts titles and URLs over 80 characters', () => {
    const [tab] = pageTabs([
      {
        targetId: 'L',
        type: 'page',
        title: 'T'.repeat(200),
        url: `https://x.test/${'p'.repeat(200)}`,
      },
    ]);
    assert.ok(tab);
    assert.equal(
      formatTabList([tab]),
      `[0] ${'T'.repeat(79)}… — https://x.test/${'p'.repeat(64)}…`
    );
  });

  void it('shows an untitled tab as (no title)', () => {
    const [tab] = pageTabs([{ targetId: 'X', type: 'page', title: '', url: 'about:blank' }]);
    assert.ok(tab);
    assert.equal(formatTabList([tab]), '[0] (no title) — about:blank');
  });
});
