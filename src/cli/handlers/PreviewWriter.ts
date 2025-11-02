import type { CDPTarget, NetworkRequest, ConsoleMessage, CollectorType } from '@/types';
import { writePartialOutputAsync, writeFullOutputAsync } from '@/utils/session.js';

import { OutputBuilder } from './OutputBuilder.js';

/**
 * Interface for accessing session data without direct coupling
 */
export interface PreviewDataSource {
  getTarget: () => CDPTarget;
  getNetworkRequests: () => NetworkRequest[];
  getConsoleLogs: () => ConsoleMessage[];
  getActiveCollectors: () => CollectorType[];
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
    private intervalMs: number = 5000,
    private compact: boolean = false
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
   *
   * Passes original arrays for active collectors, empty arrays for inactive ones.
   * No cloning needed - OutputBuilder serializes immediately, avoiding unnecessary copies.
   */
  private async doWrite(): Promise<void> {
    const target = this.dataSource.getTarget();
    const activeCollectors = this.dataSource.getActiveCollectors();

    // Pass original arrays when active, empty arrays when inactive (no cloning needed)
    const networkRequests = activeCollectors.includes('network')
      ? this.dataSource.getNetworkRequests()
      : [];
    const consoleLogs = activeCollectors.includes('console')
      ? this.dataSource.getConsoleLogs()
      : [];

    // Build both preview and full outputs
    const previewOutput = OutputBuilder.build({
      mode: 'preview',
      target,
      startTime: this.startTime,
      networkRequests,
      consoleLogs,
      activeCollectors,
    });

    const fullOutput = OutputBuilder.build({
      mode: 'full',
      target,
      startTime: this.startTime,
      networkRequests,
      consoleLogs,
      activeCollectors,
    });

    // Write both files in parallel (async, non-blocking)
    await Promise.all([
      writePartialOutputAsync(previewOutput, this.compact), // ~500KB - for 'bdg peek'
      writeFullOutputAsync(fullOutput, this.compact), // ~87MB - for 'bdg details'
    ]);
  }
}
