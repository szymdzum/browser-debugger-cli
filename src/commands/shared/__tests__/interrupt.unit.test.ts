/**
 * An interrupted command exits as shells expect: 130 for Ctrl-C, 143 for
 * SIGTERM, read from the reason of the aborted interrupt. The first signal
 * aborts (and ends work still pending), a second one exits at once.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  abortOnInterrupt,
  type AbortOnInterruptOptions,
  interruptExitCode,
  onOwnInterrupt,
  reportInterrupts,
  reportInterruptsUntilHandedOver,
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
function installInterrupt(options: AbortOnInterruptOptions = {}): {
  interrupt: AbortSignal;
  dispose: () => void;
  exits: Array<number | undefined>;
} {
  const exits: Array<number | undefined> = [];
  mock.method(process, 'exit', (code?: number) => {
    exits.push(code);
    throw new Exit(code);
  });
  const before = new Map(
    (['SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)])
  );
  const { signal: interrupt, dispose } = abortOnInterrupt(options);
  for (const [signal, listeners] of before) {
    for (const listener of process.listeners(signal)) {
      if (!listeners.includes(listener)) added.push([signal, listener]);
    }
  }
  return { interrupt, dispose, exits };
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

  void it('removes its listeners when disposed, so a later signal is left alone', () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const { dispose, exits } = installInterrupt();
    assert.deepEqual(
      [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')],
      before.map((count) => count + 1)
    );
    dispose();
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
    assert.deepEqual(exits, []);
  });

  void it('hands a second signal to onSecondSignal instead of exiting', () => {
    const seen: string[] = [];
    const { interrupt, exits } = installInterrupt({
      onSecondSignal: (signal) => seen.push(signal),
    });
    process.emit('SIGTERM');
    assert.equal(interrupt.reason, 'SIGTERM');
    process.emit('SIGINT');
    assert.deepEqual(seen, ['SIGINT']);
    assert.deepEqual(exits, []);
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

void describe('reportInterrupts', () => {
  afterEach(() => {
    for (const [signal, listener] of added.splice(0)) process.removeListener(signal, listener);
    mock.restoreAll();
  });

  /**
   * Install {@link reportInterrupts} with `process.exit` mocked.
   *
   * @returns The signals reported, the exit codes asked for, and the remover
   */
  function installReporter(): {
    reported: string[];
    exits: Array<number | undefined>;
    stop: () => void;
  } {
    const reported: string[] = [];
    const exits: Array<number | undefined> = [];
    mock.method(process, 'exit', (code?: number) => {
      exits.push(code);
      throw new Exit(code);
    });
    const stop = reportInterrupts((signal) => reported.push(signal));
    return { reported, exits, stop };
  }

  void it('reports Ctrl-C once and exits 130; a second Ctrl-C exits without a second report', () => {
    const { reported, exits, stop } = installReporter();
    assert.throws(() => process.emit('SIGINT'), Exit);
    assert.throws(() => process.emit('SIGINT'), Exit);
    stop();
    assert.deepEqual(reported, ['SIGINT']);
    assert.deepEqual(exits, [130, 130]);
  });

  void it('reports SIGTERM with exit 143', () => {
    const { reported, exits, stop } = installReporter();
    assert.throws(() => process.emit('SIGTERM'), Exit);
    stop();
    assert.deepEqual(reported, ['SIGTERM']);
    assert.deepEqual(exits, [143]);
  });

  void it('removes its listeners once the command has its result', () => {
    const before = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
    const { stop } = installReporter();
    assert.deepEqual(
      ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)),
      before.map((count) => count + 1)
    );
    stop();
    assert.deepEqual(
      ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)),
      before
    );
  });

  void it('leaves the signal to a command that reports its own interrupt', () => {
    const { reported, exits, stop } = installReporter();
    let own = 0;
    const listener = (): void => {
      own += 1;
    };
    onOwnInterrupt('SIGINT', listener);
    added.push(['SIGINT', listener]);
    process.emit('SIGINT');
    stop();
    assert.equal(own, 1);
    assert.deepEqual(reported, []);
    assert.deepEqual(exits, []);
  });
});

void describe('reportInterruptsUntilHandedOver', () => {
  /** Signals reported and exit codes asked for by the test's reporter */
  let reported: string[];
  let exits: Array<number | undefined>;

  /** Count of SIGINT and SIGTERM listeners */
  const counts = (): number[] =>
    ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));

  /** Listener counts plus the listeners added */
  const plus = (base: number[], more: number[]): number[] =>
    base.map((count, i) => count + (more[i] ?? 0));

  /** Wait for the hand-over, which removes the report on the next tick */
  const nextTick = (): Promise<void> => new Promise((resolve) => process.nextTick(resolve));

  /**
   * Install the startup report with `process.exit` mocked.
   *
   * @returns Listener counts before it was installed
   */
  function installStartupReport(): number[] {
    const before = counts();
    reported = [];
    exits = [];
    mock.method(process, 'exit', (code?: number) => {
      exits.push(code);
      throw new Exit(code);
    });
    reportInterruptsUntilHandedOver((signal) => reported.push(signal));
    return before;
  }

  /**
   * Add a SIGINT or SIGTERM listener (removed after the test).
   *
   * @param signal - The signal
   * @returns The listener's call count
   */
  function addListener(signal: 'SIGINT' | 'SIGTERM'): { calls: number } {
    const seen = { calls: 0 };
    const listener = (): void => {
      seen.calls += 1;
    };
    process.on(signal, listener);
    added.push([signal, listener]);
    return seen;
  }

  afterEach(async () => {
    addListener('SIGINT');
    await nextTick();
    for (const [signal, listener] of added.splice(0)) process.removeListener(signal, listener);
    mock.restoreAll();
  });

  void it('reports a signal that comes before anything else listens', () => {
    installStartupReport();
    assert.throws(() => process.emit('SIGTERM'), Exit);
    assert.deepEqual(reported, ['SIGTERM']);
    assert.deepEqual(exits, [143]);
  });

  void it('hands both signals over to the first other listener, once it is in place', async () => {
    const before = installStartupReport();
    const own = addListener('SIGTERM');
    assert.deepEqual(counts(), plus(before, [1, 2]));
    await nextTick();
    assert.deepEqual(counts(), plus(before, [0, 1]));
    process.emit('SIGTERM');
    process.emit('SIGINT');
    assert.equal(own.calls, 1);
    assert.deepEqual(reported, []);
    assert.deepEqual(exits, []);
  });

  void it('keeps reporting when other events get listeners', async () => {
    const before = installStartupReport();
    const listener = (): void => undefined;
    process.on('SIGHUP', listener);
    process.removeListener('SIGHUP', listener);
    await nextTick();
    assert.deepEqual(counts(), plus(before, [1, 1]));
  });
});
