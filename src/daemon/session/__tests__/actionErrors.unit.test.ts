/**
 * The console errors and uncaught exceptions an action caused, read from the
 * session's console telemetry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { watchActionErrors } from '@/daemon/session/actionErrors.js';
import type { ConsoleMessage } from '@/types.js';

/**
 * A console message logged now (or `ago` ms before now).
 *
 * @param type - Message type
 * @param text - Text
 * @param options - Source frame and how long ago it was logged
 * @returns Message
 */
function message(
  type: ConsoleMessage['type'],
  text: string,
  options: { url?: string; line?: number; column?: number; ago?: number } = {}
): ConsoleMessage {
  return {
    type,
    text,
    timestamp: Date.now() + 1 - (options.ago ?? 0),
    ...(options.url !== undefined && {
      stackTrace: [
        {
          url: options.url,
          lineNumber: options.line ?? 0,
          columnNumber: options.column ?? 0,
          scriptId: '1',
        },
      ],
    }),
  };
}

void describe('watchActionErrors', () => {
  void it('reports nothing when no error was logged', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(message('log', 'hello'));
    assert.deepEqual(collect(), {});
  });

  void it('reports errors, uncaught exceptions and failed asserts, with their source', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(
      message('error', 'boom', { url: 'http://app.test/', line: 2, column: 10 }),
      message('error', 'Uncaught Error: handler exploded', {
        url: 'http://app.test/app.js',
        line: 4,
        column: 141,
      }),
      message('assert', 'Assertion failed')
    );
    assert.deepEqual(collect(), {
      errors: [
        { text: 'boom', source: 'http://app.test/:3:11', count: 1 },
        {
          text: 'Uncaught Error: handler exploded',
          source: 'http://app.test/app.js:5:142',
          count: 1,
        },
        { text: 'Assertion failed', count: 1 },
      ],
    });
  });

  void it('leaves out errors logged before the action began', () => {
    const store = new TelemetryStore();
    store.consoleMessages.push(message('error', 'on load', { ago: 1000 }));
    const collect = watchActionErrors(store);
    store.consoleMessages.push(message('error', 'on click'));
    assert.deepEqual(collect().errors, [{ text: 'on click', count: 1 }]);
  });

  void it('leaves out an error from before the action that arrived late', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(message('error', 'expanded late', { ago: 1000 }));
    store.consoleMessages.sort((a, b) => a.timestamp - b.timestamp);
    assert.deepEqual(collect(), {});
  });

  void it('leaves out warnings and other levels', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(
      message('warning', 'deprecated'),
      message('info', 'saved'),
      message('debug', 'trace')
    );
    assert.deepEqual(collect(), {});
  });

  void it('groups repeats as `bdg console` does, counting them', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    const at = { url: 'http://app.test/', line: 2, column: 10 };
    store.consoleMessages.push(
      message('error', 'boom', at),
      message('error', 'boom', at),
      message('error', 'boom', { ...at, line: 7 })
    );
    assert.deepEqual(collect().errors, [
      { text: 'boom', source: 'http://app.test/:3:11', count: 2 },
      { text: 'boom', source: 'http://app.test/:8:11', count: 1 },
    ]);
  });

  void it('lists the first 3 distinct errors and counts the rest', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    for (const text of ['one', 'two', 'three', 'four', 'five', 'five']) {
      store.consoleMessages.push(message('error', text));
    }
    const { errors, moreErrors } = collect();
    assert.deepEqual(
      errors?.map((error) => error.text),
      ['one', 'two', 'three']
    );
    assert.equal(moreErrors, 2);
  });

  void it('puts a multi-line text on one line and cuts a long one', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(
      message('error', 'Uncaught Error: first\n  second'),
      message('error', 'x'.repeat(300))
    );
    const [multiLine, long] = collect().errors ?? [];
    assert.equal(multiLine?.text, 'Uncaught Error: first second');
    assert.equal(Array.from(long?.text ?? '').length, 120);
    assert.ok(long?.text.endsWith('…'));
  });

  void it('names the URL alone for a message without a position (a failed load)', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    store.consoleMessages.push(
      message('error', 'Failed to load resource: 404', {
        url: 'http://app.test/api/items',
        line: -1,
        column: -1,
      })
    );
    assert.equal(collect().errors?.[0]?.source, 'http://app.test/api/items');
  });
});
