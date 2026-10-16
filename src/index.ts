#!/usr/bin/env node
/**
 * Entry point. Reports Ctrl-C and SIGTERM from the first moment (exit 130 or
 * 143, with the `--json` envelope or one line on stderr, as an interrupted
 * command does), then loads and runs the CLI (`src/cli.ts`, its own bundle).
 * Loading it takes most of startup, and a signal in that time used to kill
 * bdg with no output (#686). The first SIGINT or SIGTERM listener anything
 * installs (`runCommand`, a follow mode, a start) takes both signals over.
 */

import * as fs from 'fs';
import { fileURLToPath } from 'url';

import { reportInterruptsUntilHandedOver } from '@/commands/shared/interrupt.js';
import { interruptReporter } from '@/commands/shared/interruptReport.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder, stringifyEnvelope } from '@/ui/OutputBuilder.js';
import { createLogger, enableDebugLogging } from '@/ui/logging/index.js';
import { cliLoadFailedError } from '@/ui/messages/commands.js';
import { flagArgs, isJsonMode } from '@/utils/cliArgs.js';
import { getErrorMessage } from '@/utils/errors.js';
import { enableBdgCompileCache } from '@/utils/compileCache.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('bdg');

/** Test-only: where startup holds (see {@link holdStartupForTest}) */
const STARTUP_GATE_ENV = 'BDG_TEST_STARTUP_GATE';

/** Points of startup a test can hold: before the CLI loads, or once it has */
type StartupPoint = 'load' | 'run';

/**
 * Test-only startup gate, inert unless `BDG_TEST_STARTUP_GATE` names this
 * point: writes one byte to fd 3 (the test's "ready" pipe), then blocks
 * until a byte arrives on stdin (polling while stdin is non-blocking). A test signals bdg between the two, so the
 * signal lands at a known point of startup without a timed delay.
 *
 * @param point - The point of startup reached
 */
function holdStartupForTest(point: StartupPoint): void {
  if (process.env[STARTUP_GATE_ENV] !== point) return;
  fs.writeSync(3, 'r');
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      fs.readSync(0, Buffer.alloc(1));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
}

/**
 * Let the event loop poll once (two turns of `setImmediate` have a poll
 * phase between them): a signal that came while the CLI loaded
 * synchronously reaches its listener only in a poll phase, and a command
 * that ends without one would exit as if it had never come.
 *
 * @returns Resolves after a poll phase
 */
async function pollOnce(): Promise<void> {
  for (let turn = 0; turn < 2; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Report a CLI bundle that failed to load (missing, or broken by a partial
 * install) and exit 110: one envelope with `--json`, else one line on
 * stderr; the error itself only with `--debug` (or `BDG_DEBUG=1`).
 *
 * @param error - The load error
 */
function reportCliLoadFailure(error: unknown): never {
  if (flagArgs().includes('--debug')) enableDebugLogging();
  log.debug(error instanceof Error && error.stack ? error.stack : getErrorMessage(error));
  const err = cliLoadFailedError(fileURLToPath(new URL('./cli.js', import.meta.url)));
  const exitCode = EXIT_CODES.SOFTWARE_ERROR;
  if (isJsonMode()) {
    const envelope = OutputBuilder.buildJsonError(err.message, {
      suggestion: err.suggestion,
      exitCode,
    });
    console.log(stringifyEnvelope(envelope));
  } else {
    console.error(genericError(`${err.message}. ${err.suggestion}`));
  }
  process.exit(exitCode);
}

/**
 * Load the CLI bundle.
 *
 * @returns Its runner
 */
async function loadCli(): Promise<() => void> {
  try {
    const { runCli } = await import('./cli.js');
    return runCli;
  } catch (error) {
    reportCliLoadFailure(error);
  }
}

enableBdgCompileCache();
reportInterruptsUntilHandedOver(interruptReporter(isJsonMode()));
holdStartupForTest('load');
const runCli = await loadCli();
holdStartupForTest('run');
await pollOnce();
runCli();
