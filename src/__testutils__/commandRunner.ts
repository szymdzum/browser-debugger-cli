/**
 * Command runner for smoke tests.
 *
 * Executes bdg CLI commands in a subprocess and captures output.
 * WHY: Enables end-to-end testing of CLI commands without mocking.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ensureTestSessionDir, getTestHomeDir } from './testHome.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Run a bdg CLI command in a subprocess.
 *
 * @param command - Command name (e.g., 'start', 'stop', 'peek')
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Promise resolving to command result
 *
 * @example
 * ```typescript
 * const result = await runCommand('start', ['http://localhost:3000']);
 * assert.equal(result.exitCode, 0);
 * ```
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: {
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): Promise<CommandResult> {
  const { timeout = 30000, env = {} } = options;

  // Path to compiled CLI entry point (ESM module compatibility)
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.resolve(currentFileDir, '../../dist/index.js');
  const testSessionDir = ensureTestSessionDir();
  const testHomeDir = getTestHomeDir();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn('node', [cliPath, command, ...args], {
      env: {
        ...process.env,
        BDG_SESSION_DIR: testSessionDir,
        HOME: testHomeDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        error,
      });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        resolve({
          exitCode: 124, // Timeout exit code
          stdout,
          stderr: stderr + '\nCommand timed out',
        });
      } else {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      }
    });
  });
}

/**
 * Run command and parse JSON output from stdout.
 *
 * @param command - Command name
 * @param args - Command arguments
 * @returns Parsed JSON output
 *
 * @example
 * ```typescript
 * const data = await runCommandJSON('peek');
 * assert.ok(data.data.network.length > 0);
 * ```
 */
export async function runCommandJSON<T = unknown>(
  command: string,
  args: string[] = []
): Promise<T> {
  const result = await runCommand(command, args);

  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Failed to parse JSON: ${result.stdout}`);
  }
}
