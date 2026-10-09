/**
 * Console collection from browser log entries and attached targets
 * (cross-origin iframes, workers).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { CleanupFunction } from '@/connection/types.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import type { ConsoleMessage } from '@/types.js';

/**
 * CDP connection mock with flattened sessions: events carry a session id and
 * commands record the session they were sent to.
 */
class MockSessionCDP {
  readonly sent: Array<{ method: string; sessionId: string | undefined }> = [];
  /** Methods that fail, to simulate targets or browsers without them */
  readonly failing = new Set<string>();
  private handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();

  /**
   * Record a command and answer it.
   *
   * @param method - CDP method
   * @param _params - Ignored
   * @param sessionId - Target session
   * @returns Empty property list for getProperties, otherwise an empty result
   */
  send(method: string, _params?: unknown, sessionId?: string): Promise<unknown> {
    this.sent.push({ method, sessionId });
    if (this.failing.has(method)) return Promise.reject(new Error(`${method} unavailable`));
    return Promise.resolve(method === 'Runtime.getProperties' ? { result: [] } : {});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - CDP event
   * @param handler - Handler receiving params and session id
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown, sessionId?: string) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => list.splice(list.indexOf(handler), 1);
  }

  /**
   * Emit an event from a session.
   *
   * @param event - CDP event
   * @param params - Event params
   * @param sessionId - Session the event came from (undefined for the page)
   */
  emit(event: string, params: unknown, sessionId?: string): void {
    this.handlers.get(event)?.forEach((handler) => handler(params, sessionId));
  }

  /**
   * Sessions a method was sent to.
   *
   * @param method - CDP method
   * @returns Session ids, undefined for the page
   */
  sessionsOf(method: string): Array<string | undefined> {
    return this.sent.filter((call) => call.method === method).map((call) => call.sessionId);
  }
}

/**
 * Wait for pending promise callbacks (async target setup, object expansion).
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

void describe('Console sources', () => {
  let cdp: MockSessionCDP;
  let messages: ConsoleMessage[];
  let cleanup: CleanupFunction;

  beforeEach(async () => {
    cdp = new MockSessionCDP();
    messages = [];
    cleanup = await startConsoleCollection(cdp as unknown as CDPConnection, messages);
  });

  afterEach(async () => {
    await cleanup();
  });

  void it('records browser log entries with their level, source and location', () => {
    cdp.emit('Log.entryAdded', {
      entry: {
        source: 'network',
        level: 'error',
        text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
        timestamp: 1000,
        url: 'http://example.com/missing.png',
      },
    });
    cdp.emit('Log.entryAdded', {
      entry: { source: 'deprecation', level: 'verbose', text: 'old API', timestamp: 2000 },
    });

    assert.equal(messages[0]?.type, 'error');
    assert.equal(messages[0]?.source, 'network');
    assert.equal(messages[0]?.stackTrace?.[0]?.url, 'http://example.com/missing.png');
    assert.equal(messages[1]?.type, 'debug');
    assert.equal(messages[1]?.stackTrace, undefined);
  });

  void it('skips worker log entries, which arrive from the worker session', () => {
    cdp.emit('Log.entryAdded', {
      entry: { source: 'worker', level: 'warning', text: 'from worker', timestamp: 1000 },
    });

    assert.equal(messages.length, 0);
  });

  void it('enables console events on attached targets and their children', async () => {
    cdp.emit('Target.attachedToTarget', {
      sessionId: 'frame-1',
      targetInfo: { type: 'iframe', url: 'http://other.example/' },
      waitingForDebugger: false,
    });
    await flush();

    assert.deepEqual(cdp.sessionsOf('Runtime.enable'), [undefined, 'frame-1']);
    assert.deepEqual(cdp.sessionsOf('Log.enable'), [undefined, 'frame-1']);
    assert.deepEqual(cdp.sessionsOf('Target.setAutoAttach'), [undefined, 'frame-1']);
    const order = cdp.sent
      .filter((call) => call.sessionId === 'frame-1')
      .map((call) => call.method);
    assert.equal(order.at(-1), 'Runtime.runIfWaitingForDebugger', 'resumed after its setup');
  });

  void it('attaches to targets nested in attached targets', async () => {
    cdp.emit(
      'Target.attachedToTarget',
      {
        sessionId: 'nested-1',
        targetInfo: { type: 'iframe', url: 'http://third.example/' },
        waitingForDebugger: false,
      },
      'frame-1'
    );
    await flush();

    assert.deepEqual(cdp.sessionsOf('Runtime.enable'), [undefined, 'nested-1']);
  });

  void it('stops attaching to new targets after cleanup', async () => {
    await cleanup();
    cdp.emit('Target.attachedToTarget', {
      sessionId: 'late-1',
      targetInfo: { type: 'iframe', url: 'http://other.example/' },
      waitingForDebugger: false,
    });
    await flush();

    assert.deepEqual(cdp.sessionsOf('Runtime.enable'), [undefined]);
  });

  void it('keeps the page console when browser messages or attaching are unavailable', async () => {
    for (const method of ['Log.enable', 'Target.setAutoAttach']) {
      const failing = new MockSessionCDP();
      failing.failing.add(method);
      const collected: ConsoleMessage[] = [];
      const stop = await startConsoleCollection(failing as unknown as CDPConnection, collected);
      failing.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'still captured' }],
        executionContextId: 1,
        timestamp: 1000,
      });
      await stop();

      assert.equal(collected[0]?.text, 'still captured', method);
    }
  });

  void it('removes an unhandled rejection once a handler is attached, per session', () => {
    const rejection = (exceptionId: number, timestamp: number, message: string): unknown => ({
      timestamp,
      exceptionDetails: {
        exceptionId,
        text: 'Uncaught (in promise)',
        lineNumber: 0,
        columnNumber: 0,
        exception: { type: 'object', subtype: 'error', description: `Error: ${message}` },
      },
    });
    cdp.emit('Runtime.exceptionThrown', rejection(1, 1000, 'from eval'));
    cdp.emit('Runtime.exceptionThrown', rejection(1, 2000, 'in frame'), 'frame-1');
    cdp.emit('Runtime.exceptionThrown', rejection(2, 3000, 'never handled'));
    cdp.emit('Runtime.exceptionThrown', {
      timestamp: 4000,
      exceptionDetails: { exceptionId: 3, text: 'Uncaught', lineNumber: 0, columnNumber: 0 },
    });

    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 1 });
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 3 });
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 9 });

    assert.deepEqual(
      messages.map((m) => m.text),
      [
        'Uncaught (in promise) Error: in frame',
        'Uncaught (in promise) Error: never handled',
        'Uncaught',
      ]
    );
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 1 }, 'frame-1');
    assert.equal(messages.length, 2);
  });

  void it('keeps the same exception id of the page and an iframe apart', () => {
    const rejection = (text: string): unknown => ({
      timestamp: 1000,
      exceptionDetails: {
        exceptionId: 7,
        text: 'Uncaught (in promise)',
        lineNumber: 0,
        columnNumber: 0,
        exception: { type: 'object', subtype: 'error', description: `Error: ${text}` },
      },
    });
    cdp.emit('Runtime.exceptionThrown', rejection('page'));
    cdp.emit('Runtime.exceptionThrown', rejection('oopif'), 'oopif-1');

    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 7 }, 'oopif-1');
    assert.deepEqual(
      messages.map((m) => m.text),
      ['Uncaught (in promise) Error: page']
    );
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 7 });
    assert.deepEqual(messages, []);
  });

  void it('forgets rejections of a detached session or cleared contexts', () => {
    const rejection = (exceptionId: number): unknown => ({
      timestamp: 1000 + exceptionId,
      exceptionDetails: {
        exceptionId,
        text: 'Uncaught (in promise)',
        lineNumber: 0,
        columnNumber: 0,
      },
    });
    cdp.emit('Runtime.exceptionThrown', rejection(1));
    cdp.emit('Runtime.exceptionThrown', rejection(2), 'frame-1');
    cdp.emit('Runtime.executionContextsCleared', {});
    cdp.emit('Target.detachedFromTarget', { sessionId: 'frame-1' });
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 1 });
    cdp.emit('Runtime.exceptionRevoked', { reason: 'Handler added', exceptionId: 2 }, 'frame-1');
    assert.equal(messages.length, 2, 'reports of gone documents are no longer revoked');
  });

  void it('fails to start when the page console cannot be enabled', async () => {
    const failing = new MockSessionCDP();
    failing.failing.add('Runtime.enable');

    await assert.rejects(
      startConsoleCollection(failing as unknown as CDPConnection, []),
      /Runtime.enable unavailable/
    );
  });

  void it('expands objects through the session that logged them', async () => {
    cdp.emit(
      'Runtime.consoleAPICalled',
      {
        type: 'log',
        args: [{ type: 'object', objectId: 'obj-1', description: 'Object' }],
        executionContextId: 1,
        timestamp: 1000,
      },
      'frame-1'
    );
    await flush();
    await flush();

    assert.deepEqual(cdp.sessionsOf('Runtime.getProperties'), ['frame-1']);
    assert.equal(messages.length, 1);
  });

  void it('keeps the newest messages at the limit and counts the dropped ones', async () => {
    const full = new MockSessionCDP();
    const kept: ConsoleMessage[] = [];
    let dropped = 0;
    const stop = await startConsoleCollection(
      full as unknown as CDPConnection,
      kept,
      false,
      undefined,
      () => {
        dropped++;
      }
    );
    const log = (text: string, timestamp: number): void =>
      full.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: text }],
        executionContextId: 1,
        timestamp,
      });
    for (let i = 0; i < MAX_CONSOLE_MESSAGES + 2; i++) log(`msg ${i}`, 1000 + i);
    log('late and older than all kept', 1);
    await stop();

    assert.equal(kept.length, MAX_CONSOLE_MESSAGES);
    assert.equal(kept[0]?.text, 'msg 2');
    assert.equal(kept.at(-1)?.text, `msg ${MAX_CONSOLE_MESSAGES + 1}`);
    assert.equal(dropped, 3);
  });

  void it('reports when each message was received, also one added after its expansion', async () => {
    const stamped = new MockSessionCDP();
    const added: ConsoleMessage[] = [];
    const received: string[] = [];
    let events = 0;
    const stop = await startConsoleCollection(
      stamped as unknown as CDPConnection,
      added,
      false,
      undefined,
      undefined,
      () => {
        const receipt = ++events;
        return (message) => received.push(`${receipt}:${message.text}`);
      }
    );
    stamped.emit('Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ type: 'object', objectId: 'obj-1', description: 'Object' }],
      executionContextId: 1,
      timestamp: 1000,
    });
    stamped.emit('Runtime.exceptionThrown', {
      timestamp: 1001,
      exceptionDetails: { exceptionId: 1, text: 'Uncaught', lineNumber: 0, columnNumber: 0 },
    });
    await flush();
    await flush();
    await stop();

    assert.equal(added.length, 2);
    assert.deepEqual(received, ['2:Uncaught', `1:${added[0]?.text ?? ''}`]);
  });
});
