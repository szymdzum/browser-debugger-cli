import type { CDPTarget, NetworkRequest, ConsoleMessage } from '@/types';
import { writePartialOutputAsync, writeFullOutputAsync } from '@/utils/session.js';

import { OutputBuilder } from './OutputBuilder.js';

/**
 * Interface for accessing session data without direct coupling
 */
export interface PreviewDataSource {
  getTarget: () => CDPTarget;
  getNetworkRequests: () => NetworkRequest[];
  getConsoleLogs: () => ConsoleMessage[];
  isConnected: () => boolean;
}

/**
 * Manages two-tier preview system with async I/O and mutex
 *
 * Periodically writes both lightweight preview and full data files
 * to enable efficient monitoring without stopping collection.
 */
export class PreviewWriter {
  private interval: NodeJS.Timeout | null = null;
  private pendingWrite: Promise<void> | null = null;
  private isWriting = false;

  constructor(
    private dataSource: PreviewDataSource,
    private startTime: number,
    private intervalMs: number = 5000
  ) {}

  /**
   * Start periodic preview writes.
   */
  start(): void {
    this.interval = setInterval(() => {
      this.writePreview();
    }, this.intervalMs);
  }

  /**
   * Stop preview writes and clear interval.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Wait for any in-flight write to complete.
   * Called during shutdown to prevent race conditions.
   */
  async waitForPendingWrite(): Promise<void> {
    if (this.pendingWrite) {
      console.error('Waiting for in-flight write to complete...');
      try {
        await this.pendingWrite;
        console.error('In-flight write completed');
      } catch (error) {
        console.error('Error in pending write (ignoring):', error);
      }
    }
  }

  /**
   * Execute a single preview write cycle (internal)
   */
  private writePreview(): void {
    // Skip if previous write in progress or disconnected
    if (this.isWriting || !this.dataSource.isConnected()) {
      if (this.isWriting) {
        console.error('[PERF] Skipping preview write (previous write still in progress)');
      }
      return;
    }

    this.isWriting = true;

    // Create and track the write promise so shutdown can await it
    this.pendingWrite = this.doWrite()
      .catch((error) => {
        console.error(
          'Warning: Failed to write preview data:',
          error instanceof Error ? error.message : String(error)
        );
      })
      .finally(() => {
        this.isWriting = false;
        this.pendingWrite = null;
      });
  }

  /**
   * Perform the actual write operation (internal)
   */
  private async doWrite(): Promise<void> {
    const target = this.dataSource.getTarget();
    const networkRequests = this.dataSource.getNetworkRequests();
    const consoleLogs = this.dataSource.getConsoleLogs();

    // Build both preview and full outputs
    const previewOutput = OutputBuilder.build({
      mode: 'preview',
      target,
      startTime: this.startTime,
      networkRequests,
      consoleLogs,
    });

    const fullOutput = OutputBuilder.build({
      mode: 'full',
      target,
      startTime: this.startTime,
      networkRequests,
      consoleLogs,
    });

    // Write both files in parallel (async, non-blocking)
    await Promise.all([
      writePartialOutputAsync(previewOutput), // ~500KB - for 'bdg peek'
      writeFullOutputAsync(fullOutput), // ~87MB - for 'bdg details'
    ]);
  }
}
