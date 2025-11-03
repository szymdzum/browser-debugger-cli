#!/usr/bin/env node
/**
 * Worker Process - Chrome CDP Session Manager
 *
 * This process:
 * 1. Spawns Chrome with remote debugging enabled
 * 2. Connects to Chrome via CDP WebSocket
 * 3. Activates requested collectors (network, console, DOM)
 * 4. Sends readiness signal to parent daemon
 * 5. Handles graceful shutdown on SIGTERM/SIGKILL
 *
 * Communication Protocol:
 * - Parent provides config via env vars or process.argv
 * - Worker sends JSON line to stdout on success: {"type":"worker_ready",...}
 * - Worker handles SIGTERM for graceful shutdown
 */

import { startConsoleCollection } from '@/collectors/console.js';
import { prepareDOMCollection, collectDOM } from '@/collectors/dom.js';
import { startNetworkCollection } from '@/collectors/network.js';
import { CDPConnection } from '@/connection/cdp.js';
import { launchChrome } from '@/connection/launcher.js';
import type {
  CollectorType,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  CleanupFunction,
  LaunchedChrome,
  CDPTarget,
  BdgOutput,
} from '@/types';
import { fetchCDPTargets } from '@/utils/http.js';
import {
  writePartialOutputAsync,
  writeFullOutputAsync,
  writePid,
  writeSessionMetadata,
} from '@/utils/session.js';
import { normalizeUrl } from '@/utils/url.js';
import { VERSION } from '@/utils/version.js';

interface WorkerConfig {
  url: string;
  port: number;
  timeout?: number | undefined;
  collectors?: CollectorType[] | undefined;
  includeAll?: boolean | undefined;
  userDataDir?: string | undefined;
  maxBodySize?: number | undefined;
}

interface WorkerReadyMessage {
  type: 'worker_ready';
  workerPid: number;
  chromePid: number;
  port: number;
  target: {
    url: string;
    title?: string;
  };
}

// Global state for cleanup
let chrome: LaunchedChrome | null = null;
let cdp: CDPConnection | null = null;
let cleanupFunctions: CleanupFunction[] = [];

// Collector data storage
const networkRequests: NetworkRequest[] = [];
const consoleMessages: ConsoleMessage[] = [];
let domData: DOMData | null = null;

// Session metadata
let sessionStartTime: number = Date.now();
let targetInfo: CDPTarget | null = null;
let activeCollectors: CollectorType[] = [];

/**
 * Parse worker configuration from environment variables or argv.
 */
function parseWorkerConfig(): WorkerConfig {
  // For MVP: parse from argv (future: could use env vars or stdin)
  const args = process.argv.slice(2);

  if (args.length === 0) {
    throw new Error('Worker requires configuration arguments');
  }

  // Parse simple JSON config from first argument
  try {
    const configArg = args[0];
    if (!configArg) {
      throw new Error('Missing configuration argument');
    }
    const config = JSON.parse(configArg) as WorkerConfig;
    return {
      url: config.url,
      port: config.port ?? 9222,
      timeout: config.timeout ?? undefined,
      collectors: config.collectors ?? ['network', 'console', 'dom'],
      includeAll: config.includeAll ?? false,
      userDataDir: config.userDataDir ?? undefined,
      maxBodySize: config.maxBodySize ?? undefined,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse worker config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Activate collectors based on configuration.
 */
async function activateCollectors(config: WorkerConfig): Promise<void> {
  if (!cdp) {
    throw new Error('CDP connection not initialized');
  }

  activeCollectors = config.collectors ?? ['network', 'console', 'dom'];

  for (const collector of activeCollectors) {
    console.error(`[worker] Activating ${collector} collector`);

    switch (collector) {
      case 'network':
        {
          const networkOptions = {
            includeAll: config.includeAll ?? false,
            ...(config.maxBodySize !== undefined && { maxBodySize: config.maxBodySize }),
          };
          const cleanup = await startNetworkCollection(cdp, networkRequests, networkOptions);
          cleanupFunctions.push(cleanup);
        }
        break;

      case 'console':
        {
          const cleanup = await startConsoleCollection(
            cdp,
            consoleMessages,
            config.includeAll ?? false
          );
          cleanupFunctions.push(cleanup);
        }
        break;

      case 'dom':
        {
          const cleanup = await prepareDOMCollection(cdp);
          cleanupFunctions.push(cleanup);
        }
        break;
    }
  }

  console.error(`[worker] All collectors activated: ${activeCollectors.join(', ')}`);
}

/**
 * Send worker_ready signal to parent via stdout.
 */
function sendReadySignal(config: WorkerConfig): void {
  if (!chrome || !targetInfo) {
    throw new Error('Cannot send ready signal: Chrome or target not initialized');
  }

  const message: WorkerReadyMessage = {
    type: 'worker_ready',
    workerPid: process.pid,
    chromePid: chrome.pid,
    port: config.port,
    target: {
      url: targetInfo.url,
      title: targetInfo.title,
    },
  };

  // Send JSON line to stdout for parent to parse
  console.log(JSON.stringify(message));
  console.error(`[worker] Ready signal sent (PID ${process.pid}, Chrome PID ${chrome.pid})`);
}

/**
 * Start preview data persistence loop.
 * Writes lightweight preview and full data every 5 seconds.
 */
function startPreviewLoop(): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      try {
        const output = buildOutput(true);
        await writePartialOutputAsync(output);
        await writeFullOutputAsync(output);
      } catch (error) {
        console.error(
          `[worker] Failed to write preview data: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })();
  }, 5000);
}

/**
 * Build BdgOutput structure from collected data.
 */
function buildOutput(partial: boolean = false): BdgOutput {
  const duration = Date.now() - sessionStartTime;

  const data: BdgOutput['data'] = {};
  if (networkRequests.length > 0) {
    data.network = networkRequests;
  }
  if (consoleMessages.length > 0) {
    data.console = consoleMessages;
  }
  if (domData) {
    data.dom = domData;
  }

  return {
    version: VERSION,
    success: true,
    timestamp: new Date(sessionStartTime).toISOString(),
    duration,
    target: {
      url: targetInfo?.url ?? '',
      title: targetInfo?.title ?? '',
    },
    data,
    ...(partial && { partial: true }),
  };
}

/**
 * Graceful shutdown: collect final DOM, write session.json, cleanup.
 */
async function gracefulShutdown(): Promise<void> {
  console.error('[worker] Starting graceful shutdown...');

  try {
    // Collect final DOM snapshot if DOM collector is active
    if (activeCollectors.includes('dom') && cdp) {
      console.error('[worker] Collecting final DOM snapshot...');
      try {
        domData = await collectDOM(cdp);
        console.error('[worker] DOM snapshot collected');
      } catch (error) {
        console.error(
          `[worker] Failed to collect DOM: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Write final output
    console.error('[worker] Writing final output...');
    const finalOutput = buildOutput(false);
    await writePartialOutputAsync(finalOutput);
    await writeFullOutputAsync(finalOutput);

    // Run cleanup functions
    console.error('[worker] Running collector cleanup functions...');
    for (const cleanup of cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(
          `[worker] Cleanup function error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Close CDP connection
    if (cdp) {
      console.error('[worker] Closing CDP connection...');
      cdp.close();
      cdp = null;
    }

    // Kill Chrome
    if (chrome) {
      console.error(`[worker] Terminating Chrome (PID ${chrome.pid})...`);
      await chrome.kill();
      chrome = null;
    }

    console.error('[worker] Graceful shutdown complete');
  } catch (error) {
    console.error(
      `[worker] Error during shutdown: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  console.error(`[worker] Starting (PID ${process.pid})`);

  let config: WorkerConfig;
  let previewInterval: NodeJS.Timeout | null = null;

  try {
    // Parse configuration
    config = parseWorkerConfig();
    console.error(`[worker] Config: ${JSON.stringify(config)}`);

    // Write worker PID immediately
    writePid(process.pid);

    // Normalize URL
    const normalizedUrl = normalizeUrl(config.url);
    console.error(`[worker] Normalized URL: ${normalizedUrl}`);

    // Launch Chrome
    console.error(`[worker] Launching Chrome on port ${config.port}...`);
    const launchOptions = {
      port: config.port,
      url: normalizedUrl,
      ...(config.userDataDir !== undefined && { userDataDir: config.userDataDir }),
    };
    chrome = await launchChrome(launchOptions);
    console.error(`[worker] Chrome launched (PID ${chrome.pid})`);

    // Connect to Chrome via CDP
    console.error(`[worker] Connecting to Chrome via CDP...`);
    const targets = await fetchCDPTargets(config.port);

    // Find target by exact URL match, fallback to hostname match
    let target = targets.find((t) => t.url === normalizedUrl);
    if (!target) {
      const urlObj = new URL(normalizedUrl);
      target = targets.find((t) => t.url.includes(urlObj.hostname));
    }

    if (!target) {
      throw new Error(`Target not found for URL: ${normalizedUrl}`);
    }

    targetInfo = target;
    console.error(`[worker] Found target: ${target.title} (${target.url})`);

    // Establish CDP connection
    cdp = new CDPConnection();
    await cdp.connect(target.webSocketDebuggerUrl, {
      autoReconnect: false,
      maxRetries: 10,
    });
    console.error(`[worker] CDP connection established`);

    // Activate collectors
    await activateCollectors(config);

    // Write session metadata for status command
    writeSessionMetadata({
      bdgPid: process.pid,
      chromePid: chrome.pid,
      startTime: sessionStartTime,
      port: config.port,
      targetId: target.id,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      activeCollectors,
    });
    console.error(`[worker] Session metadata written`);

    // Start preview data persistence
    previewInterval = startPreviewLoop();
    console.error(`[worker] Preview persistence started (5s interval)`);

    // Send ready signal to parent
    sendReadySignal(config);

    // Set up shutdown handlers
    process.on('SIGTERM', () => {
      console.error('[worker] Received SIGTERM');
      void gracefulShutdown().then(() => process.exit(0));
    });

    process.on('SIGINT', () => {
      console.error('[worker] Received SIGINT');
      void gracefulShutdown().then(() => process.exit(0));
    });

    // Handle timeout if specified
    if (config.timeout) {
      console.error(`[worker] Auto-stop after ${config.timeout}s`);
      setTimeout(() => {
        console.error('[worker] Timeout reached, initiating shutdown');
        void gracefulShutdown().then(() => process.exit(0));
      }, config.timeout * 1000);
    }

    // Keep process alive
    console.error('[worker] Session active, waiting for signal or timeout...');
  } catch (error) {
    console.error(
      `[worker] Fatal error: ${error instanceof Error ? error.message : String(error)}`
    );

    // Cleanup on error
    if (previewInterval) {
      clearInterval(previewInterval);
    }

    if (cdp) {
      cdp.close();
    }

    if (chrome) {
      await chrome.kill();
    }

    process.exit(1);
  }
}

// Start worker
void main();
