/**
 * `dom inspect` reads an element's matched rules once per document state:
 * repeat reads reuse the answer (or the request still running), a document
 * whose rules took too long for the hints is remembered until the next
 * navigation, and stylesheet or DOM changes drop the remembered answers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { matchedStyles } from '@/runtime/dom/inspectRules.js';
import { delay } from '@/utils/async.js';

/** A fake CDP connection that answers matched-styles requests after a delay */
interface FakeCdp {
  cdp: CDPConnection;
  /** Node ids of the matched-styles requests, in the order sent */
  sent: number[];
  /** Fire an event (on the root session unless a session id is given) */
  emit: (event: string, params?: unknown, sessionId?: string) => void;
  /** Milliseconds before an answer */
  answerMs: number;
  /** Requests still unanswered */
  pending: () => number;
}

/**
 * A fake CDP connection.
 *
 * @param answerMs - Milliseconds before each `CSS.getMatchedStylesForNode` answer
 * @returns Fake
 */
function fakeCdp(answerMs: number): FakeCdp {
  const handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();
  let running = 0;
  const fake: FakeCdp = {
    sent: [],
    answerMs,
    pending: () => running,
    emit: (event, params = {}, sessionId) =>
      handlers.get(event)?.forEach((handler) => handler(params, sessionId)),
    cdp: {
      send: async (method: string, params: { nodeId: number }) => {
        assert.equal(method, 'CSS.getMatchedStylesForNode');
        fake.sent.push(params.nodeId);
        running++;
        await delay(fake.answerMs);
        running--;
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

void describe('matchedStyles', () => {
  void it('reuses the answer for the same element', async () => {
    const fake = fakeCdp(5);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 500)), 7);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 500)), 7);
    assert.deepEqual(fake.sent, [7]);
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

  void it('skips the hint read on a document whose rules took too long', async () => {
    const fake = fakeCdp(150);
    assert.equal(await matchedStyles(fake.cdp, 7, 30, { skipWhenSlow: true }), 'timeout');
    const started = Date.now();
    assert.equal(await matchedStyles(fake.cdp, 8, 30, { skipWhenSlow: true }), 'skipped');
    assert.equal(await matchedStyles(fake.cdp, 7, 30, { skipWhenSlow: true }), 'skipped');
    assert.ok(Date.now() - started < 20, 'the skip does not wait');
    assert.deepEqual(fake.sent, [7]);
  });

  void it('serves the hints from an answer that arrived after the budget', async () => {
    const fake = fakeCdp(60);
    assert.equal(await matchedStyles(fake.cdp, 7, 20, { skipWhenSlow: true }), 'timeout');
    await delay(60);
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 20, { skipWhenSlow: true })), 7);
    assert.deepEqual(fake.sent, [7]);
  });

  void it('still reads the rules when asked for, on a slow document', async () => {
    const fake = fakeCdp(60);
    assert.equal(await matchedStyles(fake.cdp, 7, 20, { skipWhenSlow: true }), 'timeout');
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 8, 500)), 8);
    assert.deepEqual(fake.sent, [7, 8]);
  });

  void it('forgets the slow document after a navigation', async () => {
    const fake = fakeCdp(60);
    assert.equal(await matchedStyles(fake.cdp, 7, 20, { skipWhenSlow: true }), 'timeout');
    await delay(60);
    fake.emit('DOM.documentUpdated');
    fake.answerMs = 5;
    assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 500, { skipWhenSlow: true })), 7);
    assert.deepEqual(fake.sent, [7, 7]);
  });

  for (const event of [
    'CSS.styleSheetAdded',
    'CSS.styleSheetChanged',
    'CSS.styleSheetRemoved',
    'DOM.attributeModified',
    'DOM.childNodeInserted',
  ]) {
    void it(`reads the rules again after ${event}`, async () => {
      const fake = fakeCdp(5);
      await matchedStyles(fake.cdp, 7, 500);
      fake.emit(event);
      assert.equal(answeredFor(await matchedStyles(fake.cdp, 7, 500)), 7);
      assert.deepEqual(fake.sent, [7, 7]);
    });
  }

  void it('ignores events of other sessions (iframes)', async () => {
    const fake = fakeCdp(5);
    await matchedStyles(fake.cdp, 7, 500);
    fake.emit('CSS.styleSheetChanged', {}, 'child-session');
    fake.emit('DOM.documentUpdated', {}, 'child-session');
    await matchedStyles(fake.cdp, 7, 500);
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
    const fake = fakeCdp(1);
    for (const nodeId of [1, 2, 3, 4, 5, 6]) await matchedStyles(fake.cdp, nodeId, 500);
    await matchedStyles(fake.cdp, 6, 500);
    await matchedStyles(fake.cdp, 1, 500);
    assert.deepEqual(fake.sent, [1, 2, 3, 4, 5, 6, 1]);
  });
});
