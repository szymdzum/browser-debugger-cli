/**
 * Watching an action's effects over CDP: main-frame navigation events,
 * pending navigations, the snapshot timing out, the second look before
 * "no effect", and cleanup.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { watchActionEffects } from '@/runtime/dom/actionEffects.js';

type Handler = (params: unknown, sessionId?: string) => void;

/** CDP stub with events and scripted page-script replies */
class FakeCdp {
  readonly handlers = new Map<string, Set<Handler>>();
  readonly expressions: string[] = [];

  /**
   * @param start - Reply of the snapshot before the action
   * @param reads - Replies of the reads after it, in order
   */
  constructor(
    private readonly start: Promise<unknown>,
    private readonly reads: unknown[] = []
  ) {}

  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  emit(event: string, params: unknown, sessionId?: string): void {
    this.handlers.get(event)?.forEach((handler) => handler(params, sessionId));
  }

  /** Listeners still registered */
  get listening(): number {
    return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0);
  }

  send(method: string, params?: { expression?: string }): Promise<unknown> {
    if (method === 'Page.getFrameTree')
      return Promise.resolve({ frameTree: { frame: { id: 'main' } } });
    const expression = params?.expression;
    if (expression === undefined) return Promise.resolve({});
    this.expressions.push(expression);
    if (expression.includes('new MutationObserver')) return this.start.then(wrap);
    if (expression.includes('const scrolled')) return Promise.resolve(wrap(this.reads.shift()));
    return Promise.resolve({});
  }

  /** Reads sent so far: whether each also stopped the watch */
  get readsSent(): boolean[] {
    return this.expressions
      .filter((e) => e.includes('const scrolled'))
      .map((e) => e.endsWith('(true)'));
  }

  /** Whether the stop script was sent */
  get stopSent(): boolean {
    return this.expressions.some((e) => e.startsWith('if (window.__bdgEffects)'));
  }

  get connection(): CDPConnection {
    return this as unknown as CDPConnection;
  }
}

/**
 * A Runtime.evaluate reply.
 *
 * @param value - Script value
 * @returns Reply
 */
function wrap(value: unknown): unknown {
  return { result: { value } };
}

/** Snapshot before the action */
const START = { href: 'https://a.test/', messages: [] };

/** A read in the same document that saw nothing change */
const QUIET = { href: 'https://a.test/', fresh: false, changes: 0, messages: [] };

/** Let pending promise callbacks run */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const MAIN_FRAME = { id: 'main', url: 'https://a.test/next', loaderId: 'L2' };

void describe('watchActionEffects', () => {
  void it('reports only main-frame navigations of the page itself, with their status', async () => {
    const ignored = new FakeCdp(Promise.resolve(START), [QUIET]);
    const quiet = watchActionEffects(ignored.connection);
    ignored.emit('Page.frameNavigated', {
      frame: { ...MAIN_FRAME, id: 'child', parentId: 'main' },
    });
    ignored.emit('Page.frameNavigated', { frame: MAIN_FRAME }, 'oopif-session');
    assert.deepEqual(await quiet.collect({ dialogs: 0, detectNoEffect: false }), {});
    quiet.dispose();

    const fresh = { ...QUIET, href: 'https://a.test/next', fresh: true };
    const cdp = new FakeCdp(Promise.resolve(START), [fresh]);
    const watch = watchActionEffects(cdp.connection);
    const response = { type: 'Document', loaderId: 'L2', response: { status: 200 } };
    cdp.emit('Network.responseReceived', response);
    cdp.emit('Page.frameNavigated', { frame: MAIN_FRAME });
    const effects = await watch.collect({ dialogs: 0, detectNoEffect: false });
    assert.deepEqual(effects.navigation, {
      url: 'https://a.test/next',
      sameDocument: false,
      status: 200,
    });
    watch.dispose();
  });

  void it('keeps the navigation when the snapshot before the action never answered', async () => {
    const cdp = new FakeCdp(new Promise(() => undefined));
    const watch = watchActionEffects(cdp.connection);
    cdp.emit('Page.frameNavigated', { frame: MAIN_FRAME });
    const effects = await watch.collect({ dialogs: 0, detectNoEffect: true });
    assert.deepEqual(effects, { navigation: { url: 'https://a.test/next', sameDocument: false } });
    assert.deepEqual(cdp.readsSent, [], 'no read without a snapshot');
    watch.dispose();
    assert.ok(cdp.stopSent, 'the stop follows a snapshot that may still run');
  });

  void it('skips reading while a main-frame load is pending', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [QUIET]);
    const watch = watchActionEffects(cdp.connection);
    await tick();
    cdp.emit('Page.frameStartedLoading', { frameId: 'main' });
    assert.deepEqual(await watch.collect({ dialogs: 0, detectNoEffect: true }), {});
    assert.deepEqual(cdp.readsSent, []);
    watch.dispose();
  });

  void it('claims no effect only when the second look is still quiet', async () => {
    const quiet = new FakeCdp(Promise.resolve(START), [QUIET, QUIET]);
    const none = watchActionEffects(quiet.connection);
    assert.deepEqual(await none.collect({ dialogs: 0, detectNoEffect: true }), { effect: 'none' });
    assert.deepEqual(quiet.readsSent, [false, true]);

    const late = new FakeCdp(Promise.resolve(START), [QUIET, { ...QUIET, changes: 1 }]);
    const changed = watchActionEffects(late.connection);
    assert.deepEqual(await changed.collect({ dialogs: 0, detectNoEffect: true }), {});
  });

  void it('stops listening on dispose, and stops the page watch unless a read did', async () => {
    const stopped = new FakeCdp(Promise.resolve(START), [QUIET, QUIET]);
    const watch = watchActionEffects(stopped.connection);
    await watch.collect({ dialogs: 0, detectNoEffect: true });
    watch.dispose();
    assert.equal(stopped.listening, 0);
    assert.equal(stopped.stopSent, false);

    const unread = new FakeCdp(Promise.resolve(START), [{ ...QUIET, changes: 2 }]);
    const other = watchActionEffects(unread.connection);
    await other.collect({ dialogs: 0, detectNoEffect: true });
    other.dispose();
    assert.equal(unread.listening, 0);
    assert.equal(unread.stopSent, true);
  });
});
