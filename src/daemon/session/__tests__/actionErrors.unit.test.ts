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

/**
 * Add messages to the session as the console collector does: stamped as
 * received now, kept in timestamp order.
 *
 * @param store - Session store
 * @param messages - Messages
 */
function receive(store: TelemetryStore, ...messages: ConsoleMessage[]): void {
  for (const added of messages) {
    store.receiveConsoleMessage()(added);
    store.consoleMessages.push(added);
  }
  store.consoleMessages.sort((a, b) => a.timestamp - b.timestamp);
}

void describe('watchActionErrors', () => {
  void it('reports nothing when no error was logged', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    receive(store, message('log', 'hello'));
    assert.deepEqual(collect(), {});
  });

  void it('reports errors, uncaught exceptions and failed asserts, with their source', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    receive(
      store,
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
    receive(store, message('error', 'on load', { ago: 1000 }));
    const collect = watchActionErrors(store);
    receive(store, message('error', 'on click'));
    assert.deepEqual(collect().errors, [{ text: 'on click', count: 1 }]);
  });

  void it('leaves out an error received before the action but added late', () => {
    const store = new TelemetryStore();
    const addExpanded = store.receiveConsoleMessage();
    const collect = watchActionErrors(store);
    const expanded = message('error', 'expanded late');
    addExpanded(expanded);
    store.consoleMessages.push(expanded);
    assert.deepEqual(collect(), {});
  });

  void it("attributes by arrival, whatever Chrome's clock says", () => {
    const store = new TelemetryStore();
    const hourMs = 3_600_000;
    receive(store, message('error', 'before, Chrome clock ahead', { ago: -hourMs }));
    const collect = watchActionErrors(store);
    receive(store, message('error', 'during, Chrome clock behind', { ago: hourMs }));
    assert.deepEqual(collect().errors, [{ text: 'during, Chrome clock behind', count: 1 }]);
  });

  void it('leaves out warnings and other levels', () => {
    const store = new TelemetryStore();
    const collect = watchActionErrors(store);
    receive(
      store,
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
    receive(
      store,
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
      receive(store, message('error', text));
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
    receive(
      store,
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
    receive(
      store,
      message('error', 'Failed to load resource: 404', {
        url: 'http://app.test/api/items',
        line: -1,
        column: -1,
      })
    );
    assert.equal(collect().errors?.[0]?.source, 'http://app.test/api/items');
  });
});
