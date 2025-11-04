import type { LaunchOptions } from '@/connection/launcher.js';
import { MEMORY_LOG_INTERVAL, DEFAULT_REUSE_TAB } from '@/constants';
import type { BdgSession } from '@/session/BdgSession.js';
import { writeChromePid } from '@/session/chrome.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { writePid } from '@/session/pid.js';
import type { CollectorType, LaunchedChrome, CDPTarget, SessionOptions } from '@/types';
import { getChromeDiagnostics, formatDiagnosticsForError } from '@/utils/chromeDiagnostics.js';
import { ChromeLaunchError, getErrorMessage } from '@/utils/errors.js';
import { getExitCodeForError } from '@/utils/exitCodes.js';

import { ChromeBootstrap } from './ChromeBootstrap.js';
import { OutputBuilder } from './OutputBuilder.js';
import { SessionLock } from './SessionLock.js';
import { SessionLoop } from './SessionLoop.js';
import { ShutdownController, type SessionState } from './ShutdownController.js';
import { SignalHandler } from './SignalHandler.js';
import { TargetSetup } from './TargetSetup.js';

/**
 * Report detailed diagnostic information when Chrome fails to launch.
 *
 * Uses chrome-launcher APIs to detect available Chrome installations and
 * provide actionable error messages to help users troubleshoot.
 * @param error - Original error that caused the failure
 */
function reportLauncherFailure(error: unknown): void {
  console.error('\n--- Chrome Launch Diagnostics ---\n');

  // Show original error
  console.error(`Error: ${getErrorMessage(error)}\n`);

  // Get diagnostics using shared utility (cached to avoid repeated scans)
  const diagnostics = getChromeDiagnostics();
  const diagnosticLines = formatDiagnosticsForError(diagnostics);
  diagnosticLines.forEach((line) => console.error(line));

  // Provide troubleshooting steps
  console.error('Troubleshooting:');
  console.error('   1. Verify Chrome is installed and accessible');
  console.error('   2. Check file permissions for Chrome binary');
  console.error('   3. Try specifying a custom port: bdg <url> --port 9223');
  console.error('   4. Use strict port mode: bdg <url> --port-strict');
  console.error('   5. Check if another process is using the debugging port\n');
}

/**
 * Aggressively cleanup stale Chrome processes launched by bdg.
 *
 * This function kills Chrome instances that were launched by bdg by:
 * 1. Reading the Chrome PID from persistent cache (~/.bdg/chrome.pid)
 * 2. Killing that specific Chrome process using cross-platform kill logic
 *
 * The cache survives session cleanup, so this works even after a normal session end.
 *
 * Cross-platform killing:
 * - Windows: Uses `taskkill /pid <pid> /T /F` to kill process tree
 * - Unix/macOS: Uses `process.kill(-pid, 'SIGKILL')` to kill process group
 *
 * Note: We can't use chromeLauncher.killAll() because it only tracks instances
 * created via chromeLauncher.launch(), but we use new chromeLauncher.Launcher()
 * which doesn't register in that tracking set.
 *
 * @returns Number of errors encountered during cleanup
 */
export async function cleanupStaleChrome(): Promise<number> {
  console.error('\nAttempting to kill stale Chrome processes...');

  try {
    // Import session utilities (dynamic import for ES modules)
    const { readChromePid, clearChromePid } = await import('@/session/chrome.js');
    const { killChromeProcess } = await import('@/session/process.js');

    // Read Chrome PID from persistent cache
    const chromePid = readChromePid();

    if (!chromePid) {
      console.error('Warning: No Chrome PID found in cache');
      console.error('   Either Chrome was already running, or no Chrome was launched by bdg\n');
      return 0;
    }

    // Kill Chrome process (cross-platform)
    console.error(`Killing Chrome process (PID: ${chromePid})...`);

    try {
      // Use SIGKILL for aggressive cleanup (force kill)
      killChromeProcess(chromePid, 'SIGKILL');

      console.error('Chrome process killed successfully');

      // Clear the cache after successful kill
      clearChromePid();

      return 0;
    } catch (killError) {
      console.error(`Error: Failed to kill Chrome process: ${getErrorMessage(killError)}`);
      console.error('   Try manually killing Chrome processes if issues persist\n');
      return 1;
    }
  } catch (error) {
    console.error(`Error: Failed to cleanup Chrome processes: ${getErrorMessage(error)}\n`);
    return 1;
  }
}

/**
 * Encapsulates session state and lifecycle management
 */
class SessionContext implements SessionState {
  session: BdgSession | null = null;
  launchedChrome: LaunchedChrome | null = null;
  isShuttingDown = false;
  startTime: number;
  target: CDPTarget | null = null;
  compact: boolean;
  private shutdownController: ShutdownController;

  /**
   * Create a new session context and track the start timestamp.
   * The context is shared with signal handlers so they can orchestrate shutdown.
   * @param compact - If true, use compact JSON format (no indentation)
   */
  constructor(compact: boolean = false) {
    this.startTime = Date.now();
    this.compact = compact;
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
 * @param session - Active BDG session instance
 * @param collectors - Collector types requested by the CLI
 * @param startTime - Timestamp when the session began
 * @param port - Chrome debugging port in use
 * @param target - Target metadata (includes websocket URL)
 * @param chromePid - PID of Chrome if bdg launched it (optional)
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
    activeCollectors: collectors,
  });

  // Note: Chrome PID cache is written immediately after launch (Phase 2)
  // to ensure it's available even if later phases fail
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
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @param collectors - Array of collector types to enable ('dom', 'network', 'console')
 * @returns Promise that resolves when session completes
 */
export async function startSession(
  url: string,
  options: {
    port: number;
    timeout?: number | undefined;
    reuseTab?: boolean | undefined;
    userDataDir?: string | undefined;
    includeAll?: boolean | undefined;
    logLevel?: 'verbose' | 'info' | 'error' | 'silent' | undefined;
    prefs?: Record<string, unknown> | undefined;
    prefsFile?: string | undefined;
    chromeFlags?: string[] | undefined;
    connectionPollInterval?: number | undefined;
    maxConnectionRetries?: number | undefined;
    portStrictMode?: boolean | undefined;
    fetchAllBodies?: boolean | undefined;
    fetchBodiesInclude?: string[] | undefined;
    fetchBodiesExclude?: string[] | undefined;
    networkInclude?: string[] | undefined;
    networkExclude?: string[] | undefined;
    maxBodySize?: number | undefined;
    compact?: boolean | undefined;
  },
  collectors: CollectorType[]
): Promise<void> {
  const context = new SessionContext(options.compact ?? false);

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
    // Build launcher options, filtering out undefined values
    const launchOptions = Object.fromEntries(
      Object.entries({
        userDataDir: options.userDataDir,
        logLevel: options.logLevel,
        prefs: options.prefs,
        prefsFile: options.prefsFile,
        chromeFlags: options.chromeFlags,
        connectionPollInterval: options.connectionPollInterval,
        maxConnectionRetries: options.maxConnectionRetries,
        portStrictMode: options.portStrictMode,
      }).filter(([, value]) => value !== undefined)
    ) as Partial<LaunchOptions>;

    context.launchedChrome = await ChromeBootstrap.launch(options.port, targetUrl, launchOptions);

    // Write Chrome PID to persistent cache immediately after launch
    // This must happen before Phase 3 so it's available even if setup fails
    if (context.launchedChrome?.pid) {
      writeChromePid(context.launchedChrome.pid);
    }

    // Phase 3: CDP connection and target setup
    const setupStart = Date.now();
    const sessionOptions: SessionOptions = {
      includeAll: options.includeAll ?? false,
      fetchAllBodies: options.fetchAllBodies ?? false,
      compact: options.compact ?? false,
    };
    if (options.fetchBodiesInclude !== undefined) {
      sessionOptions.fetchBodiesInclude = options.fetchBodiesInclude;
    }
    if (options.fetchBodiesExclude !== undefined) {
      sessionOptions.fetchBodiesExclude = options.fetchBodiesExclude;
    }
    if (options.networkInclude !== undefined) {
      sessionOptions.networkInclude = options.networkInclude;
    }
    if (options.networkExclude !== undefined) {
      sessionOptions.networkExclude = options.networkExclude;
    }
    if (options.maxBodySize !== undefined) {
      sessionOptions.maxBodySize = options.maxBodySize;
    }
    const setupResult = await TargetSetup.setup(
      url,
      targetUrl,
      options.port,
      options.reuseTab ?? DEFAULT_REUSE_TAB,
      sessionOptions
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

    // Log active collectors for forensic tracking and optimization prioritization
    console.error(
      `[bdg] active collectors: ${collectors.join(', ')} (${url}, port ${options.port})`
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

    // Optional: Log memory usage periodically (every 30s)
    const memoryLogInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
      const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
      console.error(`[PERF] Memory: Heap ${heapUsedMB}/${heapTotalMB} MB, RSS ${rssMB} MB`);
    }, MEMORY_LOG_INTERVAL);

    // Store interval in context for cleanup
    const originalCleanup = context.cleanup.bind(context);
    context.cleanup = async (): Promise<void> => {
      clearInterval(memoryLogInterval);
      await originalCleanup();
    };

    // Phase 6: Run session loop
    await SessionLoop.run(session, target);
  } catch (error) {
    // Show diagnostic information for Chrome launch failures
    if (error instanceof ChromeLaunchError) {
      reportLauncherFailure(error);
    }

    const errorOutput = OutputBuilder.buildError(
      error,
      context.startTime,
      context.target ?? undefined
    );
    console.log(JSON.stringify(errorOutput, null, 2));

    // Cleanup on error
    await context.cleanup();

    // Use semantic exit codes based on error type
    const exitCode = getExitCodeForError(error);
    process.exit(exitCode);
  }
}
