import {
  writePid,
  readPid,
  isProcessAlive,
  writeSessionOutput,
  acquireSessionLock,
  writeSessionMetadata,
  cleanupSession,
  writePartialOutput,
  writeFullOutput
} from '@/utils/session.js';

import type { BdgOutput, CollectorType, CDPTargetDestroyedParams, LaunchedChrome, CDPTarget } from '@/types';

import { BdgSession } from '@/session/BdgSession.js';
import { normalizeUrl } from '@/utils/url.js';
import { validateCollectorTypes } from '@/utils/validation.js';
import { createOrFindTarget } from '@/connection/tabs.js';
import { launchChrome, isChromeRunning } from '@/connection/launcher.js';

/**
 * Encapsulates session state and lifecycle management
 */
class SessionContext {
  session: BdgSession | null = null;
  launchedChrome: LaunchedChrome | null = null;
  isShuttingDown = false;
  shutdownKeepalive: NodeJS.Timeout | null = null;
  previewInterval: NodeJS.Timeout | null = null;
  startTime: number;
  target: CDPTarget | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Finalize shutdown: write output, cleanup, and exit
   * @private
   */
  private finalizeShutdown(output: BdgOutput, exitCode: 0 | 1): never {
    // Write output to file for 'bdg stop' to read
    try {
      const message = exitCode === 0 ? 'Writing session output...' : 'Writing error output...';
      console.error(message);
      writeSessionOutput(output);
      const successMessage = exitCode === 0 ? 'Session output written successfully' : 'Error output written successfully';
      console.error(successMessage);
    } catch (writeError) {
      const errorMessage = exitCode === 0 ? 'Failed to write session output:' : 'Failed to write error output:';
      console.error(errorMessage, writeError);
      console.error('Write error details:', writeError);
    }

    // Output to stdout (for foreground use)
    console.log(JSON.stringify(output, null, 2));

    // Leave Chrome running for future sessions
    if (this.launchedChrome) {
      const chromeMessage = exitCode === 0
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
   * Handle graceful shutdown of the session
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown || !this.session) {
      return;
    }

    this.isShuttingDown = true;

    // Clear preview interval if active
    if (this.previewInterval) {
      clearInterval(this.previewInterval);
      this.previewInterval = null;
    }

    // Keep event loop alive during shutdown to prevent premature exit
    this.shutdownKeepalive = setInterval(() => {}, 1000);

    try {
      console.error('Stopping session...');
      const output = await this.session.stop();
      this.finalizeShutdown(output, 0);
    } catch (error) {
      console.error('Error during shutdown:', error);

      const errorOutput: BdgOutput = {
        success: false,
        timestamp: new Date().toISOString(),
        duration: 0,
        target: { url: '', title: '' },
        data: {},
        error: error instanceof Error ? error.message : String(error)
      };

      this.finalizeShutdown(errorOutput, 1);
    }
  }

  /**
   * Cleanup on error
   */
  async cleanup(): Promise<void> {
    // Clear preview interval
    if (this.previewInterval) {
      clearInterval(this.previewInterval);
      this.previewInterval = null;
    }

    // Kill Chrome if we launched it
    if (this.launchedChrome) {
      try {
        await this.launchedChrome.kill();
      } catch {}
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
async function setupSessionLock(
  url: string,
  collectors: CollectorType[]
): Promise<string> {
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
    throw new Error(
      `Session already running (PID ${currentPid}). Stop it with: bdg stop`
    );
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
 * Phase 3: Create CDP connection and find/create target tab
 */
async function setupTarget(
  url: string,
  targetUrl: string,
  port: number,
  reuseTab: boolean,
  includeAll: boolean = false
): Promise<{ session: BdgSession; target: CDPTarget }> {
  // Create session (connects to CDP)
  // We need a temporary target just to connect to CDP
  // Then we'll use createOrFindTarget to get the right tab
  const tempResponse = await fetch(
    `http://127.0.0.1:${port}/json/list`
  );
  const tempTargets = await tempResponse.json();

  if (tempTargets.length === 0) {
    throw new Error('No targets available in Chrome');
  }

  // Use first available target to establish CDP connection
  const tempSession = new BdgSession(tempTargets[0], port, includeAll);
  await tempSession.connect();

  if (!tempSession.isConnected()) {
    throw new Error('Failed to establish CDP connection');
  }

  // Create or find target tab using TabManager
  console.error(`Finding or creating tab for: ${targetUrl}`);
  const target = await createOrFindTarget(
    url,
    tempSession.getCDP(),
    reuseTab
  );
  console.error(`Using tab: ${target.url}`);

  // Fetch full target info with webSocketDebuggerUrl
  const fullTargetResponse = await fetch(
    `http://127.0.0.1:${port}/json/list`
  );
  const fullTargets = await fullTargetResponse.json();
  const fullTarget = fullTargets.find((t: any) => t.id === target.id);

  if (!fullTarget || !fullTarget.webSocketDebuggerUrl) {
    throw new Error(`Could not find webSocketDebuggerUrl for target ${target.id}`);
  }

  // Update session with the correct target
  // Close current session and reconnect to the correct target
  await tempSession.getCDP().close();
  const session = new BdgSession(fullTarget, port, includeAll);
  await session.connect();

  return { session, target: fullTarget };
}

/**
 * Phase 4: Start collectors and write session metadata
 */
async function startCollectorsAndMetadata(
  session: BdgSession,
  collectors: CollectorType[],
  startTime: number,
  port: number,
  target: CDPTarget,
  chromePid?: number
): Promise<void> {
  // Start collectors
  for (const collector of collectors) {
    await session.startCollector(collector);
  }

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
 */
function startPreviewWriter(
  context: SessionContext
): void {
  context.previewInterval = setInterval(() => {
    if (context.session && context.session.isConnected()) {
      try {
        const target = context.session.getTarget();
        const allNetworkRequests = context.session.getNetworkRequests();
        const allConsoleLogs = context.session.getConsoleLogs();

        // Lightweight preview: metadata only, last 1000 items
        const previewOutput: BdgOutput = {
          success: true,
          timestamp: new Date().toISOString(),
          duration: Date.now() - context.startTime,
          target: {
            url: target.url,
            title: target.title
          },
          data: {
            // Exclude bodies and limit to last 1000
            network: allNetworkRequests.slice(-1000).map(req => ({
              requestId: req.requestId,
              url: req.url,
              method: req.method,
              timestamp: req.timestamp,
              status: req.status,
              mimeType: req.mimeType
              // Exclude requestBody, responseBody, headers for lightweight preview
            })),
            console: allConsoleLogs.slice(-1000).map(msg => ({
              type: msg.type,
              text: msg.text,
              timestamp: msg.timestamp
              // Exclude args for lightweight preview
            }))
            // DOM omitted in preview (only captured on stop)
          },
          partial: true // Flag to indicate this is incomplete data
        };

        // Full output: complete data with bodies
        const fullOutput: BdgOutput = {
          success: true,
          timestamp: new Date().toISOString(),
          duration: Date.now() - context.startTime,
          target: {
            url: target.url,
            title: target.title
          },
          data: {
            network: allNetworkRequests, // All data with bodies
            console: allConsoleLogs      // All data with args
            // DOM omitted (only captured on stop)
          },
          partial: true
        };

        // Write both files
        writePartialOutput(previewOutput);  // ~500KB - for 'bdg peek'
        writeFullOutput(fullOutput);         // ~87MB - for 'bdg details'
      } catch (error) {
        // Ignore preview write errors - don't disrupt collection
        console.error('Warning: Failed to write preview data:', error instanceof Error ? error.message : String(error));
      }
    }
  }, 5000); // Write preview every 5 seconds
}

/**
 * Phase 6: Run session loop until stopped or error
 */
async function runSessionLoop(
  session: BdgSession,
  target: CDPTarget
): Promise<void> {
  await new Promise<void>((_, reject) => {
    if (!session) {
      reject(new Error('Session not initialized'));
      return;
    }

    // Listen for WebSocket connection loss
    const connectionCheckInterval = setInterval(() => {
      if (!session) {
        clearInterval(connectionCheckInterval);
        return;
      }

      if (!session.isConnected()) {
        clearInterval(connectionCheckInterval);
        reject(new Error('WebSocket connection lost'));
        return;
      }
    }, 2000); // Check every 2 seconds

    // Listen for target destruction (tab closed/navigated)
    session.getCDP().on('Target.targetDestroyed', (params: CDPTargetDestroyedParams) => {
      if (params.targetId === target.id) {
        clearInterval(connectionCheckInterval);
        reject(new Error('Browser tab was closed'));
      }
    });
  });
}

/**
 * Print collection status message
 */
function printCollectionStatus(
  collectors: CollectorType[],
  timeout?: number
): void {
  const collectorNames =
    collectors.length === 3
      ? 'network, console, and DOM'
      : collectors.join(', ');

  if (timeout) {
    console.error(
      `Collecting ${collectorNames}... (Ctrl+C to stop and output, or wait ${timeout}s for timeout)`
    );
  } else {
    console.error(
      `Collecting ${collectorNames}... (Ctrl+C to stop and output, or use 'bdg stop')`
    );
  }
}

/**
 * Start a new session
 */
export async function startSession(
  url: string,
  options: { port: number; timeout?: number; reuseTab?: boolean; userDataDir?: string; includeAll?: boolean },
  collectors: CollectorType[]
) {
  const context = new SessionContext();
  globalContext = context;

  try {
    // Phase 1: Lock acquisition and validation
    const targetUrl = await setupSessionLock(url, collectors);

    // Phase 2: Chrome bootstrap
    context.launchedChrome = await bootstrapChrome(
      options.port,
      targetUrl,
      options.userDataDir
    );

    // Phase 3: CDP connection and target setup
    const { session, target } = await setupTarget(
      url,
      targetUrl,
      options.port,
      options.reuseTab ?? false,
      options.includeAll ?? false
    );
    context.session = session;
    context.target = target;

    // Phase 4: Start collectors and write metadata
    await startCollectorsAndMetadata(
      session,
      collectors,
      context.startTime,
      options.port,
      target,
      context.launchedChrome?.pid
    );

    // Print status
    printCollectionStatus(collectors, options.timeout);

    // Set timeout if explicitly provided
    if (options.timeout) {
      setTimeout(() => {
        console.error(`\nTimeout reached (${options.timeout}s)`);
        context.stop();
      }, options.timeout * 1000);
    }

    // Phase 5: Start preview writer
    startPreviewWriter(context);

    // Phase 6: Run session loop
    await runSessionLoop(session, target);
  } catch (error) {
    const errorOutput: BdgOutput = {
      success: false,
      timestamp: new Date().toISOString(),
      duration: Date.now() - context.startTime,
      target: { url: '', title: '' },
      data: {},
      error: error instanceof Error ? error.message : String(error)
    };

    console.log(JSON.stringify(errorOutput, null, 2));

    // Cleanup on error
    await context.cleanup();

    process.exit(1);
  }
}

/**
 * Setup global signal handlers for graceful shutdown
 */
export function setupSignalHandlers() {
  // Register signal handlers
  // Wrap in async IIFE to ensure handler completes before exit
  process.on('SIGINT', () => {
    // Prevent multiple signals from being processed
    if (globalContext && !globalContext.isShuttingDown) {
      globalContext.stop().catch((error) => {
        console.error('Fatal error during shutdown:', error);
        process.exit(1);
      });
    }
  });

  process.on('SIGTERM', () => {
    if (globalContext && !globalContext.isShuttingDown) {
      globalContext.stop().catch((error) => {
        console.error('Fatal error during shutdown:', error);
        process.exit(1);
      });
    }
  });

  // Error handlers for cleanup on crash
  process.on('unhandledRejection', (reason, promise) => {
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
