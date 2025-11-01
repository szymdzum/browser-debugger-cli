import { launchChrome, isChromeRunning } from '@/connection/launcher.js';
import { createOrFindTarget } from '@/connection/tabs.js';
import { BdgSession } from '@/session/BdgSession.js';
import type {
  BdgOutput,
  CollectorType,
  CDPTargetDestroyedParams,
  LaunchedChrome,
  CDPTarget,
} from '@/types';
import {
  writePid,
  readPid,
  isProcessAlive,
  acquireSessionLock,
  writeSessionMetadata,
  cleanupSession,
  writePartialOutputAsync,
  writeFullOutputAsync,
} from '@/utils/session.js';
import { normalizeUrl } from '@/utils/url.js';
import { validateCollectorTypes } from '@/utils/validation.js';

import { OutputBuilder } from './output/OutputBuilder.js';
import { OutputWriter } from './output/OutputWriter.js';

/**
 * Encapsulates session state and lifecycle management
 */
class SessionContext {
  session: BdgSession | null = null;
  launchedChrome: LaunchedChrome | null = null;
  isShuttingDown = false;
  shutdownKeepalive: NodeJS.Timeout | null = null;
  previewInterval: NodeJS.Timeout | null = null;
  pendingWrite: Promise<void> | null = null;
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

    // Clear preview interval if active
    if (this.previewInterval) {
      clearInterval(this.previewInterval);
      this.previewInterval = null;
    }

    // Wait for any in-flight write to complete before cleanup
    // This prevents race where write completes after cleanupSession() and recreates files
    if (this.pendingWrite) {
      console.error('Waiting for in-flight write to complete...');
      try {
        await this.pendingWrite;
        console.error('In-flight write completed');
      } catch (error) {
        // Ignore write errors during shutdown
        console.error('Error in pending write (ignoring):', error);
      }
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
    // Clear preview interval
    if (this.previewInterval) {
      clearInterval(this.previewInterval);
      this.previewInterval = null;
    }

    // Wait for any in-flight write to complete before cleanup
    if (this.pendingWrite) {
      console.error('Waiting for in-flight write to complete before cleanup...');
      try {
        await this.pendingWrite;
      } catch {
        // Ignore write errors during cleanup
      }
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
 * Phase 1: Acquire session lock and validate inputs
 */
function setupSessionLock(url: string, collectors: CollectorType[]): string {
  const existingPid = readPid();

  // Check for stale session before trying to acquire lock
  if (existingPid && !isProcessAlive(existingPid)) {
    console.error(`Found stale session (PID ${existingPid} not running)`);
    console.error('Cleaning up stale session files...');
    cleanupSession();
    console.error('✓ Stale session cleaned up');
  }

  if (!acquireSessionLock()) {
    const currentPid = readPid();
    throw new Error(`Session already running (PID ${currentPid}). Stop it with: bdg stop`);
  }

  // Validate collector types
  validateCollectorTypes(collectors);

  // Normalize URL - add http:// if no protocol specified
  return normalizeUrl(url);
}

/**
 * Phase 2: Launch or connect to Chrome
 */
async function bootstrapChrome(
  port: number,
  targetUrl: string,
  userDataDir?: string
): Promise<LaunchedChrome | null> {
  const chromeRunning = await isChromeRunning(port);

  if (!chromeRunning) {
    // Launch Chrome with target URL
    const chrome = await launchChrome({
      port,
      headless: false,
      url: targetUrl,
      userDataDir,
    });
    console.error(`Chrome launched (PID: ${chrome.pid})`);
    return chrome;
  }

  console.error(`Chrome already running on port ${port}`);
  return null;
}

/**
 * Fetch the current list of available CDP targets from Chrome.
 * Used during session bootstrap to select a temporary connection target and to
 * refresh metadata when the session creates or reuses tabs.
 */
async function fetchCDPTargets(port: number): Promise<CDPTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await response.json()) as CDPTarget[];
}

/**
 * Locate a specific CDP target by ID. Falls back to a fresh fetch when cached
 * metadata is missing or incomplete (e.g., webSocketDebuggerUrl absent).
 */
async function findTargetById(
  targetId: string,
  port: number,
  cachedTargets?: CDPTarget[]
): Promise<CDPTarget> {
  // First check cached targets if provided
  if (cachedTargets) {
    const cached = cachedTargets.find((t) => t.id === targetId);
    if (cached?.webSocketDebuggerUrl) {
      return cached;
    }
  }

  // Not in cache or missing webSocketDebuggerUrl - refetch
  const targets = await fetchCDPTargets(port);
  const target = targets.find((t) => t.id === targetId);

  if (!target) {
    throw new Error(`Could not find target ${targetId}`);
  }

  if (!target.webSocketDebuggerUrl) {
    throw new Error(`Could not find webSocketDebuggerUrl for target ${targetId}`);
  }

  return target;
}

/**
 * Phase 3: Create CDP connection and find/create target tab
 */
async function setupTarget(
  url: string,
  targetUrl: string,
  port: number,
  reuseTab: boolean,
  includeAll: boolean = false
): Promise<{ session: BdgSession; target: CDPTarget }> {
  // Fetch targets once
  const initialTargets = await fetchCDPTargets(port);

  if (initialTargets.length === 0) {
    throw new Error('No targets available in Chrome');
  }

  // Use first available target to establish CDP connection
  const tempTarget = initialTargets[0];
  if (!tempTarget) {
    throw new Error('No targets available in Chrome');
  }
  const tempSession = new BdgSession(tempTarget, port, includeAll);
  await tempSession.connect();

  if (!tempSession.isConnected()) {
    throw new Error('Failed to establish CDP connection');
  }

  // Create or find target tab using TabManager
  console.error(`Finding or creating tab for: ${targetUrl}`);
  const target = await createOrFindTarget(url, tempSession.getCDP(), reuseTab);
  console.error(`Using tab: ${target.url}`);

  // Find full target metadata (refetches only if not in cache or new tab created)
  const fullTarget = await findTargetById(target.id, port, initialTargets);

  // Close temp session and reconnect to the correct target
  tempSession.getCDP().close();
  const session = new BdgSession(fullTarget, port, includeAll);
  await session.connect();

  return { session, target: fullTarget };
}

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
  // Mutex to prevent overlapping writes
  let isWriting = false;

  context.previewInterval = setInterval(() => {
    // Skip if previous write still in progress or session disconnected
    if (isWriting || !context.session?.isConnected()) {
      if (isWriting) {
        console.error('[PERF] Skipping preview write (previous write still in progress)');
      }
      return;
    }

    isWriting = true;

    // Create and track the write promise so shutdown can await it
    const writePromise: Promise<void> = (async (): Promise<void> => {
      try {
        const session = context.session;
        if (!session) return;

        const target = session.getTarget();
        const allNetworkRequests = session.getNetworkRequests();
        const allConsoleLogs = session.getConsoleLogs();

        // Build both preview and full outputs
        const previewOutput = OutputBuilder.build({
          mode: 'preview',
          target,
          startTime: context.startTime,
          networkRequests: allNetworkRequests,
          consoleLogs: allConsoleLogs,
        });
        const fullOutput = OutputBuilder.build({
          mode: 'full',
          target,
          startTime: context.startTime,
          networkRequests: allNetworkRequests,
          consoleLogs: allConsoleLogs,
        });

        // Write both files in parallel (async, non-blocking)
        await Promise.all([
          writePartialOutputAsync(previewOutput), // ~500KB - for 'bdg peek'
          writeFullOutputAsync(fullOutput), // ~87MB - for 'bdg details'
        ]);
      } catch (error) {
        // Ignore preview write errors - don't disrupt collection
        console.error(
          'Warning: Failed to write preview data:',
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        // Always clear mutex flag
        isWriting = false;
        // Clear the pending write reference
        context.pendingWrite = null;
      }
    })();

    // Store the promise so shutdown can await it
    context.pendingWrite = writePromise;
  }, 5000); // Write preview every 5 seconds
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
    const targetUrl = setupSessionLock(url, collectors);

    // Phase 2: Chrome bootstrap
    context.launchedChrome = await bootstrapChrome(options.port, targetUrl, options.userDataDir);

    // Phase 3: CDP connection and target setup
    const setupStart = Date.now();
    const setupResult = await setupTarget(
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
