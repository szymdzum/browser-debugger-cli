/**
 * Ctrl-C and SIGTERM for a command that cancels its daemon request instead
 * of dying mid-request, so it can still report (the `--json` envelope) and
 * exit with the shell's code.
 */

import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Signals that interrupt a command */
export type InterruptSignal = 'SIGINT' | 'SIGTERM';

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
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interrupt.signal.aborted) process.exit(interruptExitCode(signal));
      interrupt.abort(signal);
    });
  }
  return interrupt.signal;
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
