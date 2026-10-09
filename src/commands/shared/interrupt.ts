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
