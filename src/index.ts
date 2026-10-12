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

import { reportInterruptsUntilHandedOver } from '@/commands/shared/interrupt.js';
import { interruptReporter } from '@/commands/shared/interruptReport.js';
import { isJsonMode } from '@/utils/cliArgs.js';

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

reportInterruptsUntilHandedOver(interruptReporter(isJsonMode()));
holdStartupForTest('load');
const { runCli } = await import('./cli.js');
holdStartupForTest('run');
await pollOnce();
runCli();
