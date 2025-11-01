import type { BdgSession } from '@/session/BdgSession.js';
import type { CollectorType, LaunchedChrome, CDPTarget } from '@/types';
import { writePid, writeSessionMetadata } from '@/utils/session.js';

import { ChromeBootstrap } from './bootstrap/ChromeBootstrap.js';
import { SessionLock } from './bootstrap/SessionLock.js';
import { TargetSetup } from './bootstrap/TargetSetup.js';
import { ShutdownController } from './lifecycle/ShutdownController.js';
import { SignalHandler } from './lifecycle/SignalHandler.js';
import { SessionLoop } from './monitoring/SessionLoop.js';
import { OutputBuilder } from './output/OutputBuilder.js';
import { PreviewWriter } from './output/PreviewWriter.js';

/**
 * Encapsulates session state and lifecycle management
 */
class SessionContext {
  session: BdgSession | null = null;
  launchedChrome: LaunchedChrome | null = null;
  isShuttingDown = false;
  previewWriter: PreviewWriter | null = null;
  startTime: number;
  target: CDPTarget | null = null;
  private shutdownController: ShutdownController;

  /**
   * Create a new session context and track the start timestamp.
   * The context is shared with signal handlers so they can orchestrate shutdown.
   */
  constructor() {
    this.startTime = Date.now();
    this.shutdownController = new ShutdownController(this);
  }

  /**
   * Handle graceful shutdown: stops collectors, writes output, and exits.
   *
   * Idempotent — repeated calls after shutdown has started are ignored.
   */
  async stop(): Promise<void> {
    await this.shutdownController.shutdown();
  }

  /**
   * Cleanup on error paths without exiting the process.
   * Clears timers, tears down Chrome if bdg launched it, and removes session files.
   */
  async cleanup(): Promise<void> {
    await this.shutdownController.cleanup();
  }
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
  if (!context.session) {
    return;
  }

  // Create and start preview writer
  context.previewWriter = new PreviewWriter(context.session, context.startTime);
  context.previewWriter.start();
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

  // Setup signal handlers for graceful shutdown
  const signalHandler = new SignalHandler({
    onShutdown: async () => {
      await context.stop();
    },
  });
  signalHandler.register();

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
    await SessionLoop.run(session, target);
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
