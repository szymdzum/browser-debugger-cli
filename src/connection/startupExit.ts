/**
 * Notice when Chrome exits while bdg waits for its debugging port.
 *
 * chrome-launcher only polls the port (about 25 s) and then reports a refused
 * connection, which reads like a port conflict. Chrome that exits right away
 * (an unknown flag taken as a URL, a profile already open in another Chrome)
 * says why on stderr: that is reported instead, as soon as it exits.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ChildProcess } from 'child_process';

import { ChromeLaunchError } from '@/connection/errors.js';

/** How often to look for the spawned Chrome process */
const PROCESS_POLL_MS = 100;

/** Lines of Chrome's output kept for the error */
const OUTPUT_LINES = 5;

/** Chrome's output when another Chrome already has the profile open */
const PROFILE_IN_USE_PATTERN =
  /existing browser session|profile appears to be in use|ProcessSingleton/i;

/** Chrome's log files in the profile directory, and their size before the launch */
export interface StartupLogs {
  files: Array<{ file: string; offset: number }>;
}

/**
 * Remember where Chrome's logs end before the launch, so only this launch's
 * output is reported.
 *
 * @param userDataDir - Chrome profile directory
 * @returns Log positions
 */
export function markStartupLogs(userDataDir: string): StartupLogs {
  return {
    files: ['chrome-err.log', 'chrome-out.log'].map((name) => {
      const file = path.join(userDataDir, name);
      return { file, offset: fs.existsSync(file) ? fs.statSync(file).size : 0 };
    }),
  };
}

/**
 * Chrome's output since {@link markStartupLogs}, last lines first trimmed.
 *
 * @param logs - Log positions
 * @returns Up to {@link OUTPUT_LINES} non-empty lines
 */
function readStartupOutput(logs: StartupLogs): string[] {
  const lines = logs.files.flatMap(({ file, offset }) => {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').slice(offset).split('\n');
  });
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-OUTPUT_LINES);
}

/**
 * Reject when the launched Chrome exits before it is ready.
 *
 * @param getProcess - Returns the spawned process once chrome-launcher has it
 * @param logs - Log positions from before the launch
 * @param userDataDir - Chrome profile directory (named in the error)
 * @returns A promise that only rejects, and a function to stop watching
 */
export function watchStartupExit(
  getProcess: () => ChildProcess | undefined,
  logs: StartupLogs,
  userDataDir: string
): { exited: Promise<never>; stop: () => void } {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const exited = new Promise<never>((_resolve, reject) => {
    const attach = (): void => {
      if (stopped) return;
      const child = getProcess();
      if (!child) {
        timer = setTimeout(attach, PROCESS_POLL_MS);
        return;
      }
      const report = (code: number | null): void => {
        if (!stopped) reject(startupExitError(code, readStartupOutput(logs), userDataDir));
      };
      if (child.exitCode !== null || child.signalCode !== null) report(child.exitCode);
      else child.once('exit', report);
    };
    attach();
  });
  exited.catch(() => undefined);
  return {
    exited,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * The error for a Chrome that exited during startup.
 *
 * @param exitCode - Chrome's exit code
 * @param output - Chrome's last output lines
 * @param userDataDir - Chrome profile directory
 * @returns Launch error with a structured issue
 */
function startupExitError(
  exitCode: number | null,
  output: string[],
  userDataDir: string
): ChromeLaunchError {
  const profileInUse = output.some((line) => PROFILE_IN_USE_PATTERN.test(line));
  return new ChromeLaunchError(`Chrome exited during startup (exit code ${exitCode ?? 'none'})`, {
    issue: {
      code: 'CHROME_EXITED_DURING_STARTUP',
      context: { exitCode, output, userDataDir, profileInUse },
    },
  });
}
