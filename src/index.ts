#!/usr/bin/env node

import { Command } from 'commander';
import { findTarget } from './connection/finder.js';
import { launchChrome, isChromeRunning } from './connection/launcher.js';
import { BdgSession } from './session/BdgSession.js';
import { BdgOutput, CollectorType } from './types.js';

const program = new Command();

// Global state for signal handling
let session: BdgSession | null = null;
let isShuttingDown = false;

async function handleStop() {
  if (isShuttingDown || !session) {
    return;
  }

  isShuttingDown = true;

  try {
    const output = await session.stop();
    console.log(JSON.stringify(output, null, 2));
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

    console.log(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGINT', handleStop);
process.on('SIGTERM', handleStop);

async function run(url: string, options: { port: number; timeout?: number; noLaunch?: boolean }, collectors: CollectorType[]) {
  const startTime = Date.now();

  try {
    // Normalize URL - add http:// if no protocol specified
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
      targetUrl = `http://${url}`;
    }

    // Check if Chrome is running with CDP, if not launch it
    if (!options.noLaunch) {
      const chromeRunning = await isChromeRunning(options.port);
      if (!chromeRunning) {
        console.error(`Launching Chrome with CDP on port ${options.port}...`);
        await launchChrome({
          port: options.port,
          headless: false,
          url: targetUrl
        });
        console.error('Chrome launched successfully');
      } else {
        console.error(`Chrome already running on port ${options.port}`);
      }
    }

    // Find target
    const target = await findTarget(url, options.port);
    console.error(`Connected to ${target.url}`);

    // Create session
    session = new BdgSession(target, options.port);

    // Connect to CDP
    await session.connect();

    // Handle disconnection
    if (!session.isConnected()) {
      throw new Error('Failed to establish CDP connection');
    }

    // Start collectors
    for (const collector of collectors) {
      await session.startCollector(collector);
    }

    const collectorNames = collectors.length === 3
      ? 'network, console, and DOM'
      : collectors.join(', ');

    console.error(`Collecting ${collectorNames}... (Ctrl+C to stop and output)`);

    // Optional timeout
    if (options.timeout) {
      setTimeout(() => {
        console.error(`\nTimeout reached (${options.timeout}s)`);
        handleStop();
      }, options.timeout * 1000);
    }

    // Keep alive until signal
    await new Promise<void>((_, reject) => {
      const connectionCheckInterval = setInterval(() => {
        if (session && !session.isConnected()) {
          clearInterval(connectionCheckInterval);
          reject(new Error('WebSocket connection lost - browser tab may have closed or navigated'));
        }
      }, 1000);
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
  .option('--no-launch', 'Skip auto-launching Chrome (use existing instance)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    await run(url, { port, timeout, noLaunch: options.noLaunch }, ['dom', 'network', 'console']);
  });

program
  .command('dom')
  .description('Collect DOM only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('--no-launch', 'Skip auto-launching Chrome (use existing instance)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    await run(url, { port, timeout, noLaunch: options.noLaunch }, ['dom']);
  });

program
  .command('network')
  .description('Collect network requests only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('--no-launch', 'Skip auto-launching Chrome (use existing instance)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    await run(url, { port, timeout, noLaunch: options.noLaunch }, ['network']);
  });

program
  .command('console')
  .description('Collect console logs only')
  .argument('<url>', 'Target URL')
  .option('-p, --port <number>', 'Chrome debugging port', '9222')
  .option('-t, --timeout <seconds>', 'Auto-stop after timeout (optional)')
  .option('--no-launch', 'Skip auto-launching Chrome (use existing instance)')
  .action(async (url: string, options) => {
    const port = parseInt(options.port);
    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    await run(url, { port, timeout, noLaunch: options.noLaunch }, ['console']);
  });

program.parse();
