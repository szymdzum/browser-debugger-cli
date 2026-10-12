/**
 * Ctrl-C and SIGTERM: every command run by `CommandRunner` reports them
 * ({@link reportInterrupts}: the `--json` envelope or one line, exit 130 or
 * 143); a command that cancels its daemon request instead of dying
 * mid-request reports them itself ({@link abortOnInterrupt}).
 */

import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Signals that interrupt a command */
export type InterruptSignal = 'SIGINT' | 'SIGTERM';

/** Both interrupt signals */
const INTERRUPT_SIGNALS: readonly InterruptSignal[] = ['SIGINT', 'SIGTERM'];

/**
 * The exit code of an interrupted command, as shells expect.
 *
 * @param signal - The signal
 * @returns 130 for SIGINT, 143 for SIGTERM
 */
export function interruptExitCode(signal: InterruptSignal): number {
  return signal === 'SIGINT' ? EXIT_CODES.INTERRUPTED : EXIT_CODES.TERMINATED;
}

/**
 * The signal that aborted an interrupt, from its reason.
 *
 * @param interrupt - Aborted interrupt (reason: the signal name)
 * @returns The signal, SIGINT unless it was SIGTERM
 */
export function interruptSignal(interrupt: AbortSignal): InterruptSignal {
  return interrupt.reason === 'SIGTERM' ? 'SIGTERM' : 'SIGINT';
}

/**
 * Abort on Ctrl-C or SIGTERM (reason: the signal name). A second signal
 * exits at once.
 *
 * @returns Aborted on the first signal
 */
export function abortOnInterrupt(): AbortSignal {
  const interrupt = new AbortController();
  for (const signal of INTERRUPT_SIGNALS) {
    onOwnInterrupt(signal, () => {
      if (interrupt.signal.aborted) process.exit(interruptExitCode(signal));
      interrupt.abort(signal);
    });
  }
  return interrupt.signal;
}

/** Listeners of commands that report their own interrupt */
const ownListeners = new WeakSet<() => void>();

/**
 * Handle a signal in a command that reports its own interrupt (an error that
 * says what it did, a follow mode's stop line): while the listener is
 * installed, {@link reportInterrupts} leaves the signal to it.
 *
 * @param signal - The signal
 * @param listener - Its handler
 */
export function onOwnInterrupt(signal: InterruptSignal, listener: () => void): void {
  ownListeners.add(listener);
  process.on(signal, listener);
}

/**
 * Whether a command reports this signal itself ({@link onOwnInterrupt}).
 *
 * @param signal - The signal
 * @returns True while such a listener is installed
 */
function reportedByCommand(signal: InterruptSignal): boolean {
  return process.listeners(signal).some((listener) => ownListeners.has(listener as () => void));
}

/**
 * Report Ctrl-C or SIGTERM for the duration of a command: the first signal
 * is reported once and exits 130 (143); a second one, should the first
 * still be handled, exits at once without a second report. A command that
 * reports its own interrupt ({@link onOwnInterrupt}) is left to do it.
 *
 * @param report - Prints the interrupt (synchronously)
 * @returns Removes the listeners, once the command has its result
 */
export function reportInterrupts(report: (signal: InterruptSignal) => void): () => void {
  let reported = false;
  const listeners = INTERRUPT_SIGNALS.map((signal) => {
    const listener = (): void => {
      if (reportedByCommand(signal)) return;
      if (!reported) {
        reported = true;
        report(signal);
      }
      process.exit(interruptExitCode(signal));
    };
    process.on(signal, listener);
    return { signal, listener };
  });
  return () => {
    for (const { signal, listener } of listeners) process.removeListener(signal, listener);
  };
}

/**
 * Wait for work unless interrupted first: the first signal ends the wait at
 * once with the interrupted error (the work is left to the exiting process).
 *
 * @param work - Work to wait for
 * @param interrupt - Aborted on Ctrl-C or SIGTERM (reason: the signal)
 * @param interruptedError - The error for an interrupt by a signal
 * @returns The work's value
 * @throws The interrupted error once interrupted, else the work's error
 */
export async function unlessInterrupted<T>(
  work: Promise<T>,
  interrupt: AbortSignal,
  interruptedError: (signal: InterruptSignal) => Error
): Promise<T> {
  const fail = (): Error => interruptedError(interruptSignal(interrupt));
  if (interrupt.aborted) throw fail();
  let onAbort = (): void => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(fail());
    interrupt.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, interrupted]);
  } catch (error) {
    if (interrupt.aborted) throw fail();
    throw error;
  } finally {
    interrupt.removeEventListener('abort', onAbort);
  }
}
