/**
 * Interactions run one at a time and report the dialogs they caused.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createInteractionRunner, type TabReports } from '@/daemon/session/interactions.js';
import type { OpenedTab, TabClosedSwitch } from '@/ipc/protocol/tabTypes.js';
import { UNBIND_TARGET_SCRIPT } from '@/runtime/dom/targetNode.js';

/** What the stub's page scripts evaluate to */
interface PageReplies {
  /** Snapshot before the action */
  start?: unknown;
  /** Read after the action */
  read?: unknown;
}

/**
 * CDP stub recording page scripts; the effect snapshots evaluate to the
 * given replies (to nothing by default).
 *
 * @param replies - Values of the effect scripts
 * @returns Stub
 */
function fakeCdp(replies: PageReplies = {}): CDPConnection & { expressions: string[] } {
  const expressions: string[] = [];
  const valueOf = (expression: string): unknown => {
    if (expression.includes('new MutationObserver')) return replies.start;
    if (expression.includes('const scrolled')) return replies.read;
    return undefined;
  };
  return {
    expressions,
    send: (_method: string, params?: { expression?: string }) => {
      if (!params?.expression) return Promise.resolve({});
      expressions.push(params.expression);
      return Promise.resolve({ result: { value: valueOf(params.expression) } });
    },
    on: () => () => undefined,
  } as unknown as CDPConnection & { expressions: string[] };
}

/**
 * Resolve after a macrotask turn.
 *
 * @param ms - Delay in milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void describe('createInteractionRunner', () => {
  void it('runs a second interaction only after the first finished', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp();
    const order: string[] = [];

    await Promise.all([
      interact(cdp, async () => {
        order.push('first:start');
        await delay(20);
        order.push('first:end');
        return { success: true };
      }),
      interact(cdp, () => {
        order.push('second:start');
        return Promise.resolve({ success: true });
      }),
    ]);

    assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
  });

  void it('keeps running after a failed interaction', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp();

    await assert.rejects(interact(cdp, () => Promise.reject(new Error('boom'))));
    assert.deepEqual(await interact(cdp, () => Promise.resolve({ success: true })), {
      success: true,
    });
  });

  void it('adds the dialogs opened during the interaction and unbinds the target', async () => {
    const store = new TelemetryStore();
    store.recordDialog({ type: 'alert', message: 'before', answer: 'accepted' });
    const interact = createInteractionRunner(store);
    const cdp = fakeCdp();

    const result = await interact(cdp, () => {
      store.recordDialog({ type: 'confirm', message: 'Sure?', answer: 'accepted' });
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(result.dialogs, [{ type: 'confirm', message: 'Sure?', answer: 'accepted' }]);
    assert.ok(cdp.expressions.includes(UNBIND_TARGET_SCRIPT));
  });

  void it('adds the URL change and the messages that appeared', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const cdp = fakeCdp({
      start: { href: 'https://todo.test/#/', messages: [] },
      read: {
        href: 'https://todo.test/#/active',
        fresh: false,
        changes: 3,
        messages: [{ id: 1, text: 'Saved', element: 'div.toast' }],
      },
    });

    const result = await interact(cdp, () => Promise.resolve({ success: true }));

    assert.deepEqual(result.navigation, { url: 'https://todo.test/#/active', sameDocument: true });
    assert.deepEqual(result.messages, [{ text: 'Saved', element: 'div.toast' }]);
    assert.equal(result.effect, undefined);
  });

  void it('reports no effect only when asked to and nothing changed', async () => {
    const quiet = {
      start: { href: 'https://shop.test/', messages: [] },
      read: { href: 'https://shop.test/', fresh: false, changes: 0, messages: [] },
    };
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const detected = await interact(fakeCdp(quiet), action, { detectNoEffect: true });
    assert.equal(detected.effect, 'none');
    assert.equal((await interact(fakeCdp(quiet), action)).effect, undefined);
    const failed = await interact(fakeCdp(quiet), () => Promise.resolve({ success: false }), {
      detectNoEffect: true,
    });
    assert.equal(failed.effect, undefined);
  });

  void it('says the page was still changing only when asked to', async () => {
    const waiting = {
      start: { href: 'https://shop.test/', messages: [] },
      read: {
        href: 'https://shop.test/',
        fresh: false,
        changes: 0,
        messages: [],
        settle: { burstAges: [], loading: 'div.spinner' },
      },
    };
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const detected = await interact(fakeCdp(waiting), action, { detectUnsettled: true });
    assert.equal(detected.settled, false);
    assert.deepEqual(detected.pending, { loading: 'div.spinner' });
    const plain = await interact(fakeCdp(waiting), action);
    assert.equal(plain.settled, undefined);
    assert.equal('work' in plain, false, 'the page work stays internal');
  });

  void it('adds the console errors logged during the interaction', async () => {
    const store = new TelemetryStore();
    const onLoad = { type: 'error' as const, text: 'on load', timestamp: Date.now() };
    store.receiveConsoleMessage()(onLoad);
    store.consoleMessages.push(onLoad);
    const interact = createInteractionRunner(store);
    const throwing = (): Promise<{ success: boolean }> => {
      const thrown = {
        type: 'error' as const,
        text: 'Uncaught Error: handler exploded',
        timestamp: Date.now(),
      };
      store.receiveConsoleMessage()(thrown);
      store.consoleMessages.push(thrown);
      return Promise.resolve({ success: true });
    };

    const result = await interact(fakeCdp(), throwing);
    assert.deepEqual(result.errors, [{ text: 'Uncaught Error: handler exploded', count: 1 }]);
    assert.equal(result.moreErrors, undefined);
    assert.equal((await interact(fakeCdp(), throwing, { reportEffects: false })).errors, undefined);
  });

  void it('reports nothing when effects are off or the page could not be read', async () => {
    const interact = createInteractionRunner(new TelemetryStore());
    const action = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });

    const off = fakeCdp({ start: { href: 'a', messages: [] } });
    assert.deepEqual(await interact(off, action, { reportEffects: false }), { success: true });
    assert.ok(!off.expressions.some((expression) => expression.includes('MutationObserver')));
    assert.deepEqual(await interact(fakeCdp(), action, { detectNoEffect: true }), {
      success: true,
    });
  });

  void it('answers dialogs as the interaction chose only while it runs', async () => {
    const store = new TelemetryStore();
    const interact = createInteractionRunner(store);
    const cdp = fakeCdp();
    const replies: Array<{ accept: boolean }> = [];
    const answer = async (): Promise<{ success: boolean }> => {
      await delay(10);
      replies.push(store.dialogAnswers.reply('confirm'));
      return { success: true };
    };

    await Promise.all([
      interact(cdp, answer),
      interact(cdp, answer, { dialogs: { dialog: 'dismiss' } }),
      interact(cdp, answer),
    ]);
    await assert.rejects(
      interact(cdp, () => Promise.reject(new Error('boom')), { dialogs: { dialog: 'dismiss' } })
    );

    assert.deepEqual(replies, [{ accept: true }, { accept: false }, { accept: true }]);
    assert.deepEqual(
      store.dialogAnswers.reply('confirm'),
      { accept: true },
      'reset after a failure'
    );
  });
});

void describe('createInteractionRunner tab reports', () => {
  /** The tab a popup closed back to */
  const opener = { index: 0, targetId: 'A', url: 'https://app.test/', title: 'App' };
  /** A popup that closed */
  const popup = { targetId: 'P', url: 'https://idp.test/authorize', title: 'Sign in' };

  /**
   * Tab reports backed by plain lists.
   *
   * @param state - What the session knows
   * @returns Reports
   */
  function fakeTabs(state: {
    opened: OpenedTab[];
    switches: TabClosedSwitch[];
    lost?: CDPConnection;
  }): TabReports {
    let reported = 0;
    return {
      openedCount: () => state.opened.length,
      openedSince: (mark) => state.opened.slice(mark),
      takeClosedSwitch: () => {
        if (reported === state.switches.length) return undefined;
        reported = state.switches.length;
        return state.switches.at(-1);
      },
      pageLost: (cdp) => (cdp === state.lost ? Promise.resolve() : undefined),
    };
  }

  void it('adds the tabs and windows opened during the interaction', async () => {
    const state = { opened: [] as OpenedTab[], switches: [] as TabClosedSwitch[] };
    state.opened.push({ url: 'https://app.test/old', targetId: 'O', kind: 'tab', index: 1 });
    const interact = createInteractionRunner(new TelemetryStore(), fakeTabs(state));
    const opened: OpenedTab = {
      url: 'https://idp.test/authorize',
      targetId: 'P',
      kind: 'popup',
      index: 2,
    };

    const result = await interact(fakeCdp(), () => {
      state.opened.push(opened);
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(result.opened, [opened]);
    assert.equal(
      (await interact(fakeCdp(), () => Promise.resolve({ success: true }))).opened,
      undefined
    );
  });

  void it('reports a switch after the session tab closed once, in the next action', async () => {
    const state = {
      opened: [] as OpenedTab[],
      switches: [{ tabClosed: popup, switchedTo: opener }],
    };
    const interact = createInteractionRunner(new TelemetryStore(), fakeTabs(state));

    const first = await interact(fakeCdp(), () => Promise.resolve({ success: true }));
    const second = await interact(fakeCdp(), () => Promise.resolve({ success: true }));

    assert.deepEqual(first.tabClosed, popup);
    assert.deepEqual(first.switchedTo, opener);
    assert.equal(second.tabClosed, undefined);
  });

  void it('succeeds with the switch when its tab closed during the interaction', async () => {
    const cdp = fakeCdp();
    const state = { opened: [] as OpenedTab[], switches: [] as TabClosedSwitch[], lost: cdp };
    const interact = createInteractionRunner(new TelemetryStore(), fakeTabs(state));

    const result = await interact(cdp, (): Promise<{ success: boolean }> => {
      state.switches.push({ tabClosed: popup, switchedTo: opener });
      return Promise.reject(new Error('WebSocket connection closed'));
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.tabClosed, popup);
    assert.deepEqual(result.switchedTo, opener);
  });

  void it('waits for the switch when its tab closed as the interaction returned', async () => {
    const cdp = fakeCdp();
    const state = { opened: [] as OpenedTab[], switches: [] as TabClosedSwitch[] };
    const tabs = fakeTabs(state);
    const interact = createInteractionRunner(new TelemetryStore(), {
      ...tabs,
      pageLost: (lost) =>
        lost === cdp
          ? delay(10).then(() => void state.switches.push({ tabClosed: popup, switchedTo: opener }))
          : undefined,
    });

    const result = await interact(cdp, () => Promise.resolve({ success: true }));

    assert.deepEqual(result.tabClosed, popup);
  });

  void it('still fails when the connection was lost without a switch', async () => {
    const cdp = fakeCdp();
    const state = { opened: [] as OpenedTab[], switches: [] as TabClosedSwitch[], lost: cdp };
    const interact = createInteractionRunner(new TelemetryStore(), fakeTabs(state));

    await assert.rejects(
      interact(cdp, () => Promise.reject(new Error('WebSocket connection closed'))),
      /connection closed/
    );
  });
});

void describe('TelemetryStore.recordDialog', () => {
  void it('also lists the dialog among console messages', () => {
    const store = new TelemetryStore();
    store.activeTelemetry = ['console'];
    store.recordDialog({ type: 'alert', message: 'Saved', answer: 'accepted' });
    store.recordDialog({ type: 'confirm', message: 'Sure?', answer: 'dismissed' });
    assert.deepEqual(
      store.consoleMessages.map((message) => message.text),
      ['alert() dialog accepted: "Saved"', 'confirm() dialog dismissed: "Sure?"']
    );
  });

  void it('leaves console messages alone when console telemetry is off', () => {
    const store = new TelemetryStore();
    store.recordDialog({ type: 'alert', message: 'Saved', answer: 'accepted' });
    assert.equal(store.consoleMessages.length, 0);
    assert.equal(store.dialogs.length, 1);
  });
});
