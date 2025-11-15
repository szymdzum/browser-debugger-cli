/**
 * Worker Launcher - Spawns worker process and waits for ready signal
 *
 * This module provides the `launchSessionInWorker()` function that:
 * 1. Spawns the worker process with JSON config as argv
 * 2. Waits for worker_ready signal on stdout
 * 3. Returns worker and Chrome metadata
 * 4. Handles spawn errors and timeouts
 */

import { spawn, type ChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { TelemetryType } from '@/types.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  daemonSpawningWorker,
  daemonWorkerSpawned,
  daemonWorkerReady,
  daemonParseError,
} from '@/ui/messages/debug.js';
import { filterDefined } from '@/utils/objects.js';
import { validateUrl } from '@/utils/url.js';

const log = createLogger('daemon');

/**
 * Type guard to validate worker_ready message structure.
 */
function isWorkerReadyMessage(obj: unknown): obj is {
  type: 'worker_ready';
  workerPid: number;
  chromePid: number;
  port: number;
  target: { url: string; title?: string };
} {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  if (!('type' in obj && obj.type === 'worker_ready')) {
    return false;
  }
  return (
    'workerPid' in obj &&
    typeof obj.workerPid === 'number' &&
    'chromePid' in obj &&
    typeof obj.chromePid === 'number' &&
    'port' in obj &&
    typeof obj.port === 'number' &&
    'target' in obj &&
    typeof obj.target === 'object' &&
    obj.target !== null &&
    'url' in obj.target
  );
}

/**
 * Worker metadata returned from successful launch.
 */
export interface WorkerMetadata {
  workerPid: number;
  chromePid: number;
  port: number;
  targetUrl: string;
  targetTitle?: string;
  workerProcess: ChildProcess; // Keep reference for IPC communication
}

/**
 * Options for launching a worker session.
 */
export interface LaunchWorkerOptions {
  port?: number;
  timeout?: number;
  telemetry?: TelemetryType[];
  includeAll?: boolean;
  userDataDir?: string;
  maxBodySize?: number;
  headless?: boolean;
  chromeWsUrl?: string;
}

/**
 * Error thrown when worker fails to start.
 */
export class WorkerStartError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'SPAWN_FAILED'
      | 'READY_TIMEOUT'
      | 'WORKER_CRASH'
      | 'INVALID_READY_MESSAGE',
    public readonly details?: string
  ) {
    super(message);
    this.name = 'WorkerStartError';
  }
}

/**
 * Launch a new worker process and wait for ready signal.
 *
 * @param url - Target URL to navigate to
 * @param options - Worker configuration options
 * @returns Worker metadata from ready signal
 * @throws WorkerStartError if worker fails to start
 */
export async function launchSessionInWorker(
  url: string,
  options: LaunchWorkerOptions = {}
): Promise<WorkerMetadata> {
  // Validate URL (P1 Fix #3)
  const validation = validateUrl(url);
  if (!validation.valid) {
    throw new WorkerStartError(
      validation.error ?? 'Invalid URL',
      'SPAWN_FAILED',
      validation.suggestion
    );
  }

  // Use filterDefined to build config, automatically omitting undefined values
  const config = filterDefined({
    url,
    port: options.port ?? 9222,
    timeout: options.timeout,
    telemetry: options.telemetry,
    includeAll: options.includeAll,
    userDataDir: options.userDataDir,
    maxBodySize: options.maxBodySize,
    headless: options.headless,
    chromeWsUrl: options.chromeWsUrl,
  });

  // Resolve worker script path
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const workerPath = join(currentDir, 'worker.js');

  log.debug(daemonSpawningWorker(workerPath, config));

  // Spawn worker process
  let worker: ChildProcess;
  try {
    worker = spawn('node', [workerPath, JSON.stringify(config)], {
      stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin for IPC
      detached: true,
      env: process.env,
    });
  } catch (error) {
    throw new WorkerStartError(
      'Failed to spawn worker process',
      'SPAWN_FAILED',
      getErrorMessage(error)
    );
  }

  if (worker.pid) {
    log.debug(daemonWorkerSpawned(worker.pid));
  }

  // Wait for worker_ready signal
  return new Promise<WorkerMetadata>((resolve, reject) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let resolved = false;

    // Timeout for ready signal (40 seconds)
    // Must exceed DEFAULT_PAGE_READINESS_TIMEOUT_MS (30s) + Chrome launch time (~2s) + buffer
    const readyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        worker.kill('SIGKILL');
        reject(
          new WorkerStartError(
            'Worker did not send ready signal within 40 seconds',
            'READY_TIMEOUT',
            `stderr: ${stderrBuffer}`
          )
        );
      }
    }, 40000);

    // Handle stdout (ready signal)
    if (worker.stdout) {
      worker.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf-8');

        // Look for complete JSONL message (ends with newline)
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed: unknown = JSON.parse(line);

            if (!isWorkerReadyMessage(parsed)) {
              // Not a worker_ready message, might be a log line
              continue;
            }

            if (!resolved) {
              resolved = true;
              clearTimeout(readyTimeout);

              log.debug(daemonWorkerReady(parsed.workerPid, parsed.chromePid));

              // NOTE: Don't unref() - we need to keep the worker reference for IPC
              // Worker continues running as detached process

              resolve({
                workerPid: parsed.workerPid,
                chromePid: parsed.chromePid,
                port: parsed.port,
                targetUrl: parsed.target.url,
                ...(parsed.target.title && { targetTitle: parsed.target.title }),
                workerProcess: worker, // Return worker process for IPC
              });
            }
          } catch (error) {
            log.debug(daemonParseError(line));
            log.debug(`JSON parse error: ${getErrorMessage(error)}`);
          }
        }
      });
    }

    // Handle stderr (log messages)
    if (worker.stderr) {
      worker.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8');
        // Forward worker stderr to daemon stderr
        process.stderr.write(chunk);
      });
    }

    // Handle worker exit
    worker.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        reject(
          new WorkerStartError(
            `Worker process exited before sending ready signal (code: ${code}, signal: ${signal})`,
            'WORKER_CRASH',
            `stderr: ${stderrBuffer}`
          )
        );
      }
    });

    // Handle spawn errors
    worker.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        reject(new WorkerStartError('Worker process spawn error', 'SPAWN_FAILED', error.message));
      }
    });
  });
}
