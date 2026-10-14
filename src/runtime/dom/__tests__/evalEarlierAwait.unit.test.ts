/**
 * An interrupted eval behind an earlier one that only awaits a promise is
 * stopped at once (#729), while an earlier eval still running its
 * synchronous part keeps its script (#724).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';
import { wrapEvalScript } from '@/runtime/dom/evalSource.js';

/** A script that waits for a timer */
const AWAIT_TIMER = 'await new Promise((r) => setTimeout(r, 10000))';
/** A script that keeps the page busy */
const LOOP = 'while (Date.now() < end) {}';
/** A script that keeps the page busy, then waits for a promise */
const LOOP_THEN_AWAIT = 'while (Date.now() < end) {} await next';
/** A busy loop with `await` only in a string */
const LOOP_WITH_AWAIT_STRING = "while (Date.now() < end) {}; 'await'";

/** Answer of a terminated script */
const TERMINATED = {
  result: { type: 'object', subtype: 'error' },
  exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: terminated' } },
};

/** Answer of a script that finished */
const DONE = { result: { type: 'number', value: 1 } };

/** A command waiting for the page's thread */
/** What the eval sends before and after a script */
const [WRAPPER_START = '', WRAPPER_END = ''] = wrapEvalScript('SCRIPT').split('SCRIPT');

/**
 * The user's script in the expression an eval sent.
 *
 * @param expression - Sent `Runtime.evaluate` expression
 * @returns The script
 */
function scriptOf(expression: string): string {
  return expression.slice(WRAPPER_START.length, expression.length - WRAPPER_END.length);
}

interface Queued {
  expression: string;
  resolve: (value: unknown) => void;
}

/**
 * A page with one thread: a busy script holds every later evaluation until
 * it ends or `Runtime.terminateExecution` stops it; an awaiting script
 * leaves the thread free and answers when the test settles it.
 */
class MainThreadPage {
  readonly sent: string[] = [];
  private readonly queue: Queued[] = [];
  private running: Queued | undefined;
  private readonly waiting = new Map<string, (value: unknown) => void>();

  /**
   * Answer a CDP command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns The answer
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sent.push(method);
    if (method === 'Runtime.terminateExecution') {
      this.end(TERMINATED);
      return Promise.resolve({});
    }
    if (method !== 'Runtime.evaluate') return Promise.resolve({});
    return new Promise((resolve) => {
      this.queue.push({ expression: scriptOf(String(params['expression'])), resolve });
      this.run();
    });
  }

  /** Whether a busy script holds the thread */
  get busy(): boolean {
    return this.running !== undefined;
  }

  /** The running script's synchronous part ends on its own */
  finishSyncPart(): void {
    this.end(undefined);
  }

  /** The running script ends on its own and answers */
  finishScript(): void {
    this.end(DONE);
  }

  /**
   * Answer an awaiting script.
   *
   * @param expression - The script
   */
  settle(expression: string): void {
    this.waiting.get(expression)?.(DONE);
    this.waiting.delete(expression);
  }

  /**
   * End the running script.
   *
   * @param answer - Its answer, or undefined when it goes on awaiting
   */
  private end(answer: unknown): void {
    const running = this.running;
    this.running = undefined;
    if (!running) return;
    if (answer === undefined) this.waiting.set(running.expression, running.resolve);
    else running.resolve(answer);
    this.run();
  }

  /** Run queued commands until a busy script holds the thread */
  private run(): void {
    while (!this.running && this.queue.length > 0) {
      const next = this.queue.shift() as Queued;
      if (next.expression.startsWith('while')) this.running = next;
      else if (next.expression.includes('await')) this.waiting.set(next.expression, next.resolve);
      else next.resolve(DONE);
    }
  }
}

/**
 * Let pending promise callbacks and I/O callbacks run.
 *
 * @returns Resolves on the next turn of the event loop
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Time within which an interrupted script must be stopped (its deadline is 20 s) */
const STOPPED_WITHIN_MS = 5_000;

/**
 * Start an eval from a client that can disconnect.
 *
 * @param page - The page
 * @param script - The script
 * @returns The eval and its client
 */
function startEval(
  page: MainThreadPage,
  script: string
): { done: Promise<unknown>; client: AbortController } {
  const client = new AbortController();
  const done = evaluateScript(page as unknown as CDPConnection, script, {
    abandoned: client.signal,
  });
  done.catch(() => undefined);
  return { done, client };
}

/**
 * Wait until a promise settles.
 *
 * @param work - The promise
 * @returns Milliseconds it took
 */
async function msUntilSettled(work: Promise<unknown>): Promise<number> {
  const startedAt = Date.now();
  await work.then(
    () => undefined,
    () => undefined
  );
  return Date.now() - startedAt;
}

void describe('evaluateScript interrupted behind an earlier eval', () => {
  void it('stops a busy script at once when the earlier eval only awaits and its client left', async () => {
    const page = new MainThreadPage();
    const awaiting = startEval(page, AWAIT_TIMER);
    await nextTurn();
    awaiting.client.abort();
    await nextTurn();
    const loop = startEval(page, LOOP);
    await nextTurn();
    assert.ok(page.busy);
    loop.client.abort();
    const ms = await msUntilSettled(loop.done);
    assert.ok(ms < STOPPED_WITHIN_MS, `the loop was stopped after ${ms} ms`);
    assert.ok(page.sent.includes('Runtime.terminateExecution'), page.sent.join(', '));
    page.settle(AWAIT_TIMER);
    await awaiting.done.catch(() => undefined);
  });

  void it('stops a busy script at once when the earlier eval only awaits and its client is connected', async () => {
    const page = new MainThreadPage();
    const awaiting = startEval(page, AWAIT_TIMER);
    await nextTurn();
    const loop = startEval(page, LOOP);
    await nextTurn();
    loop.client.abort();
    const ms = await msUntilSettled(loop.done);
    assert.ok(ms < STOPPED_WITHIN_MS, `the loop was stopped after ${ms} ms`);
    page.settle(AWAIT_TIMER);
    assert.deepEqual(await awaiting.done, { value: 1, type: 'number' });
  });

  void it("leaves a connected earlier eval's synchronous part alone, then stops the interrupted one", async () => {
    const page = new MainThreadPage();
    const earlier = startEval(page, LOOP_THEN_AWAIT);
    await nextTurn();
    const loop = startEval(page, LOOP);
    await nextTurn();
    loop.client.abort();
    await nextTurn();
    assert.ok(!page.sent.includes('Runtime.terminateExecution'), page.sent.join(', '));
    page.finishSyncPart();
    const ms = await msUntilSettled(loop.done);
    assert.ok(ms < STOPPED_WITHIN_MS, `the loop was stopped after ${ms} ms`);
    page.settle(LOOP_THEN_AWAIT);
    assert.deepEqual(await earlier.done, { value: 1, type: 'number' });
  });

  void it('stops an interrupted script still in its synchronous part before its await while another eval waits', async () => {
    const page = new MainThreadPage();
    const awaiting = startEval(page, AWAIT_TIMER);
    await nextTurn();
    const loop = startEval(page, LOOP_THEN_AWAIT);
    await nextTurn();
    assert.ok(page.busy);
    loop.client.abort();
    const ms = await msUntilSettled(loop.done);
    assert.ok(ms < STOPPED_WITHIN_MS, `the loop was stopped after ${ms} ms`);
    page.settle(AWAIT_TIMER);
    assert.deepEqual(await awaiting.done, { value: 1, type: 'number' });
  });

  void it("leaves a later client's loop alone when an interrupted script already waits at its await", async () => {
    const page = new MainThreadPage();
    const waiting = startEval(page, LOOP_THEN_AWAIT);
    await nextTurn();
    const later = startEval(page, LOOP);
    await nextTurn();
    page.finishSyncPart();
    await nextTurn();
    assert.ok(page.busy);
    const sentBeforeInterrupt = page.sent.length;
    waiting.client.abort();
    await nextTurn();
    assert.ok(
      !page.sent.slice(sentBeforeInterrupt).includes('Runtime.terminateExecution'),
      page.sent.join(', ')
    );
    page.finishScript();
    assert.deepEqual(await later.done, { value: 1, type: 'number' });
    page.settle(LOOP_THEN_AWAIT);
    await waiting.done.catch(() => undefined);
  });

  void it("stops a busy script with 'await' only in a string while another client's eval waits", async () => {
    const page = new MainThreadPage();
    const loop = startEval(page, LOOP_WITH_AWAIT_STRING);
    await nextTurn();
    const other = startEval(page, '1 + 1');
    await nextTurn();
    loop.client.abort();
    const ms = await msUntilSettled(loop.done);
    assert.ok(ms < STOPPED_WITHIN_MS, `the loop was stopped after ${ms} ms`);
    assert.deepEqual(await other.done, { value: 1, type: 'number' });
  });
});
