/**
 * `bdg console --last`: listing the last messages instead of the summary, and
 * explaining session indices that skip messages the filters left out.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listsMessages, skippedMessages } from '@/commands/console.js';
import type { ConsoleMessage } from '@/types.js';
import { formatConsole, lastMessages } from '@/ui/formatters/console.js';
import { consoleIndexGapNote } from '@/ui/messages/consoleMessages.js';

/**
 * A console message at a session index.
 *
 * @param index - Position in the session's message list
 * @param navigationId - Page load that logged it
 * @param type - Level
 * @returns Message
 */
function message(
  index: number,
  navigationId = 1,
  type: ConsoleMessage['type'] = 'log'
): ConsoleMessage {
  return { index, navigationId, type, text: `message ${index}`, timestamp: 1000 + index };
}

void describe('console --last', () => {
  void it('lists the messages when --last is given, the summary otherwise', () => {
    assert.equal(listsMessages({ last: '3' }), true);
    assert.equal(listsMessages({ list: true }), true);
    assert.equal(listsMessages({}), false);
  });

  void it('selects the last N messages, all for 0', () => {
    const messages = [message(0), message(1), message(2), message(3)];
    assert.deepEqual(
      lastMessages(messages, 3).map((m) => m.index),
      [1, 2, 3]
    );
    assert.equal(lastMessages(messages, 0).length, 4);
    assert.equal(lastMessages(messages, undefined).length, 4);
  });

  void it('shows the last messages, not the summary', () => {
    const output = formatConsole([message(0), message(1), message(2)], { list: true, last: 2 });
    assert.match(output, /^Console Messages \(last 2 of 3\)/);
    assert.match(output, /\[2\] +log/);
    assert.doesNotMatch(output, /\[0\]/);
  });
});

void describe('console index gaps', () => {
  void it('counts messages of another page load between the listed ones', () => {
    const all = [message(0), message(1), message(2, 0), message(3)];
    const listed = all.filter((m) => m.navigationId === 1);
    assert.deepEqual(skippedMessages(all, listed), { otherPages: 1, otherLevels: 0 });
  });

  void it('counts messages of another level, not those outside the listed range', () => {
    const all = [message(0, 1, 'warning'), message(1), message(2, 1, 'warning'), message(3)];
    const listed = [all[0], all[2]] as ConsoleMessage[];
    assert.deepEqual(skippedMessages(all, listed), { otherPages: 0, otherLevels: 1 });
  });

  void it('with --history, counts the messages left out between as of another level', () => {
    const all = [message(0, 1, 'error'), message(1, 2), message(2, 3, 'error')];
    const listed = [all[0], all[2]] as ConsoleMessage[];
    assert.deepEqual(skippedMessages(all, listed, true), { otherPages: 0, otherLevels: 1 });
    assert.deepEqual(skippedMessages(all, listed), { otherPages: 1, otherLevels: 0 });
  });

  void it('explains the gap under the list', () => {
    const output = formatConsole([message(0), message(1), message(3)], {
      list: true,
      skipped: { otherPages: 1, otherLevels: 0 },
    });
    assert.match(output, /Console Messages \(3 total\)/);
    assert.match(
      output,
      /\[n\] are positions in the session's message list; not listed in between: 1 message from another page load \(-H lists all\)$/
    );
  });

  void it('names both reasons with their counts', () => {
    assert.equal(
      consoleIndexGapNote({ otherPages: 2, otherLevels: 1 }),
      "[n] are positions in the session's message list; not listed in between: 1 message of another level, 2 messages from another page load (-H lists all)"
    );
  });
});
