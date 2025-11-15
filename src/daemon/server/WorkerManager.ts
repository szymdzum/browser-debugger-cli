import { EventEmitter } from 'events';

import type { ChildProcess } from 'child_process';

import {
  launchSessionInWorker,
  type WorkerMetadata,
  type LaunchWorkerOptions,
} from '@/daemon/startSession.js';
import type { WorkerIPCResponse } from '@/daemon/workerIpc.js';
import type { WorkerRequestUnion, WorkerResponseUnion } from '@/ipc/index.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';

export type WorkerMessage = WorkerIPCResponse | WorkerResponseUnion;

type WorkerManagerEvents = {
  message: (message: WorkerMessage) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
};

/**
 * Centralizes worker lifecycle management (launch, message parsing, teardown).
 */
export class WorkerManager extends EventEmitter {
  private worker: ChildProcess | null = null;
  private buffer = '';
  private metadata: WorkerMetadata | null = null;
  private readonly log = createLogger('daemon');

  override on<Event extends keyof WorkerManagerEvents>(
    event: Event,
    listener: WorkerManagerEvents[Event]
  ): this {
    return super.on(event, listener);
  }

  override once<Event extends keyof WorkerManagerEvents>(
    event: Event,
    listener: WorkerManagerEvents[Event]
  ): this {
    return super.once(event, listener);
  }

  override off<Event extends keyof WorkerManagerEvents>(
    event: Event,
    listener: WorkerManagerEvents[Event]
  ): this {
    return super.off(event, listener);
  }

  /**
   * Launch a new worker process via launchSessionInWorker().
   */
  async launch(url: string, options: LaunchWorkerOptions = {}): Promise<WorkerMetadata> {
    if (this.worker) {
      throw new Error('Worker already running');
    }

    const metadata = await launchSessionInWorker(url, options);
    this.metadata = metadata;
    this.attachWorker(metadata.workerProcess);
    return metadata;
  }

  /**
   * Write a request to the worker stdin.
   */
  send(request: WorkerRequestUnion): void {
    if (!this.worker?.stdin || this.worker.killed) {
      throw new Error('No active worker process');
    }
    this.worker.stdin.write(JSON.stringify(request) + '\n');
  }

  getWorkerMetadata(): WorkerMetadata | null {
    return this.metadata;
  }

  hasActiveWorker(): boolean {
    return Boolean(this.worker && !this.worker.killed);
  }

  dispose(): void {
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker = null;
    }
    this.metadata = null;
    this.buffer = '';
  }

  private attachWorker(worker: ChildProcess): void {
    this.worker = worker;

    if (!worker.stdout) {
      console.error('[daemon] Worker stdout not available');
    } else {
      worker.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    }

    if (worker.stderr) {
      worker.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
      });
    }

    worker.on('exit', (code, signal) => {
      this.log.info(`[daemon] Worker exited (code: ${code} signal: ${signal ?? 'null'})`);
      this.emit('exit', code, signal);
      this.dispose();
    });

    worker.on('error', (error) => {
      console.error(`[daemon] Worker process error: ${error.message}`);
      this.emit('exit', null, null);
      this.dispose();
    });
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as WorkerMessage;
        this.emit('message', message);
      } catch (error) {
        this.log.debug(`[daemon] Failed to parse worker stdout line: ${getErrorMessage(error)}`);
      }
    }
  }
}
