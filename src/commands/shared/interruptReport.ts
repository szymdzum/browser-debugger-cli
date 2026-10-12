/**
 * What an interrupted command prints, and the session's move to another tab
 * that a `--json` envelope carries. Kept apart from `CommandRunner` so the
 * entry point can report a signal during startup the same way before the
 * CLI loads.
 */

import { interruptExitCode, type InterruptSignal } from '@/commands/shared/interrupt.js';
import {
  commandInterruptedError,
  commandInterruptedLine,
  type InterruptedWork,
} from '@/errors/messages.js';
import { takeTabMove } from '@/ipc/utils/tabMove.js';
import { OutputBuilder, stringifyEnvelope } from '@/ui/OutputBuilder.js';
import { escapeControlChars } from '@/ui/formatting.js';

/**
 * Add a move of the session to another tab that a daemon response of this
 * command carried (its tab closed on its own and no command reported it
 * yet) to a `--json` envelope: top-level `tabClosed` and `switchedTo`.
 *
 * @param envelope - Response envelope
 * @returns The envelope, with the move when there was one
 */
export function withTabMove<T extends object>(envelope: T): T {
  const moved = takeTabMove();
  return moved ? { ...envelope, ...moved } : envelope;
}

/**
 * Print an interrupted command's error: the `--json` envelope on stdout, or
 * one line on stderr.
 *
 * @param json - Whether `--json` was given
 * @param work - What the command may already have done
 * @returns Prints the error for a signal
 */
export function interruptReporter(
  json: boolean,
  work?: InterruptedWork
): (signal: InterruptSignal) => void {
  return (signal) => {
    const err = commandInterruptedError(work);
    if (!json) {
      console.error(escapeControlChars(commandInterruptedLine(err)));
      return;
    }
    console.log(
      stringifyEnvelope(
        withTabMove(
          OutputBuilder.buildJsonError(err.message, {
            suggestion: err.suggestion,
            exitCode: interruptExitCode(signal),
          })
        )
      )
    );
  };
}
