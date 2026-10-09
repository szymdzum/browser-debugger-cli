/**
 * An interrupted command exits as shells expect: 130 for Ctrl-C, 143 for
 * SIGTERM, read from the reason of the aborted interrupt. The first signal
 * aborts (and ends work still pending), a second one exits at once.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  abortOnInterrupt,
  interruptExitCode,
  interruptSignal,
  unlessInterrupted,
} from '@/commands/shared/interrupt.js';

/** Thrown by the mocked `process.exit` */
class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

/**
 * Install {@link abortOnInterrupt}, with `process.exit` mocked and its
 * listeners removed after the test.
 *
 * @returns The interrupt and the exit codes asked for
 */
function installInterrupt(): { interrupt: AbortSignal; exits: Array<number | undefined> } {
  const exits: Array<number | undefined> = [];
  mock.method(process, 'exit', (code?: number) => {
    exits.push(code);
    throw new Exit(code);
  });
  const before = new Map(
    (['SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)])
  );
  const interrupt = abortOnInterrupt();
  for (const [signal, listeners] of before) {
    for (const listener of process.listeners(signal)) {
      if (!listeners.includes(listener)) added.push([signal, listener]);
    }
  }
  return { interrupt, exits };
}

/** Listeners a test added, removed after it */
const added: Array<[NodeJS.Signals, NodeJS.SignalsListener]> = [];

/**
 * An interrupt aborted by a signal.
 *
 * @param reason - The abort reason
 * @returns Aborted signal
 */
function abortedBy(reason: unknown): AbortSignal {
  const interrupt = new AbortController();
  interrupt.abort(reason);
  return interrupt.signal;
}

void describe('interrupt', () => {
  afterEach(() => {
    for (const [signal, listener] of added.splice(0)) process.removeListener(signal, listener);
    mock.restoreAll();
  });

  void it('aborts on the first Ctrl-C with SIGINT as the reason, and exits 130 on the second', () => {
    const { interrupt, exits } = installInterrupt();
    process.emit('SIGINT');
    assert.equal(interrupt.aborted, true);
    assert.equal(interrupt.reason, 'SIGINT');
    assert.deepEqual(exits, []);
    assert.throws(() => process.emit('SIGINT'), Exit);
    assert.deepEqual(exits, [130]);
  });

  void it('aborts on SIGTERM with SIGTERM as the reason, and exits 143 on the second', () => {
    const { interrupt, exits } = installInterrupt();
    process.emit('SIGTERM');
    assert.equal(interrupt.reason, 'SIGTERM');
    assert.throws(() => process.emit('SIGTERM'), Exit);
    assert.deepEqual(exits, [143]);
  });

  void it('ends work still pending at the first signal with the interrupted error', async () => {
    const interrupt = new AbortController();
    const hanging = new Promise<number>(() => undefined);
    const ended = unlessInterrupted(hanging, interrupt.signal, (signal) => new Error(signal));
    interrupt.abort('SIGTERM');
    await assert.rejects(ended, /SIGTERM/);
  });

  void it('passes on work that ends before any signal', async () => {
    const interrupt = new AbortController();
    const done = unlessInterrupted(Promise.resolve(7), interrupt.signal, () => new Error('no'));
    assert.equal(await done, 7);
  });

  void it('fails at once when already interrupted', async () => {
    const interrupt = new AbortController();
    interrupt.abort('SIGINT');
    const ended = unlessInterrupted(Promise.resolve(7), interrupt.signal, (s) => new Error(s));
    await assert.rejects(ended, /SIGINT/);
  });

  void it('exits 130 for SIGINT and 143 for SIGTERM', () => {
    assert.equal(interruptExitCode('SIGINT'), 130);
    assert.equal(interruptExitCode('SIGTERM'), 143);
  });

  void it('reads the signal from the abort reason, SIGINT unless SIGTERM', () => {
    assert.equal(interruptSignal(abortedBy('SIGTERM')), 'SIGTERM');
    assert.equal(interruptSignal(abortedBy('SIGINT')), 'SIGINT');
    assert.equal(interruptSignal(abortedBy(undefined)), 'SIGINT');
  });
});
