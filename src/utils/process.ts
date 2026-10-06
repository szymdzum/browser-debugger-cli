/**
 * Cross-platform process management utilities.
 *
 * Pure utility functions for process operations - no dependencies on domain modules.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';

import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('chrome');

/**
 * Check if a process with the given PID is alive.
 *
 * Uses signal 0 to check process existence without sending an actual signal.
 * On Windows, falls back to tasklist when the signal check fails.
 *
 * @param pid - Process ID to check
 * @returns True if process is running, false otherwise
 *
 * @example
 * ```typescript
 * if (isProcessAlive(12345)) {
 *   console.log('Process is still running');
 * }
 * ```
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    if (process.platform === 'win32') {
      const result = spawnSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        shell: true,
        encoding: 'utf-8',
      });
      if (result.error) return false;
      const out = (result.stdout || '').trim();
      return out.length > 0 && !/No tasks/i.test(out);
    }
    return false;
  }
}

/**
 * Kill a Chrome process using cross-platform approach.
 *
 * Windows: Uses `taskkill /pid <pid> /T /F` to kill process tree
 * Unix/macOS: Tries to kill process group (-pid). If that fails, falls back to killing the PID.
 *
 * WHY: Chrome spawns multiple child processes. We need to kill the entire process tree.
 *
 * @param pid - Chrome process ID to kill
 * @param signal - Signal to send (Unix only, default 'SIGTERM'). Ignored on Windows.
 * @throws Error if kill operation fails
 *
 * @example
 * ```typescript
 * try {
 *   killChromeProcess(chromePid, 'SIGKILL'); // Force kill
 * } catch (error) {
 *   console.error('Failed to kill Chrome:', error);
 * }
 * ```
 */
export function killChromeProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const result = spawnSync(`taskkill /pid ${pid} /T /F`, {
      shell: true,
      encoding: 'utf-8',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0 && result.status !== null) {
      const errorMsg = (result.stderr ?? result.stdout).trim() || 'Unknown error';
      throw new Error(`taskkill failed (exit code ${result.status}): ${errorMsg}`);
    }

    if (result.stderr?.trim()) {
      log.debug(`taskkill stderr: ${result.stderr.trim()}`);
    }
  } else {
    try {
      process.kill(-pid, signal);
    } catch {
      process.kill(pid, signal);
    }
  }
}

/**
 * Read a process's full command line.
 *
 * Uses `/proc/<pid>/cmdline` where available (Linux, including minimal
 * containers whose BusyBox `ps` lacks `-o`/`-p`), and `ps` elsewhere (macOS).
 *
 * @param pid - Process ID
 * @returns Command line, or null if unavailable (process gone, or unsupported platform)
 */
export function getProcessCommand(pid: number): string | null {
  if (process.platform === 'win32') return null;
  const procCmdline = `/proc/${pid}/cmdline`;
  if (fs.existsSync('/proc/self/cmdline')) {
    try {
      const command = fs.readFileSync(procCmdline, 'utf-8').replace(/\0/g, ' ').trim();
      return command.length > 0 ? command : null;
    } catch {
      return null;
    }
  }
  const result = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], {
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) return null;
  const command = result.stdout.trim();
  return command.length > 0 ? command : null;
}

/** A running process and its command line */
export interface ProcessEntry {
  pid: number;
  command: string;
}

/**
 * Every running process with its command line: from `/proc` on Linux
 * (minimal containers' BusyBox `ps` lacks `-o`), else from `ps` (macOS).
 *
 * @returns Processes, empty when they cannot be listed (Windows)
 */
export function listProcesses(): ProcessEntry[] {
  if (process.platform === 'win32') return [];
  if (fs.existsSync('/proc/self/cmdline')) {
    return fs
      .readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map((name) => ({ pid: Number(name), command: getProcessCommand(Number(name)) ?? '' }))
      .filter((entry) => entry.command !== '');
  }
  const result = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf-8' });
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, command]) => ({ pid: Number(pid), command: command ?? '' }));
}
