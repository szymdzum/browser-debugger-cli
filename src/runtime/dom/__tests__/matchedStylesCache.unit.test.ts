/**
 * `dom inspect` reads an element's matched rules sparingly: a request still
 * running is shared, a slow answer is reused briefly, one request runs at a
 * time, a document whose rules outlast the hint budget is remembered, and
 * navigations, stylesheet and DOM changes drop what was kept (page-changing
 * commands: `matchedStylesReset.unit.test.ts`).
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { matchedStylesRead } from '@/runtime/dom/inspect.js';
import { matchedStyles, resetMatchedStyles } from '@/runtime/dom/inspectRules.js';
import { formatInspect } from '@/ui/formatters/inspect.js';
import { delay } from '@/utils/async.js';

/** An answer slow enough to be kept (over 300 ms) */
const SLOW_MS = 350;

/** An answer too slow to clear the slow mark (over the 1 s hint budget) */
const VERY_SLOW_MS = 1100;

/** A fake CDP connection that answers matched-styles requests after a delay */
interface FakeCdp {
  cdp: CDPConnection;
  /** Node ids of the matched-styles requests, in the order sent */
  sent: number[];
  /** Fire an event (on the root session unless a session id is given) */
  emit: (event: string, params?: unknown, sessionId?: string) => void;
  /** Milliseconds before an answer; `never` for no answer */
  answerMs: number | 'never';
}

/**
 * A fake CDP connection.
 *
 * @param answerMs - Milliseconds before each `CSS.getMatchedStylesForNode` answer
 * @returns Fake
 */
function fakeCdp(answerMs: number | 'never'): FakeCdp {
  const handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();
  const fake: FakeCdp = {
    sent: [],
    answerMs,
    emit: (event, params = {}, sessionId) =>
      handlers.get(event)?.forEach((handler) => handler(params, sessionId)),
    cdp: {
      send: async (method: string, params: { nodeId: number }) => {
        assert.equal(method, 'CSS.getMatchedStylesForNode');
        fake.sent.push(params.nodeId);
        const wait = fake.answerMs;
        if (wait === 'never') return new Promise(() => undefined);
        await delay(wait);
        return { matchedCSSRules: [], inlineStyle: { nodeId: params.nodeId } };
      },
      on: (event: string, handler: (params: unknown, sessionId?: string) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        return () => undefined;
      },
    } as unknown as CDPConnection,
  };
  return fake;
}

/**
 * Node id a response was read for (the fake echoes it in the inline style).
 *
 * @param response - Matched styles or why they are missing
 * @returns Node id, or the reason
 */
function answeredFor(response: Awaited<ReturnType<typeof matchedStyles>>): number | string {
  if (typeof response === 'string') return response;
  return (response.inlineStyle as unknown as { nodeId: number }).nodeId;
}

/**
 * Mark the fake's document slow: a hint read that outlasts its budget.
 *
 * @param fake - Fake CDP (its answers must take longer than 20 ms)
 * @param nodeId - Element to read
 */
async function markSlow(fake: FakeCdp, nodeId = 7): Promise<void> {
  assert.equal(await matchedStyles(fake.cdp, nodeId, 20, { skipWhenSlow: true }), 'timeout');
}

void describe('matchedStyles', () => {
  void it('reuses a slow answer for the same element', async () => {
    const fake = fakeCdp(SLOW_MS);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 2000)), 7);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 2000)), 7);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('reads a fast answer again (cheap, and page state may have changed)', async () => {
    const fake = fakeCdp(5);
    await matchedStyles(fake.cdp, 7, 500);
    await matchedStyles(fake.cdp, 7, 500);
    assert.deepEqual(fake.sent, [7, 7]);
  });

  void it('reads again once a kept answer is 5 s old', async () => {
    const fake = fakeCdp(SLOW_MS);
    await matchedStyles(fake.cdp, 7, 2000);
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 5001 });
    try {
      await matchedStyles(fake.cdp, 7, 2000);
    } finally {
      mock.timers.reset();
    }
    assert.deepEqual(fake.sent, [7, 7]);
  });

  void it('shares a request that is still running for the same element', async () => {
    const fake = fakeCdp(30);
    const answers = await Promise.all([
      matchedStyles(fake.cdp, 7, 500),
      matchedStyles(fake.cdp, 7, 500),
    ]);
    assert.deepEqual(answers.map(answeredFor), [7, 7]);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('sends one request at a time per document', async () => {
    const fake = fakeCdp(30);
    const first = matchedStyles(fake.cdp, 7, 500);
    const second = matchedStyles(fake.cdp, 8, 500);
    await delay(10);
    assert.deepEqual(fake.sent, [7]);
    assert.deepEqual([await first, await second].map(answeredFor), [7, 8]);
    assert.deepEqual(fake.sent, [7, 8]);
  });

  void it('gives up without sending when the running request outlasts the budget', async () => {
    const fake = fakeCdp(150);
    const first = matchedStyles(fake.cdp, 7, 500);
    assert.equal(await matchedStyles(fake.cdp, 8, 30), 'timeout');
    await first;
    await delay(20);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('does not mark the document slow for waiting behind another element', async () => {
    const fake = fakeCdp(150);
    const first = matchedStyles(fake.cdp, 7, 2000);
    assert.equal(await matchedStyles(fake.cdp, 8, 30, { skipWhenSlow: true }), 'timeout');
    assert.equal(await matchedStyles(fake.cdp, 9, 30, { skipWhenSlow: true }), 'timeout');
    await first;
  });

  void it('skips the hint read on a document marked slow, without waiting', async () => {
    const fake = fakeCdp(VERY_SLOW_MS);
    await markSlow(fake);
    const started = Date.now();
    assert.equal(await matchedStyles(fake.cdp, 8, 1000, { skipWhenSlow: true }), 'skipped');
    assert.equal(await matchedStyles(fake.cdp, 7, 1000, { skipWhenSlow: true }), 'skipped');
    assert.ok(Date.now() - started < 20, 'the skip does not wait');
    assert.deepEqual(fake.sent, [7]);
  });

  void it('stays slow when the answer took longer than the hint budget', async () => {
    const fake = fakeCdp(VERY_SLOW_MS);
    await markSlow(fake);
    await delay(VERY_SLOW_MS);
    assert.equal(await matchedStyles(fake.cdp, 8, 1000, { skipWhenSlow: true }), 'skipped');
  });

  void it('clears the slow mark when a read comes within the hint budget', async () => {
    const fake = fakeCdp(60);
    await markSlow(fake);
    assert.equal(await matchedStyles(fake.cdp, 8, 1000, { skipWhenSlow: true }), 'skipped');
    await delay(60);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 8, 1000, { skipWhenSlow: true })), 8);
  });

  void it('serves the hints from a slow answer that arrived after the budget', async () => {
    const fake = fakeCdp(SLOW_MS);
    await markSlow(fake);
    await delay(SLOW_MS);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 20, { skipWhenSlow: true })), 7);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('still reads the rules when asked for, on a slow document', async () => {
    const fake = fakeCdp(SLOW_MS);
    await markSlow(fake);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 8, 5000)), 8);
    assert.deepEqual(fake.sent, [7, 8]);
  });

  void it('forgets the slow mark after a navigation', async () => {
    const fake = fakeCdp(VERY_SLOW_MS);
    await markSlow(fake);
    fake.emit('DOM.documentUpdated');
    fake.answerMs = 5;
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 500, { skipWhenSlow: true })), 7);
    assert.deepEqual(fake.sent, [7, 7]);
  });

  void it('does not hold a new document back behind a hung request of the old one', async () => {
    const fake = fakeCdp('never');
    assert.equal(await matchedStyles(fake.cdp, 7, 20), 'timeout');
    fake.emit('DOM.documentUpdated');
    fake.answerMs = 5;
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 8, 100)), 8);
  });

  void it('forgets the slow mark after a stylesheet change', async () => {
    const fake = fakeCdp(VERY_SLOW_MS);
    await markSlow(fake);
    fake.emit('CSS.styleSheetChanged');
    assert.notEqual(await matchedStyles(fake.cdp, 8, 20, { skipWhenSlow: true }), 'skipped');
  });

  for (const event of [
    'CSS.styleSheetAdded',
    'CSS.styleSheetChanged',
    'CSS.styleSheetRemoved',
    'DOM.attributeModified',
    'DOM.childNodeInserted',
  ]) {
    void it(`reads the rules again after ${event}`, async () => {
      const fake = fakeCdp(SLOW_MS);
      await matchedStyles(fake.cdp, 7, 2000);
      fake.emit(event);
      assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 2000)), 7);
      assert.deepEqual(fake.sent, [7, 7]);
    });
  }

  void it('reads the rules again after resetMatchedStyles', async () => {
    const fake = fakeCdp(SLOW_MS);
    await matchedStyles(fake.cdp, 7, 2000);
    resetMatchedStyles(fake.cdp);
    await matchedStyles(fake.cdp, 7, 2000);
    assert.deepEqual(fake.sent, [7, 7]);
  });

  void it('ignores events of other sessions (iframes)', async () => {
    const fake = fakeCdp(SLOW_MS);
    await matchedStyles(fake.cdp, 7, 2000);
    fake.emit('CSS.styleSheetChanged', {}, 'child-session');
    fake.emit('DOM.documentUpdated', {}, 'child-session');
    await matchedStyles(fake.cdp, 7, 2000);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('asks again after a failed read', async () => {
    let calls = 0;
    const cdp = {
      send: () => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error('No node with given id found'))
          : Promise.resolve({} as Protocol.CSS.GetMatchedStylesForNodeResponse);
      },
      on: () => () => undefined,
    } as unknown as CDPConnection;
    assert.equal(await matchedStyles(cdp, 7, 500), 'failed');
    assert.equal(typeof (await matchedStyles(cdp, 7, 500)), 'object');
    assert.equal(calls, 2);
  });

  void it('keeps only a few answers', async () => {
    const fake = fakeCdp(SLOW_MS);
    for (const nodeId of [1, 2, 3, 4, 5]) await matchedStyles(fake.cdp, nodeId, 2000);
    await matchedStyles(fake.cdp, 5, 2000);
    await matchedStyles(fake.cdp, 1, 2000);
    assert.deepEqual(fake.sent, [1, 2, 3, 4, 5, 1]);
  });
});

void describe('matchedStylesRead', () => {
  void it('gives the default hints 1 s and skips them on a slow document', () => {
    assert.deepEqual(matchedStylesRead({ selector: 'a' }), { budgetMs: 1000, skipWhenSlow: true });
  });

  void it('gives --rules and --why 5 s, also on a slow document', () => {
    const explicit = { budgetMs: 5000, skipWhenSlow: false };
    assert.deepEqual(matchedStylesRead({ selector: 'a', rules: true }), explicit);
    assert.deepEqual(matchedStylesRead({ selector: 'a', why: 'color' }), explicit);
    assert.deepEqual(matchedStylesRead({ selector: 'a', rules: true, props: ['color'] }), explicit);
  });

  void it('does not read them for --no-hints, --props or --all', () => {
    assert.equal(matchedStylesRead({ selector: 'a', hints: false }), undefined);
    assert.equal(matchedStylesRead({ selector: 'a', props: ['color'] }), undefined);
    assert.equal(matchedStylesRead({ selector: 'a', all: true }), undefined);
  });
});

void describe('skipped hints in the output', () => {
  void it('say so once, in one short line', () => {
    const output = formatInspect({
      selector: 'main',
      count: 1,
      index: 0,
      element: 'main',
      visibility: {},
      cascade: 'skipped',
    });
    const lines = output.split('\n').filter((line) => /hints/.test(line));
    assert.deepEqual(lines, [
      "hints skipped: this page's stylesheets are slow to read (--rules waits 5 s)",
    ]);
  });
});
