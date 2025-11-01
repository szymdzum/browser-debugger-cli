import type { BdgSession } from '@/session/BdgSession.js';
import type {
  BdgOutput,
  CollectorType,
  CDPTargetDestroyedParams,
  LaunchedChrome,
  CDPTarget,
} from '@/types';
import { writePid, writeSessionMetadata, cleanupSession } from '@/utils/session.js';

import { ChromeBootstrap } from './bootstrap/ChromeBootstrap.js';
import { SessionLock } from './bootstrap/SessionLock.js';
import { TargetSetup } from './bootstrap/TargetSetup.js';
import { OutputBuilder } from './output/OutputBuilder.js';
import { OutputWriter } from './output/OutputWriter.js';
import { PreviewWriter } from './output/PreviewWriter.js';

/**
 * Encapsulates session state and lifecycle management
 */
class SessionContext {
  session: BdgSession | null = null;
  launchedChrome: LaunchedChrome | null = null;
  isShuttingDown = false;
  shutdownKeepalive: NodeJS.Timeout | null = null;
  previewWriter: PreviewWriter | null = null;
  startTime: number;
  target: CDPTarget | null = null;

  /**
   * Create a new session context and track the start timestamp.
   * The context is shared with signal handlers so they can orchestrate shutdown.
   */
  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Finalize shutdown: write output, cleanup, and exit
   * @private
   */
  private async finalizeShutdown(output: BdgOutput, exitCode: 0 | 1): Promise<never> {
    // Write output using OutputWriter
    const outputWriter = new OutputWriter();
    await outputWriter.writeSessionOutput(output, exitCode);

    // Leave Chrome running for future sessions
    if (this.launchedChrome) {
      const chromeMessage =
        exitCode === 0
          ? 'Leaving Chrome running for future sessions (use persistent profile)'
          : 'Leaving Chrome running (use persistent profile)';
      console.error(chromeMessage);
      console.error(`Chrome PID: ${this.launchedChrome.pid}, port: ${this.launchedChrome.port}`);
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

  /**
   * Handle graceful shutdown: stops collectors, writes output, and exits.
   *
   * Idempotent — repeated calls after shutdown has started are ignored.
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown || !this.session) {
      return;
    }

    this.isShuttingDown = true;

    // Keep event loop alive IMMEDIATELY to prevent premature exit during async operations
    // This must be set before any await points
    this.shutdownKeepalive = setInterval(() => {}, 1000);

    // Stop preview writer and wait for pending writes
    if (this.previewWriter) {
      this.previewWriter.stop();
      await this.previewWriter.waitForPendingWrite();
    }

    try {
      console.error('Stopping session...');
      const output = await this.session.stop();
      await this.finalizeShutdown(output, 0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      const errorOutput = OutputBuilder.buildError(error, this.startTime);
      await this.finalizeShutdown(errorOutput, 1);
    }
  }

  /**
   * Cleanup on error paths without exiting the process.
   * Clears timers, tears down Chrome if bdg launched it, and removes session files.
   */
  async cleanup(): Promise<void> {
    // Stop preview writer and wait for pending writes
    if (this.previewWriter) {
      this.previewWriter.stop();
      await this.previewWriter.waitForPendingWrite();
    }

    // Kill Chrome if we launched it
    if (this.launchedChrome) {
      try {
        await this.launchedChrome.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Cleanup session files
    cleanupSession();
  }
}

// Global context for signal handling
// Single instance since we don't support multiple sessions
let globalContext: SessionContext | null = null;

/**
 * Phase 4: start requested collectors and persist session metadata for tooling.
 *
 * @param session Active BDG session instance
 * @param collectors Collector types requested by the CLI
 * @param startTime Timestamp when the session began
 * @param port Chrome debugging port in use
 * @param target Target metadata (includes websocket URL)
 * @param chromePid PID of Chrome if bdg launched it (optional)
 */
async function startCollectorsAndMetadata(
  session: BdgSession,
  collectors: CollectorType[],
  startTime: number,
  port: number,
  target: CDPTarget,
  chromePid?: number
): Promise<void> {
  // Start collectors with timing
  const collectorStartTime = Date.now();
  for (const collector of collectors) {
    const individualStart = Date.now();
    await session.startCollector(collector);
    const individualDuration = Date.now() - individualStart;
    console.error(`[PERF] Collector '${collector}' initialized: ${individualDuration}ms`);
  }
  const totalCollectorDuration = Date.now() - collectorStartTime;
  console.error(`[PERF] All collectors initialized: ${totalCollectorDuration}ms`);

  // Write session metadata
  writePid(process.pid);
  writeSessionMetadata({
    bdgPid: process.pid,
    chromePid,
    startTime,
    port,
    targetId: target.id,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  });
}

/**
 * Phase 5: Start preview writer with two-tier system
 *
 * Uses async I/O with mutex to prevent event loop blocking and overlapping writes.
 */
function startPreviewWriter(context: SessionContext): void {
  if (!context.session) {
    return;
  }

  // Create and start preview writer
  context.previewWriter = new PreviewWriter(context.session, context.startTime);
  context.previewWriter.start();
}

/**
 * Phase 6: Run session loop until stopped or error
 */
async function runSessionLoop(session: BdgSession, target: CDPTarget): Promise<void> {
  if (!session) {
    throw new Error('Session not initialized');
  }

  const cdp = session.getCDP();

  const waitForNextCheck = (): Promise<'continue' | 'destroyed'> =>
    new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let handlerId: number;

      const handleTargetDestroyed = (params: CDPTargetDestroyedParams): void => {
        if (params.targetId === target.id) {
          clearTimeout(timer);
          cdp.off('Target.targetDestroyed', handlerId);
          resolve('destroyed');
        }
      };

      handlerId = cdp.on<CDPTargetDestroyedParams>('Target.targetDestroyed', handleTargetDestroyed);

      timer = setTimeout(() => {
        cdp.off('Target.targetDestroyed', handlerId);
        resolve('continue');
      }, 2000);
    });

  for (;;) {
    const result = await waitForNextCheck();

    if (!session.isConnected()) {
      throw new Error('WebSocket connection lost');
    }

    if (result === 'destroyed') {
      throw new Error('Browser tab was closed');
    }
  }
}

/**
 * Print collection status message
 */
function printCollectionStatus(collectors: CollectorType[], timeout?: number): void {
  const collectorNames =
    collectors.length === 3 ? 'network, console, and DOM' : collectors.join(', ');

  if (timeout) {
    console.error(
      `Collecting ${collectorNames}... (Ctrl+C to stop and output, or wait ${timeout}s for timeout)`
    );
  } else {
    console.error(`Collecting ${collectorNames}... (Ctrl+C to stop and output, or use 'bdg stop')`);
  }
}

/**
 * Start a new session
 */
export async function startSession(
  url: string,
  options: {
    port: number;
    timeout?: number | undefined;
    reuseTab?: boolean | undefined;
    userDataDir?: string | undefined;
    includeAll?: boolean | undefined;
  },
  collectors: CollectorType[]
): Promise<void> {
  const context = new SessionContext();
  globalContext = context;

  try {
    // Phase 1: Lock acquisition and validation
    const targetUrl = SessionLock.acquire(url, collectors);

    // Phase 2: Chrome bootstrap
    context.launchedChrome = await ChromeBootstrap.launch(
      options.port,
      targetUrl,
      options.userDataDir
    );

    // Phase 3: CDP connection and target setup
    const setupStart = Date.now();
    const setupResult = await TargetSetup.setup(
      url,
      targetUrl,
      options.port,
      options.reuseTab ?? false,
      options.includeAll ?? false
    );
    const session = setupResult.session;
    const target = setupResult.target;
    context.session = session;
    context.target = target;
    console.error(`[PERF] CDP connection and target setup: ${Date.now() - setupStart}ms`);

    // Phase 4: Start collectors and write metadata
    await startCollectorsAndMetadata(
      session,
      collectors,
      context.startTime,
      options.port,
      target,
      context.launchedChrome?.pid
    );

    // Total session startup time
    const totalStartupTime = Date.now() - context.startTime;
    console.error(`[PERF] Total session startup: ${totalStartupTime}ms`);

    // Print status
    printCollectionStatus(collectors, options.timeout);

    // Set timeout if explicitly provided
    if (options.timeout) {
      setTimeout(() => {
        console.error(`\nTimeout reached (${options.timeout}s)`);
        void context.stop();
      }, options.timeout * 1000);
    }

    // Phase 5: Start preview writer
    startPreviewWriter(context);

    // Optional: Log memory usage periodically (every 30s)
    const memoryLogInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
      const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
      console.error(`[PERF] Memory: Heap ${heapUsedMB}/${heapTotalMB} MB, RSS ${rssMB} MB`);
    }, 30000);

    // Store interval in context for cleanup
    const originalCleanup = context.cleanup.bind(context);
    context.cleanup = async (): Promise<void> => {
      clearInterval(memoryLogInterval);
      await originalCleanup();
    };

    // Phase 6: Run session loop
    await runSessionLoop(session, target);
  } catch (error) {
    const errorOutput = OutputBuilder.buildError(
      error,
      context.startTime,
      context.target ?? undefined
    );
    console.log(JSON.stringify(errorOutput, null, 2));

    // Cleanup on error
    await context.cleanup();

    process.exit(1);
  }
}

/**
 * Setup global signal handlers for graceful shutdown
 */
export function setupSignalHandlers(): void {
  // Handler that blocks until shutdown completes
  const handleShutdownSignal = (signal: string): void => {
    if (!globalContext || globalContext.isShuttingDown) {
      return;
    }

    console.error(`\nReceived ${signal}, shutting down gracefully...`);

    // Remove signal handlers to prevent multiple signals from interrupting shutdown
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    // Execute shutdown asynchronously but keep process alive with keepalive
    void (async (): Promise<void> => {
      try {
        await globalContext.stop();
        // stop() calls process.exit(), so we should never reach here
      } catch (error) {
        console.error('Fatal error during shutdown:', error);
        process.exit(1);
      }
    })();
  };

  // Register signal handlers
  process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
  process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

  // Error handlers for cleanup on crash
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    console.error('Cleaning up session files...');
    try {
      cleanupSession();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    console.error('Cleaning up session files...');
    try {
      cleanupSession();
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    process.exit(1);
  });
}
