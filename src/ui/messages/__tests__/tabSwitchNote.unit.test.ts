/**
 * The note under console and network views after the session moved to
 * another tab: that tab's earlier requests are not recorded, nor its
 * messages from while the session was away (those of a tab the session was
 * never on are, through Chrome's replay).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
import { formatConsole } from '@/ui/formatters/console.js';
import { tabSwitchNote, withTabSwitchNote } from '@/ui/messages/commands.js';

/**
 * A move to tab 1.
 *
 * @param consoleReplayed - Whether the session was never on it
 * @returns The move
 */
function moveTo(consoleReplayed: boolean): TabSwitchInfo {
  return {
    at: new Date(2026, 9, 9, 18, 2, 11).getTime(),
    tab: { index: 1, targetId: 'P', url: 'http://a/popup', title: 'Popup' },
    consoleReplayed,
  };
}

void describe('tab switch note', () => {
  void it('says the earlier requests of the tab are not recorded', () => {
    const at = new Date(moveTo(true).at).toLocaleTimeString();
    assert.equal(
      tabSwitchNote(moveTo(true), 'network'),
      `Switched to tab 1 at ${at} (http://a/popup); its earlier requests are not recorded`
    );
  });

  void it('names the console messages only when Chrome did not replay them', () => {
    assert.equal(tabSwitchNote(moveTo(true), 'console'), undefined);
    assert.match(
      tabSwitchNote(moveTo(false), 'console') ?? '',
      /; what it logged while the session was on another tab is not recorded$/
    );
    assert.match(
      tabSwitchNote(moveTo(false), 'all') ?? '',
      /; its earlier requests and what it logged while the session was on another tab are not recorded$/
    );
  });

  void it('goes under the view, and under the console output', () => {
    assert.equal(withTabSwitchNote('body', undefined, 'network'), 'body');
    assert.match(withTabSwitchNote('body', moveTo(true), 'network'), /^body\n\nSwitched to tab 1/);
    assert.match(
      formatConsole([], { tabSwitch: moveTo(false) }),
      /\n\nSwitched to tab 1 at .*is not recorded$/
    );
  });
});
