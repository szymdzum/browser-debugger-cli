import { BdgSession } from '../../session/BdgSession.js';
import { BdgOutput, CollectorType, CDPTargetDestroyedParams, LaunchedChrome } from '../../types.js';
import { normalizeUrl } from '../../utils/url.js';
import { validateCollectorTypes } from '../../utils/validation.js';
import { createOrFindTarget } from '../../connection/tabs.js';
import { launchChrome, isChromeRunning } from '../../connection/launcher.js';
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
} from '../../utils/session.js';

// Global state for signal handling
let session: BdgSession | null = null;
let launchedChrome: LaunchedChrome | null = null;
let isShuttingDown = false;
let shutdownKeepalive: NodeJS.Timeout | null = null;
let previewInterval: NodeJS.Timeout | null = null;

/**
 * Handle graceful shutdown of the session
 */
async function handleStop() {
  if (isShuttingDown || !session) {
    return;
  }

  isShuttingDown = true;

  // Clear preview interval if active
  if (previewInterval) {
    clearInterval(previewInterval);
    previewInterval = null;
  }

  // Keep event loop alive during shutdown to prevent premature exit
  shutdownKeepalive = setInterval(() => {}, 1000);

  try {
    console.error('Stopping session...');
    const output = await session.stop();

    // Write to file for 'bdg stop' to read (synchronous to ensure it completes)
    try {
      console.error('Writing session output...');
      writeSessionOutput(output);
      console.error('Session output written successfully');
    } catch (writeError) {
      console.error('Failed to write session output:', writeError);
      console.error('Write error details:', writeError);
    }

    // Also output to stdout (for foreground use)
    console.log(JSON.stringify(output, null, 2));

    // Leave Chrome running for future sessions (persistent profile benefit)
    if (launchedChrome) {
      console.error('Leaving Chrome running for future sessions (use persistent profile)');
      console.error(`Chrome PID: ${launchedChrome.pid}, port: ${launchedChrome.port}`);
    }

    // Cleanup session files
    try {
      cleanupSession();
    } catch (cleanupError) {
      console.error('Error cleaning up session:', cleanupError);
    }

    // Clear keepalive and exit
    if (shutdownKeepalive) {
      clearInterval(shutdownKeepalive);
    }
    process.exit(0);
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

    // Write error output to file (synchronous to ensure it completes)
    try {
      console.error('Writing error output...');
      writeSessionOutput(errorOutput);
      console.error('Error output written successfully');
    } catch (writeError) {
      console.error('Failed to write error output:', writeError);
      console.error('Write error details:', writeError);
    }

    console.log(JSON.stringify(errorOutput, null, 2));

    // Leave Chrome running even on error
    if (launchedChrome) {
      console.error('Leaving Chrome running (use persistent profile)');
      console.error(`Chrome PID: ${launchedChrome.pid}, port: ${launchedChrome.port}`);
    }

    // Cleanup session files
    try {
      cleanupSession();
    } catch (cleanupError) {
      console.error('Error cleaning up session:', cleanupError);
    }

    // Clear keepalive and exit
    if (shutdownKeepalive) {
      clearInterval(shutdownKeepalive);
    }
    process.exit(1);
  }
}

/**
 * Start a new session
 */
export async function startSession(
  url: string,
  options: { port: number; timeout?: number; reuseTab?: boolean; userDataDir?: string },
  collectors: CollectorType[]
) {
  const startTime = Date.now();

  try {
    // 1. Acquire session lock with stale session detection
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
    const targetUrl = normalizeUrl(url);

    // 2. Launch or connect to Chrome
    const chromeRunning = await isChromeRunning(options.port);
    if (!chromeRunning) {
      // Launch Chrome with target URL
      launchedChrome = await launchChrome({
        port: options.port,
        headless: false,
        url: targetUrl,
        userDataDir: options.userDataDir,
      });
      console.error(`Chrome launched (PID: ${launchedChrome.pid})`);
    } else {
      console.error(`Chrome already running on port ${options.port}`);
    }

    // 3. Create session (connects to CDP)
    // We need a temporary target just to connect to CDP
    // Then we'll use createOrFindTarget to get the right tab
    const tempResponse = await fetch(
      `http://127.0.0.1:${options.port}/json/list`
    );
    const tempTargets = await tempResponse.json();

    if (tempTargets.length === 0) {
      throw new Error('No targets available in Chrome');
    }

    // Use first available target to establish CDP connection
    session = new BdgSession(tempTargets[0], options.port);
    await session.connect();

    if (!session.isConnected()) {
      throw new Error('Failed to establish CDP connection');
    }

    // 4. Create or find target tab using TabManager
    console.error(`Finding or creating tab for: ${targetUrl}`);
    const target = await createOrFindTarget(
      url,
      session.getCDP(),
      options.reuseTab ?? false
    );
    console.error(`Using tab: ${target.url}`);

    // Fetch full target info with webSocketDebuggerUrl
    const fullTargetResponse = await fetch(
      `http://127.0.0.1:${options.port}/json/list`
    );
    const fullTargets = await fullTargetResponse.json();
    const fullTarget = fullTargets.find((t: any) => t.id === target.id);

    if (!fullTarget || !fullTarget.webSocketDebuggerUrl) {
      throw new Error(`Could not find webSocketDebuggerUrl for target ${target.id}`);
    }

    // Update session with the correct target
    // Close current session and reconnect to the correct target
    await session.getCDP().close();
    session = new BdgSession(fullTarget, options.port);
    await session.connect();

    // 5. Start collectors
    for (const collector of collectors) {
      await session.startCollector(collector);
    }

    // 6. Write session metadata
    writePid(process.pid);
    writeSessionMetadata({
      bdgPid: process.pid,
      chromePid: launchedChrome?.pid,
      startTime,
      port: options.port,
      targetId: fullTarget.id,
      webSocketDebuggerUrl: fullTarget.webSocketDebuggerUrl,
    });

    const collectorNames =
      collectors.length === 3
        ? 'network, console, and DOM'
        : collectors.join(', ');

    if (options.timeout) {
      console.error(
        `Collecting ${collectorNames}... (Ctrl+C to stop and output, or wait ${options.timeout}s for timeout)`
      );
      // Set timeout if explicitly provided
      setTimeout(() => {
        console.error(`\nTimeout reached (${options.timeout}s)`);
        handleStop();
      }, options.timeout * 1000);
    } else {
      console.error(
        `Collecting ${collectorNames}... (Ctrl+C to stop and output, or use 'bdg stop')`
      );
    }

    // 7. Set up preview interval for live data preview (two-tier system)
    previewInterval = setInterval(() => {
      if (session && session.isConnected()) {
        try {
          const target = session.getTarget();
          const allNetworkRequests = session.getNetworkRequests();
          const allConsoleLogs = session.getConsoleLogs();

          // Lightweight preview: metadata only, last 1000 items
          const previewOutput: BdgOutput = {
            success: true,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
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
            duration: Date.now() - startTime,
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

    // 8. Keep alive until signal or error
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
  } catch (error) {
    const errorOutput: BdgOutput = {
      success: false,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      target: { url: '', title: '' },
      data: {},
      error: error instanceof Error ? error.message : String(error)
    };

    console.log(JSON.stringify(errorOutput, null, 2));

    // Clear preview interval on error
    if (previewInterval) {
      clearInterval(previewInterval);
      previewInterval = null;
    }

    // Cleanup on error
    if (launchedChrome) {
      try {
        await launchedChrome.kill();
      } catch {}
    }
    cleanupSession();

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
    if (!isShuttingDown) {
      handleStop().catch((error) => {
        console.error('Fatal error during shutdown:', error);
        process.exit(1);
      });
    }
  });

  process.on('SIGTERM', () => {
    if (!isShuttingDown) {
      handleStop().catch((error) => {
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
