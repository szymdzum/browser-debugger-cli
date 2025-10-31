#!/usr/bin/env node

import { Command } from 'commander';
import { launchChrome, isChromeRunning } from './connection/launcher.js';
import { BdgSession } from './session/BdgSession.js';
import { BdgOutput, CollectorType, CDPTargetDestroyedParams, LaunchedChrome } from './types.js';
import { normalizeUrl } from './utils/url.js';
import { validateCollectorTypes } from './utils/validation.js';
import { createOrFindTarget } from './connection/tabs.js';
import {
  writePid,
  readPid,
  isProcessAlive,
  writeSessionOutput,
  acquireSessionLock,
  writeSessionMetadata,
  cleanupSession
} from './utils/session.js';

const program = new Command();

// Global state for signal handling
let session: BdgSession | null = null;
let launchedChrome: LaunchedChrome | null = null;
let isShuttingDown = false;
let shutdownKeepalive: NodeJS.Timeout | null = null;

async function handleStop() {
  if (isShuttingDown || !session) {
    return;
  }

  isShuttingDown = true;

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

async function run(
  url: string,
  options: { port: number; timeout?: number; reuseTab?: boolean; userDataDir?: string },
  collectors: CollectorType[]
) {
  const startTime = Date.now();

  try {
    // 1. Acquire session lock
    if (!acquireSessionLock()) {
      const existingPid = readPid();
      throw new Error(
        `Session already running (PID ${existingPid}). Stop it with: bdg stop`
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

    // 7. Keep alive until signal or error
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

program
  .name('bdg')
  .description('Browser telemetry via Chrome DevTools Protocol')
  .version('0.1.0');

program
  .argument('<url>', 'Target URL (example.com or localhost:3000)')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    const userDataDir = options.userDataDir;
    await run(url, { port, timeout, reuseTab, userDataDir }, ['dom', 'network', 'console']);
  });

program
  .command('dom')
  .description('Collect DOM only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    const userDataDir = options.userDataDir;
    await run(url, { port, timeout, reuseTab, userDataDir }, ['dom']);
  });

program
  .command('network')
  .description('Collect network requests only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    const userDataDir = options.userDataDir;
    await run(url, { port, timeout, reuseTab, userDataDir }, ['network']);
  });

program
  .command('console')
  .description('Collect console logs only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .option('-u, --user-data-dir <path>', 'Chrome user data directory (default: ~/.bdg/chrome-profile)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    const userDataDir = options.userDataDir;
    await run(url, { port, timeout, reuseTab, userDataDir }, ['console']);
  });

program
  .command('query')
  .description('Execute JavaScript in the active session for live debugging')
  .argument('<script>', 'JavaScript to execute (e.g., "document.querySelector(\'input[type=email]\').value")')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .action(async (script: string, options) => {
    try {
      const port = parseInt(options.port);

      // Check if session is running
      const pid = readPid();
      if (!pid || !isProcessAlive(pid)) {
        console.error('Error: No active session running');
        console.error('Start a session with: bdg <url>');
        process.exit(1);
      }

      // Read session metadata to get the target ID
      const { readSessionMetadata } = await import('./utils/session.js');
      const metadata = readSessionMetadata();

      if (!metadata || !metadata.targetId || !metadata.webSocketDebuggerUrl) {
        console.error('Error: No target information in session metadata');
        console.error('Session may have been started with an older version');
        process.exit(1);
      }

      // Verify the target still exists
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((t: any) => t.id === metadata.targetId);

      if (!target) {
        console.error('Error: Session target not found (tab may have been closed)');
        console.error('Start a new session with: bdg <url>');
        process.exit(1);
      }

      // Create temporary CDP connection using stored webSocketDebuggerUrl
      const { CDPConnection } = await import('./connection/cdp.js');
      const cdp = new CDPConnection();
      await cdp.connect(metadata.webSocketDebuggerUrl);

      // Execute JavaScript
      const result = await cdp.send('Runtime.evaluate', {
        expression: script,
        returnByValue: true,
        awaitPromise: true
      });

      await cdp.close();

      // Output result
      if (result.exceptionDetails) {
        console.error('Error executing script:');
        console.error(result.exceptionDetails.exception.description);
        process.exit(1);
      }

      console.log(JSON.stringify(result.result.value, null, 2));
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop all active sessions and free ports (does not capture output)')
  .option('--kill-chrome', 'Also kill Chrome browser')
  .action(async (options) => {
    try {
      const { readSessionMetadata } = await import('./utils/session.js');

      // Read PID
      const pid = readPid();
      if (!pid) {
        console.error('No active session found');
        console.error('All ports should be free');
        process.exit(0);
      }

      console.error(`Stopping session (PID ${pid})...`);

      // Read metadata BEFORE killing the process (so we can get Chrome PID)
      const metadata = readSessionMetadata();

      // Kill the bdg process (use SIGKILL for immediate termination)
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
          console.error(`✓ Killed bdg session (PID ${pid})`);
        } catch (killError) {
          console.error(`Warning: Could not kill process ${pid}:`, killError);
        }
      } else {
        console.error(`Process ${pid} already stopped`);
      }

      // Kill Chrome if requested
      if (options.killChrome) {
        if (metadata?.chromePid) {
          try {
            if (isProcessAlive(metadata.chromePid)) {
              process.kill(metadata.chromePid, 'SIGTERM');
              console.error(`✓ Killed Chrome (PID ${metadata.chromePid})`);
            } else {
              console.error(`Chrome process (PID ${metadata.chromePid}) already stopped`);
            }
          } catch (chromeError) {
            console.error(`Warning: Could not kill Chrome:`, chromeError);
          }
        } else {
          console.error('Warning: Chrome PID not found in session metadata');
        }
      } else {
        console.error('Leaving Chrome running (use --kill-chrome to close it)');
      }

      // Clean up session files
      cleanupSession();
      console.error('✓ Cleaned up session files');
      console.error('\nAll sessions stopped and ports freed');

      process.exit(0);
    } catch (error) {
      console.error(`Error stopping session: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
