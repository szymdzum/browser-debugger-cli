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
  readSessionOutput,
  getOutputFilePath,
  acquireSessionLock,
  writeSessionMetadata,
  cleanupSession
} from './utils/session.js';

const program = new Command();

// Global state for signal handling
let session: BdgSession | null = null;
let launchedChrome: LaunchedChrome | null = null;
let isShuttingDown = false;

async function handleStop() {
  if (isShuttingDown || !session) {
    return;
  }

  isShuttingDown = true;

  try {
    const output = await session.stop();

    // Write to file for 'bdg stop' to read
    writeSessionOutput(output);

    // Also output to stdout (for foreground use)
    console.log(JSON.stringify(output, null, 2));

    // Kill Chrome if we launched it
    if (launchedChrome) {
      console.error('Killing Chrome...');
      await launchedChrome.kill();
    }

    // Cleanup session files
    cleanupSession();

    process.exit(0);
  } catch (error) {
    const errorOutput: BdgOutput = {
      success: false,
      timestamp: new Date().toISOString(),
      duration: 0,
      target: { url: '', title: '' },
      data: {},
      error: error instanceof Error ? error.message : String(error)
    };

    // Write error output to file
    writeSessionOutput(errorOutput);

    console.log(JSON.stringify(errorOutput, null, 2));

    // Kill Chrome if we launched it
    if (launchedChrome) {
      try {
        await launchedChrome.kill();
      } catch {}
    }

    // Cleanup session files
    cleanupSession();

    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGINT', handleStop);
process.on('SIGTERM', handleStop);

async function run(
  url: string,
  options: { port: number; timeout?: number; reuseTab?: boolean },
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
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    await run(url, { port, timeout, reuseTab }, ['dom', 'network', 'console']);
  });

program
  .command('dom')
  .description('Collect DOM only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    await run(url, { port, timeout, reuseTab }, ['dom']);
  });

program
  .command('network')
  .description('Collect network requests only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    await run(url, { port, timeout, reuseTab }, ['network']);
  });

program
  .command('console')
  .description('Collect console logs only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('-r, --reuse-tab', 'Navigate existing tab instead of creating new one')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const reuseTab = options.reuseTab ?? false;
    await run(url, { port, timeout, reuseTab }, ['console']);
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

      // Get list of targets
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();

      if (targets.length === 0) {
        console.error('Error: No Chrome tabs found');
        process.exit(1);
      }

      // Use the first page target (usually the active tab)
      const target = targets.find((t: any) => t.type === 'page') || targets[0];

      if (!target.webSocketDebuggerUrl) {
        console.error('Error: Target has no webSocketDebuggerUrl');
        process.exit(1);
      }

      // Create temporary CDP connection
      const { CDPConnection } = await import('./connection/cdp.js');
      const cdp = new CDPConnection();
      await cdp.connect(target.webSocketDebuggerUrl);

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
  .description('Stop the active collection session and output results')
  .action(async () => {
    try {
      // Read PID
      const pid = readPid();
      if (!pid) {
        console.error('Error: No active session found');
        console.error('Start a session with: bdg <url>');
        process.exit(1);
      }

      // Check if process is alive
      if (!isProcessAlive(pid)) {
        console.error(`Error: Session process (PID ${pid}) is not running`);
        console.error('The session may have already finished or crashed.');
        cleanupSession();

        // Try to read last output if it exists
        const lastOutput = readSessionOutput();
        if (lastOutput) {
          console.error('\nLast session output:');
          console.log(JSON.stringify(lastOutput, null, 2));
          process.exit(0);
        }
        process.exit(1);
      }

      console.error(`Stopping session (PID ${pid})...`);

      // Send SIGINT to gracefully stop the session
      process.kill(pid, 'SIGINT');

      // Wait for process to exit and write output (max 10s)
      const outputPath = getOutputFilePath();
      let waited = 0;
      const maxWait = 10000; // 10 seconds
      const checkInterval = 100; // 100ms

      while (waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;

        // Check if output file was updated recently (within last 500ms)
        try {
          const stats = await import('fs').then(fs => fs.promises.stat(outputPath));
          const fileAge = Date.now() - stats.mtimeMs;

          if (fileAge < 500) {
            // File was just written, wait a bit more to ensure write is complete
            await new Promise(resolve => setTimeout(resolve, 200));
            break;
          }
        } catch (error) {
          // File doesn't exist yet, keep waiting
        }

        // Check if process has exited
        if (!isProcessAlive(pid)) {
          // Process exited, wait a bit for file write
          await new Promise(resolve => setTimeout(resolve, 200));
          break;
        }
      }

      // Read and output the session data
      const output = readSessionOutput();
      if (output) {
        console.log(JSON.stringify(output, null, 2));
        process.exit(0);
      } else {
        console.error('Error: Failed to read session output');
        console.error(`Expected output at: ${outputPath}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error stopping session: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
