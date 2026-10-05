/**
 * `bdg dom wait` against a fake page: retries after navigations, invalid
 * selectors, timeouts and lost connections.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CDPConnectionError, CDPProtocolError } from '@/connection/errors.js';
import { CommandError } from '@/errors/index.js';
import { waitForCondition } from '@/runtime/dom/wait.js';
import type { WaitSnapshot } from '@/runtime/dom/waitCondition.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** One answer of the fake page: a snapshot, a page exception, or a CDP error */
type Answer = WaitSnapshot | { exception: string } | Error;

/**
 * A snapshot (nothing matches, page complete, first document).
 *
 * @param overrides - Fields to set
 * @returns Snapshot
 */
function snapshot(overrides: Partial<WaitSnapshot> = {}): WaitSnapshot {
  return {
    count: 0,
    textCount: 0,
    visibleCount: 0,
    readyState: 'complete',
    documentId: 1,
    ...overrides,
  };
}

/**
 * Fake CDP answering `Runtime.evaluate` with the given answers in turn
 * (the last one repeats), each after 10 ms like a page.
 *
 * @param answers - Answers in order
 * @returns Stub and the number of calls made
 */
function fakePage(answers: Answer[]): { cdp: CDPSender; calls: () => number } {
  let calls = 0;
  const send = async (): Promise<unknown> => {
    const answer = answers[Math.min(calls++, answers.length - 1)];
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (answer instanceof Error) throw answer;
    if (answer && 'exception' in answer) {
      return {
        result: { type: 'object' },
        exceptionDetails: { text: 'Uncaught', exception: { description: answer.exception } },
      };
    }
    return { result: { value: answer } };
  };
  return { cdp: { send }, calls: () => calls };
}

void describe('waitForCondition', () => {
  void it('retries when a navigation destroyed the page context', async () => {
    const page = fakePage([
      new CDPProtocolError('Execution context was destroyed.', -32000, undefined),
      snapshot({ count: 1, textCount: 1, visibleCount: 1 }),
    ]);
    const data = await waitForCondition(page.cdp, { selector: '#a', timeout: 2000 });
    assert.equal(data.count, 1);
    assert.equal(page.calls(), 2);
  });

  void it('exits 81 for an invalid selector', async () => {
    const page = fakePage([
      {
        exception:
          "SyntaxError: Failed to execute 'querySelectorAll' on 'Document': '[[x' is not a valid selector.",
      },
    ]);
    await assert.rejects(
      waitForCondition(page.cdp, { selector: '[[x', timeout: 2000 }),
      (error: unknown) =>
        error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_ARGUMENTS
    );
  });

  void it('exits 102 with what it saw last when the time runs out', async () => {
    const page = fakePage([snapshot({ count: 2, textCount: 2 })]);
    await assert.rejects(
      waitForCondition(page.cdp, { selector: '#a', visible: true, timeout: 200 }),
      (error: unknown) =>
        error instanceof CommandError &&
        error.exitCode === EXIT_CODES.CDP_TIMEOUT &&
        /Timed out after 200ms .*\(last seen: 2 matches, none visible\)/.test(error.message)
    );
  });

  void it('rethrows a lost connection instead of waiting for the timeout', async () => {
    const lost = new CDPConnectionError('WebSocket is not open');
    const page = fakePage([lost]);
    const started = Date.now();
    await assert.rejects(waitForCondition(page.cdp, { selector: '#a', timeout: 5000 }), lost);
    assert.ok(Date.now() - started < 1000);
    assert.equal(page.calls(), 1);
  });

  void it('--gone does not count the empty document right after a navigation', async () => {
    const page = fakePage([
      snapshot({ count: 1, textCount: 1 }),
      snapshot({ readyState: 'loading', documentId: 2 }),
      snapshot({ count: 1, textCount: 1, readyState: 'interactive', documentId: 2 }),
    ]);
    await assert.rejects(
      waitForCondition(page.cdp, { selector: '#spinner', gone: true, timeout: 300 }),
      (error: unknown) => error instanceof CommandError && error.exitCode === EXIT_CODES.CDP_TIMEOUT
    );
  });

  void it('--gone is met by two settled snapshots of one document', async () => {
    const page = fakePage([snapshot({ count: 1, textCount: 1 }), snapshot({ documentId: 2 })]);
    const data = await waitForCondition(page.cdp, {
      selector: '#spinner',
      gone: true,
      timeout: 2000,
    });
    assert.equal(data.count, 0);
    assert.equal(page.calls(), 3);
  });
});
