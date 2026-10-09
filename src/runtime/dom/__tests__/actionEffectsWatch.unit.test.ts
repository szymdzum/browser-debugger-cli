/**
 * Watching an action's effects over CDP: main-frame navigation events,
 * pending navigations, the snapshot timing out, the second look before
 * "no effect", shown elements, the page's work (an unanswered read, a DOM
 * still changing on a second look, stalls that are not quiet time), and
 * cleanup.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { watchActionEffects, type CollectedEffects } from '@/runtime/dom/actionEffects.js';

type Handler = (params: unknown, sessionId?: string) => void;

/**
 * CDP stub with events and scripted page-script replies. It makes no
 * isolated world, so bdg's own scripts run in the main world.
 */
class FakeCdp {
  readonly handlers = new Map<string, Set<Handler>>();
  readonly expressions: string[] = [];
  readonly methods: string[] = [];

  /**
   * @param start - Reply of the snapshot before the action
   * @param reads - Replies of the reads after it, in order
   * @param timersRun - Whether the page's timers run (false: throttled or stopped timers)
   * @param answers - Whether the page answers after the action (false: a long script)
   * @param stalls - Replies of the stall reads, in order (page times `[due, ran]`)
   */
  constructor(
    private readonly start: Promise<unknown>,
    private readonly reads: unknown[] = [],
    private readonly timersRun = true,
    private readonly answers = true,
    private readonly stalls: unknown[] = []
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
    this.methods.push(method);
    if (method === 'Page.getFrameTree')
      return Promise.resolve({ frameTree: { frame: { id: 'main' } } });
    if (method === 'Page.createIsolatedWorld') return Promise.reject(new Error('No world'));
    const expression = params?.expression;
    if (expression === undefined) return Promise.resolve({});
    this.expressions.push(expression);
    if (expression.includes('setTimeout(resolve, 0)')) {
      return this.answers ? Promise.resolve(wrap(true)) : new Promise(() => undefined);
    }
    if (expression === 'globalThis.__bdgDueTimers') {
      return this.timersRun ? Promise.resolve(wrap(undefined)) : new Promise(() => undefined);
    }
    if (expression.includes('new MutationObserver')) return this.start.then(wrap);
    if (expression.includes('const ongoing')) return Promise.resolve(wrap(this.stalls.shift()));
    if (expression.includes('const scrolled')) {
      const read = this.reads.shift();
      return read === NO_ANSWER ? new Promise(() => undefined) : Promise.resolve(wrap(read));
    }
    return Promise.resolve({});
  }

  /** Reads sent so far: whether each also stopped the watch */
  get readsSent(): boolean[] {
    return this.expressions
      .filter((e) => e.includes('const scrolled'))
      .map((e) => /\(true, (true|false)\)$/.test(e));
  }

  /** Stall scripts sent so far: `start`, `read` and `stop`, in order */
  get stallScripts(): string[] {
    return this.expressions.flatMap((e) => {
      if (e.includes('const schedule')) return ['start'];
      if (e.includes('const ongoing')) return ['read'];
      return e.startsWith('if (globalThis.__bdgStalls)') ? ['stop'] : [];
    });
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

/** A read the page never answers */
const NO_ANSWER = Symbol('no answer');

/**
 * Effects without the page's work.
 *
 * @param collected - Collected effects
 * @returns The effects alone
 */
function effectsOnly(collected: CollectedEffects): Omit<CollectedEffects, 'work'> {
  const { work: _work, ...effects } = collected;
  return effects;
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
    assert.deepEqual(
      effectsOnly(
        await quiet.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: false })
      ),
      {}
    );
    quiet.dispose();

    const fresh = { ...QUIET, href: 'https://a.test/next', fresh: true };
    const cdp = new FakeCdp(Promise.resolve(START), [fresh]);
    const watch = watchActionEffects(cdp.connection);
    const response = { type: 'Document', loaderId: 'L2', response: { status: 200 } };
    cdp.emit('Network.responseReceived', response);
    cdp.emit('Page.frameNavigated', { frame: MAIN_FRAME });
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
    });
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
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: true,
    });
    assert.deepEqual(effectsOnly(effects), {
      navigation: { url: 'https://a.test/next', sameDocument: false },
    });
    assert.equal(effects.work?.unresponsive, true, 'a snapshot unanswered means a busy page');
    assert.deepEqual(cdp.readsSent, [], 'no read without a snapshot');
    watch.dispose();
    assert.ok(cdp.stopSent, 'the stop follows a snapshot that may still run');
  });

  void it('skips reading while a main-frame load is pending', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [QUIET]);
    const watch = watchActionEffects(cdp.connection);
    await tick();
    cdp.emit('Page.frameStartedLoading', { frameId: 'main' });
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: true,
    });
    assert.deepEqual(effectsOnly(effects), {});
    assert.equal(effects.work?.navigating, true);
    assert.equal(effects.work?.unresponsive, false);
    assert.deepEqual(cdp.readsSent, []);
    watch.dispose();
  });

  void it('claims no effect only when the second look is still quiet', async () => {
    const quiet = new FakeCdp(Promise.resolve(START), [QUIET, QUIET]);
    const none = watchActionEffects(quiet.connection);
    assert.deepEqual(
      effectsOnly(
        await none.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: true })
      ),
      {
        effect: 'none',
      }
    );
    assert.deepEqual(quiet.readsSent, [false, true]);

    const late = new FakeCdp(Promise.resolve(START), [QUIET, { ...QUIET, changes: 1 }]);
    const changed = watchActionEffects(late.connection);
    assert.deepEqual(
      effectsOnly(
        await changed.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: true })
      ),
      {}
    );

    const logging = new FakeCdp(Promise.resolve(START), [QUIET, QUIET]);
    const logged = watchActionEffects(logging.connection);
    assert.deepEqual(
      effectsOnly(
        await logged.collect({ dialogs: 0, consoleMessages: () => 2, detectNoEffect: true })
      ),
      {},
      'console messages logged by the action are an effect'
    );
  });

  void it('stops listening on dispose, and stops the page watch unless a read did', async () => {
    const stopped = new FakeCdp(Promise.resolve(START), [QUIET, QUIET]);
    const watch = watchActionEffects(stopped.connection);
    await watch.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: true });
    watch.dispose();
    assert.equal(stopped.listening, 0);
    assert.equal(stopped.stopSent, false);

    const unread = new FakeCdp(Promise.resolve(START), [{ ...QUIET, changes: 2 }]);
    const other = watchActionEffects(unread.connection);
    await other.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: true });
    other.dispose();
    assert.equal(unread.listening, 0);
    assert.equal(unread.stopSent, true);
  });

  void it('lists shown elements when asked', async () => {
    const shown = [{ text: 'Saves a draft', element: 'div#tip' }];
    const cdp = new FakeCdp(Promise.resolve(START), [{ ...QUIET, changes: 1, shown }]);
    const watch = watchActionEffects(cdp.connection);
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
      reportShown: true,
    });
    assert.deepEqual(effects.shown, shown);
    assert.ok(cdp.expressions.some((e) => e.endsWith('(false, true)')));
    watch.dispose();
  });

  void it('marks a page that did not answer before the read as busy, without reading', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [QUIET], true, false);
    const watch = watchActionEffects(cdp.connection);
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
    });
    assert.equal(effects.work?.unresponsive, true);
    assert.equal(cdp.readsSent.length, 0);
    watch.dispose();
  });

  void it('marks a page whose read got no answer as busy', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [NO_ANSWER]);
    const watch = watchActionEffects(cdp.connection);
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: true,
    });
    assert.equal(effects.work?.unresponsive, true);
    assert.equal(effects.effect, undefined);
    watch.dispose();
  });

  void it("creates bdg's world when the watch starts, before the action", async () => {
    const cdp = new FakeCdp(Promise.resolve(START));
    const watch = watchActionEffects(cdp.connection);
    await tick();
    assert.ok(cdp.methods.includes('Page.createIsolatedWorld'));
    watch.dispose();
  });

  void it('lets due timers run before each read', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [{ ...QUIET, changes: 1 }]);
    const watch = watchActionEffects(cdp.connection);
    await watch.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: false });
    const timers = cdp.expressions.findIndex((e) => e.includes('setTimeout(resolve, 0)'));
    const read = cdp.expressions.findIndex((e) => e.includes('const scrolled'));
    assert.ok(timers !== -1 && timers < read);
    watch.dispose();
  });

  void it('reads a page whose timers do not run without calling it busy', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [{ ...QUIET, changes: 1 }], false);
    const watch = watchActionEffects(cdp.connection);
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
      detectUnsettled: true,
    });
    assert.equal(effects.work?.unresponsive, false);
    assert.equal(cdp.readsSent.length, 1);
    watch.dispose();
  });

  void it('looks again at a busy DOM and reports it changing only if it kept changing', async () => {
    const busy = {
      ...QUIET,
      changes: 5,
      settle: { burstAges: [120, 30], loading: null },
    };
    const kept = { ...busy, settle: { ...busy.settle, burstAges: [300, 150, 40] } };
    const calm = { ...busy, settle: { ...busy.settle, burstAges: [400, 290] } };
    for (const [recheck, expected] of [
      [kept, true],
      [calm, false],
    ] as const) {
      const cdp = new FakeCdp(Promise.resolve(START), [busy, recheck]);
      const watch = watchActionEffects(cdp.connection);
      const effects = await watch.collect({
        dialogs: 0,
        consoleMessages: () => 0,
        detectNoEffect: true,
        detectUnsettled: true,
      });
      assert.equal(effects.work?.domChanging, expected);
      assert.deepEqual(cdp.readsSent, [false, false]);
      watch.dispose();
    }

    const once = new FakeCdp(Promise.resolve(START), [
      { ...busy, settle: { ...busy.settle, burstAges: [30] } },
    ]);
    const single = watchActionEffects(once.connection);
    await single.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
      detectUnsettled: true,
    });
    assert.deepEqual(once.readsSent, [false], 'one render needs no second look');
    single.dispose();
  });

  void it('reports a page changing every 130 ms as changing, and one that stopped as settled', async () => {
    const read = (burstAges: number[]): unknown => ({
      ...QUIET,
      changes: burstAges.length,
      settle: { burstAges, loading: null },
    });
    const first = read([135, 5]);
    for (const [recheck, expected, label] of [
      [read([390, 260, 130]), true, 'one new burst 130 ms after the last, 130 ms ago'],
      [read([395, 265, 215]), false, 'stopped 215 ms before the second look'],
      [read([390, 260]), false, 'no new burst'],
    ] as const) {
      const cdp = new FakeCdp(Promise.resolve(START), [first, recheck]);
      const watch = watchActionEffects(cdp.connection);
      const effects = await watch.collect({
        dialogs: 0,
        consoleMessages: () => 0,
        detectNoEffect: false,
        detectUnsettled: true,
      });
      assert.equal(effects.work?.domChanging, expected, label);
      assert.equal(cdp.readsSent.length, 2, label);
      watch.dispose();
    }
  });

  void it('does not count a stall between the steps as quiet time (#531)', async () => {
    const read = (at: number, burstAges: number[]): unknown => ({
      ...QUIET,
      changes: burstAges.length,
      settle: { at, burstAges, loading: null },
    });
    const first = read(1000, [155, 105, 55, 5]);
    const recheck = read(1254, [410, 355, 304, 250, 7]);
    const longTask: Array<[number, number]> = [[1064, 1244]];
    for (const [stalls, expected, label] of [
      [longTask, true, 'a 180 ms stall between the steps'],
      [[], false, 'no stall: quiet for 243 ms'],
      [
        [
          [1064, 1300],
          [1260, 1290],
        ],
        true,
        'cut off at the read; a later stall dropped',
      ],
    ] as const) {
      const cdp = new FakeCdp(Promise.resolve(START), [first, recheck], true, true, [[], stalls]);
      const watch = watchActionEffects(cdp.connection);
      const effects = await watch.collect({
        dialogs: 0,
        consoleMessages: () => 0,
        detectNoEffect: false,
        detectUnsettled: true,
      });
      assert.equal(effects.work?.domChanging, expected, label);
      watch.dispose();
      await tick();
      assert.deepEqual(cdp.stallScripts, ['start', 'read', 'read', 'stop'], label);
    }
  });

  void it('reads stalls at the second look even when the bursts the first saw left the window', async () => {
    const read = (at: number, burstAges: number[]): unknown => ({
      ...QUIET,
      changes: burstAges.length,
      settle: { at, burstAges, loading: null },
    });
    const first = read(1000, [450, 400]);
    const recheck = read(1254, [704, 654, 10]);
    const stalls = [[[610, 1000]], [[610, 1244]]];
    const cdp = new FakeCdp(Promise.resolve(START), [first, recheck], true, true, stalls);
    const watch = watchActionEffects(cdp.connection);
    const effects = await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
      detectUnsettled: true,
    });
    assert.equal(effects.work?.domChanging, true, 'one long task from the first look to the step');
    watch.dispose();
    await tick();
    assert.deepEqual(cdp.stallScripts, ['start', 'read', 'read', 'stop']);
  });

  void it('does not stop the stall watch of a document the action navigated away from', async () => {
    const fresh = { ...QUIET, href: 'https://a.test/next', fresh: true };
    const cdp = new FakeCdp(Promise.resolve(START), [fresh]);
    const watch = watchActionEffects(cdp.connection);
    cdp.emit('Page.frameNavigated', { frame: MAIN_FRAME });
    await watch.collect({ dialogs: 0, consoleMessages: () => 0, detectNoEffect: false });
    await tick();
    const worldsMade = cdp.methods.filter((m) => m === 'Page.getFrameTree').length;
    watch.dispose();
    await tick();
    assert.deepEqual(cdp.stallScripts, ['start'], 'its watch went with the document');
    assert.equal(
      cdp.methods.filter((m) => m === 'Page.getFrameTree').length,
      worldsMade,
      'no world made to stop it'
    );
  });

  void it('reads no stalls after a read with too few bursts to look busy', async () => {
    const cdp = new FakeCdp(Promise.resolve(START), [
      { ...QUIET, changes: 1, settle: { at: 1000, burstAges: [30], loading: null } },
    ]);
    const watch = watchActionEffects(cdp.connection);
    await watch.collect({
      dialogs: 0,
      consoleMessages: () => 0,
      detectNoEffect: false,
      detectUnsettled: true,
    });
    watch.dispose();
    await tick();
    assert.deepEqual(cdp.stallScripts, ['start', 'stop']);
  });
});
