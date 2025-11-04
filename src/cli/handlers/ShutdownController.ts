import type { PreviewWriter } from './PreviewWriter.js';

import type { BdgSession } from '@/session/BdgSession.js';
import { cleanupSession } from '@/session/cleanup.js';
import type { BdgOutput, CDPTarget, LaunchedChrome } from '@/types';

import { OutputBuilder } from './OutputBuilder.js';
import { OutputWriter } from './OutputWriter.js';

/**
 * Minimal session state interface
 */
export interface SessionState {
  session: BdgSession | null;
  launchedChrome: LaunchedChrome | null;
  isShuttingDown: boolean;
  previewWriter: PreviewWriter | null;
  startTime: number;
  target: CDPTarget | null;
  compact: boolean;
}

/**
 * Orchestrates shutdown sequence and cleanup operations
 */
export class ShutdownController {
  private shutdownKeepalive: NodeJS.Timeout | null = null;
  private outputWriter: OutputWriter;

  constructor(
    private state: SessionState,
    outputWriter?: OutputWriter
  ) {
    this.outputWriter = outputWriter ?? new OutputWriter();
  }

  /**
   * Execute graceful shutdown sequence.
   * Stops session, writes output, and exits process.
   */
  async shutdown(): Promise<void> {
    if (this.state.isShuttingDown || !this.state.session) {
      return;
    }

    this.state.isShuttingDown = true;

    // Keep event loop alive IMMEDIATELY to prevent premature exit during async operations
    // This must be set before any await points
    this.shutdownKeepalive = setInterval(() => {}, 1000);

    // Stop preview writer and wait for pending writes
    if (this.state.previewWriter) {
      this.state.previewWriter.stop();
      await this.state.previewWriter.waitForPendingWrite();
    }

    try {
      console.error('Stopping session...');
      const output = await this.state.session.stop();
      this.finalize(output, 0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      const errorOutput = OutputBuilder.buildError(error, this.state.startTime);
      this.finalize(errorOutput, 1);
    }
  }

  /**
   * Cleanup without stopping session (error path).
   * Clears timers, tears down Chrome if launched, and removes session files.
   */
  async cleanup(): Promise<void> {
    // Stop preview writer and wait for pending writes
    if (this.state.previewWriter) {
      this.state.previewWriter.stop();
      await this.state.previewWriter.waitForPendingWrite();
    }

    // Kill Chrome if we launched it
    if (this.state.launchedChrome) {
      try {
        await this.state.launchedChrome.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Cleanup session files
    cleanupSession();
  }

  /**
   * Finalize shutdown: write output, cleanup, and exit
   * @private
   */
  private finalize(output: BdgOutput, exitCode: 0 | 1): never {
    // Write output
    this.outputWriter.writeSessionOutput(output, exitCode, this.state.compact);

    // Leave Chrome running for future sessions
    if (this.state.launchedChrome) {
      const chromeMessage =
        exitCode === 0
          ? 'Leaving Chrome running for future sessions (use persistent profile)'
          : 'Leaving Chrome running (use persistent profile)';
      console.error(chromeMessage);
      console.error(
        `Chrome PID: ${this.state.launchedChrome.pid}, port: ${this.state.launchedChrome.port}`
      );
    }

    // Cleanup session files
    try {
      cleanupSession();
    } catch (cleanupError) {
      console.error('Error cleaning up session:', cleanupError);
    }

    // Clear keepalive and exit
    if (this.shutdownKeepalive) {
      clearInterval(this.shutdownKeepalive);
    }

    process.exit(exitCode);
  }
}
