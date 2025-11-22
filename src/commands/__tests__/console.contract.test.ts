/**
 * Contract tests for console command navigation filtering.
 *
 * Tests the public behavior of filterByCurrentNavigation:
 * - Given messages from multiple page loads, returns only current navigation
 * - Handles edge cases (empty, single navigation, missing IDs)
 */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import { filterByCurrentNavigation } from '@/commands/console.js';
import type { ConsoleMessage } from '@/types.js';

/**
 * Create a test console message with minimal required fields.
 */
function createMessage(
  text: string,
  navigationId: number | undefined,
  type: ConsoleMessage['type'] = 'log'
): ConsoleMessage {
  const msg: ConsoleMessage = {
    text,
    type,
    timestamp: Date.now(),
  };
  if (navigationId !== undefined) {
    msg.navigationId = navigationId;
  }
  return msg;
}

describe('filterByCurrentNavigation contract', () => {
  describe('filters to current (most recent) navigation', () => {
    test('returns only messages from highest navigationId', () => {
      const messages: ConsoleMessage[] = [
        createMessage('old error', 1),
        createMessage('old warning', 1),
        createMessage('current error', 2),
        createMessage('current log', 2),
      ];

      const result = filterByCurrentNavigation(messages);

      assert.strictEqual(result.length, 2);
      assert.ok(result.every((m) => m.navigationId === 2));
      assert.ok(result.some((m) => m.text === 'current error'));
      assert.ok(result.some((m) => m.text === 'current log'));
    });

    test('handles three navigations correctly', () => {
      const messages: ConsoleMessage[] = [
        createMessage('nav1', 1),
        createMessage('nav2', 2),
        createMessage('nav3-a', 3),
        createMessage('nav3-b', 3),
      ];

      const result = filterByCurrentNavigation(messages);

      assert.strictEqual(result.length, 2);
      assert.ok(result.every((m) => m.navigationId === 3));
    });

    test('preserves message order within navigation', () => {
      const messages: ConsoleMessage[] = [
        createMessage('first', 2),
        createMessage('second', 2),
        createMessage('third', 2),
      ];

      const result = filterByCurrentNavigation(messages);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.at(0)?.text, 'first');
      assert.strictEqual(result.at(1)?.text, 'second');
      assert.strictEqual(result.at(2)?.text, 'third');
    });
  });

  describe('edge cases', () => {
    test('returns empty array for empty input', () => {
      const result = filterByCurrentNavigation([]);

      assert.strictEqual(result.length, 0);
    });

    test('returns all messages when single navigation', () => {
      const messages: ConsoleMessage[] = [
        createMessage('a', 1),
        createMessage('b', 1),
        createMessage('c', 1),
      ];

      const result = filterByCurrentNavigation(messages);

      assert.strictEqual(result.length, 3);
    });

    test('handles messages without navigationId', () => {
      const messages: ConsoleMessage[] = [
        createMessage('no-nav', undefined),
        createMessage('with-nav', 1),
      ];

      const result = filterByCurrentNavigation(messages);

      // Messages without navigationId should be excluded (navigationId !== maxId)
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result.at(0)?.text, 'with-nav');
    });

    test('handles all messages without navigationId', () => {
      const messages: ConsoleMessage[] = [
        createMessage('no-nav-1', undefined),
        createMessage('no-nav-2', undefined),
      ];

      const result = filterByCurrentNavigation(messages);

      // All have navigationId=undefined, max of [0,0] = 0, filter where navId === 0
      // Since undefined !== 0, returns empty
      assert.strictEqual(result.length, 0);
    });
  });

  describe('message types preserved', () => {
    test('preserves all console message types', () => {
      const messages: ConsoleMessage[] = [
        createMessage('error msg', 1, 'error'),
        createMessage('warning msg', 1, 'warning'),
        createMessage('log msg', 1, 'log'),
        createMessage('info msg', 1, 'info'),
        createMessage('debug msg', 1, 'debug'),
      ];

      const result = filterByCurrentNavigation(messages);

      assert.strictEqual(result.length, 5);
      assert.ok(result.some((m) => m.type === 'error'));
      assert.ok(result.some((m) => m.type === 'warning'));
      assert.ok(result.some((m) => m.type === 'log'));
      assert.ok(result.some((m) => m.type === 'info'));
      assert.ok(result.some((m) => m.type === 'debug'));
    });
  });
});
