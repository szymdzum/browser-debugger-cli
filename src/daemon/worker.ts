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
 * - Worker sends JSON line to stdout on success: \{"type":"worker_ready",...\}
 * - Worker handles SIGTERM for graceful shutdown
 */

import { writeQueryCache, getNodeIdByIndex } from '@/cli/commands/dom/helpers/domCache.js';
import {
  queryBySelector,
  getNodeInfo,
  createNodePreview,
} from '@/cli/commands/dom/helpers/domQuery.js';
import { startConsoleCollection } from '@/collectors/console.js';
import { prepareDOMCollection, collectDOM } from '@/collectors/dom.js';
import { startNetworkCollection } from '@/collectors/network.js';
import { CDPConnection } from '@/connection/cdp.js';
import { launchChrome } from '@/connection/launcher.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import type { WorkerReadyMessage } from '@/daemon/workerIpc.js';
import type { COMMANDS, CommandName, WorkerRequestUnion, WorkerResponse } from '@/ipc/commands.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { writeSessionOutput } from '@/session/output.js';
import { writePid } from '@/session/pid.js';
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
import { getErrorMessage } from '@/utils/errors.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { waitForPageReady } from '@/utils/pageReadiness.js';
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

/**
 * Color presets for highlight overlay
 */
const HIGHLIGHT_COLORS = {
  red: { r: 255, g: 0, b: 0, a: 0.5 },
  blue: { r: 0, g: 0, b: 255, a: 0.5 },
  green: { r: 0, g: 255, b: 0, a: 0.5 },
  yellow: { r: 255, g: 255, b: 0, a: 0.5 },
  orange: { r: 255, g: 165, b: 0, a: 0.5 },
  purple: { r: 128, g: 0, b: 128, a: 0.5 },
} as const;

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
    throw new Error(`Failed to parse worker config: ${getErrorMessage(error)}`);
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
 * Command handler type - executes business logic for a command.
 * Handlers should throw errors (no try/catch or response wrapping).
 */
type CommandHandler<T extends CommandName> = (
  cdp: CDPConnection,
  params: (typeof COMMANDS)[T]['requestSchema']
) => Promise<(typeof COMMANDS)[T]['responseSchema']>;

/**
 * Command handler registry - maps command names to their business logic.
 */
const commandHandlers: { [K in CommandName]: CommandHandler<K> } = {
  /**
   * DOM Query Handler - Find elements by CSS selector
   */
  dom_query: async (cdp, params) => {
    // Ensure DOM is enabled
    await cdp.send('DOM.enable');

    // Query elements
    const nodeIds = await queryBySelector(cdp, params.selector);

    // Get information for each node
    const nodes: Array<{
      index: number;
      nodeId: number;
      tag?: string;
      classes?: string[];
      preview?: string;
    }> = [];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (nodeId === undefined) continue;

      const nodeInfo = await getNodeInfo(cdp, nodeId);
      nodes.push({
        index: i + 1,
        nodeId: nodeInfo.nodeId,
        ...(nodeInfo.tag !== undefined && { tag: nodeInfo.tag }),
        ...(nodeInfo.classes !== undefined && { classes: nodeInfo.classes }),
        preview: createNodePreview(nodeInfo),
      });
    }

    // Write cache for index-based lookups
    writeQueryCache({
      selector: params.selector,
      timestamp: new Date().toISOString(),
      nodes,
    });

    return {
      selector: params.selector,
      count: nodes.length,
      nodes,
    };
  },

  /**
   * DOM Highlight Handler - Highlight elements in browser
   */
  dom_highlight: async (cdp, params) => {
    // Ensure DOM and Overlay are enabled
    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');

    let nodeIds: number[] = [];

    // Direct nodeId provided
    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      // Look up nodeId from cache
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      // Query by selector
      nodeIds = await queryBySelector(cdp, params.selector);

      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }

      // Apply selector filters
      if (params.first) {
        const firstNode = nodeIds[0];
        if (firstNode === undefined) {
          throw new Error('No elements found');
        }
        nodeIds = [firstNode];
      } else if (params.nth !== undefined) {
        if (params.nth < 1 || params.nth > nodeIds.length) {
          throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
        }
        const nthNode = nodeIds[params.nth - 1];
        if (nthNode === undefined) {
          throw new Error(`Element at index ${params.nth} not found`);
        }
        nodeIds = [nthNode];
      }
    } else {
      throw new Error('Either selector, index, or nodeId must be provided');
    }

    // Prepare highlight color
    const colorName = (params.color ?? 'red') as keyof typeof HIGHLIGHT_COLORS;
    const color = HIGHLIGHT_COLORS[colorName] ?? HIGHLIGHT_COLORS.red;
    const opacity = params.opacity ?? color.a;

    // Highlight each node
    for (const nodeId of nodeIds) {
      await cdp.send('Overlay.highlightNode', {
        highlightConfig: {
          contentColor: { ...color, a: opacity },
        },
        nodeId,
      });
    }

    return {
      highlighted: nodeIds.length,
      nodeIds,
    };
  },

  /**
   * DOM Get Handler - Get full HTML and attributes for elements
   */
  dom_get: async (cdp, params) => {
    // Ensure DOM is enabled
    await cdp.send('DOM.enable');

    let nodeIds: number[] = [];

    // Direct nodeId provided
    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      // Look up nodeId from cache
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      // Query by selector
      nodeIds = await queryBySelector(cdp, params.selector);

      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }

      // Apply selector filters
      if (params.nth !== undefined) {
        if (params.nth < 1 || params.nth > nodeIds.length) {
          throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
        }
        const nthNode = nodeIds[params.nth - 1];
        if (nthNode === undefined) {
          throw new Error(`Element at index ${params.nth} not found`);
        }
        nodeIds = [nthNode];
      } else if (!params.all) {
        // Default: first match only
        const firstNode = nodeIds[0];
        if (firstNode === undefined) {
          throw new Error('No elements found');
        }
        nodeIds = [firstNode];
      }
    } else {
      throw new Error('Either selector, index, or nodeId must be provided');
    }

    // Get information for each node
    const nodes = [];
    for (const nodeId of nodeIds) {
      const info = await getNodeInfo(cdp, nodeId);
      nodes.push({
        nodeId: info.nodeId,
        ...(info.tag !== undefined && { tag: info.tag }),
        ...(info.attributes !== undefined && { attributes: info.attributes }),
        ...(info.classes !== undefined && { classes: info.classes }),
        ...(info.outerHTML !== undefined && { outerHTML: info.outerHTML }),
      });
    }

    return {
      nodes,
    };
  },

  /**
   * Worker Peek Handler - Return lightweight preview of collected data
   */
  worker_peek: async (_cdp, params) => {
    const lastN = Math.min(params.lastN ?? 10, 100); // Cap at 100
    const duration = Date.now() - sessionStartTime;

    // Get last N items (slice from end)
    const recentNetwork = networkRequests.slice(-lastN).map((req) => ({
      requestId: req.requestId,
      timestamp: req.timestamp,
      method: req.method,
      url: req.url,
      ...(req.status !== undefined && { status: req.status }),
      ...(req.mimeType !== undefined && { mimeType: req.mimeType }),
    }));

    const recentConsole = consoleMessages.slice(-lastN).map((msg) => ({
      timestamp: msg.timestamp,
      type: msg.type,
      text: msg.text,
    }));

    // Return as resolved Promise to satisfy async handler contract
    return Promise.resolve({
      version: VERSION,
      startTime: sessionStartTime,
      duration,
      target: {
        url: targetInfo?.url ?? '',
        title: targetInfo?.title ?? '',
      },
      activeCollectors,
      network: recentNetwork,
      console: recentConsole,
    });
  },

  /**
   * Worker Details Handler - Return full object for specific item
   */
  worker_details: async (_cdp, params) => {
    if (params.itemType === 'network') {
      const request = networkRequests.find((r) => r.requestId === params.id);
      if (!request) {
        return Promise.reject(new Error(`Network request not found: ${params.id}`));
      }
      return Promise.resolve({ item: request });
    } else if (params.itemType === 'console') {
      const index = parseInt(params.id, 10);
      if (isNaN(index) || index < 0 || index >= consoleMessages.length) {
        return Promise.reject(
          new Error(
            `Console message not found at index: ${params.id} (available: 0-${consoleMessages.length - 1})`
          )
        );
      }
      return Promise.resolve({ item: consoleMessages[index] });
    }
    // Unreachable due to type narrowing, but TypeScript doesn't see it
    return Promise.reject(
      new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
    );
  },

  /**
   * CDP Call Handler - Execute arbitrary CDP method
   */
  cdp_call: async (cdp, params) => {
    // Execute CDP method with provided parameters
    const result = await cdp.send(params.method, params.params ?? {});
    return { result };
  },
};

/**
 * Handle incoming IPC message from daemon via stdin.
 */
async function handleWorkerIPC(message: WorkerRequestUnion): Promise<void> {
  const commandName = message.type.replace('_request', '') as CommandName;
  const handler = commandHandlers[commandName];

  if (!handler) {
    console.error(`[worker] Unknown command: ${commandName}`);
    return;
  }

  console.error(`[worker] Handling ${commandName}_request`);

  try {
    if (!cdp) throw new Error('CDP connection not initialized');

    // Extract params by removing IPC metadata fields
    const { type: _type, requestId: _requestId, ...params } = message;

    // Call handler with properly typed params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const data = await handler(cdp, params as any);

    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: true,
      data,
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${commandName}_response (success)`);
  } catch (error) {
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: false,
      error: getErrorMessage(error),
    };

    console.log(JSON.stringify(response));
    console.error(`[worker] Sent ${commandName}_response (error: ${response.error})`);
  }
}

/**
 * Set up stdin listener for IPC commands from daemon.
 */
function setupStdinListener(): void {
  let buffer = '';

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    // Process complete JSONL frames (separated by newlines)
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as WorkerRequestUnion;
          void handleWorkerIPC(message);
        } catch (error) {
          console.error(`[worker] Failed to parse IPC message: ${getErrorMessage(error)}`);
        }
      }
    }
  });

  process.stdin.on('end', () => {
    console.error('[worker] Stdin closed, daemon disconnected');
  });

  console.error('[worker] Stdin listener set up for IPC commands');
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
    requestId: 'ready', // Special requestId for ready signal
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
        console.error(`[worker] Failed to collect DOM: ${getErrorMessage(error)}`);
      }
    }

    // Write final output
    console.error('[worker] Writing final output...');
    const finalOutput = buildOutput(false);
    writeSessionOutput(finalOutput);

    // Run cleanup functions
    console.error('[worker] Running collector cleanup functions...');
    for (const cleanup of cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[worker] Cleanup function error: ${getErrorMessage(error)}`);
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
    console.error(`[worker] Error during shutdown: ${getErrorMessage(error)}`);
    throw error;
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  console.error(`[worker] Starting (PID ${process.pid})`);

  let config: WorkerConfig;

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
      // P1.1: Exit gracefully if Chrome dies unexpectedly
      // WHY: Prevents zombie worker processes when Chrome crashes/closes
      onDisconnect: (code, reason) => {
        console.error(`[worker] Chrome connection lost (code: ${code}, reason: ${reason})`);
        console.error('[worker] Exiting due to Chrome connection loss');
        process.exit(0);
      },
    });
    console.error(`[worker] CDP connection established`);

    // Wait for page to be ready using smart detection
    await waitForPageReady(cdp, {
      maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
    });

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

    // Send ready signal to parent
    sendReadySignal(config);

    // Set up stdin listener for IPC commands from daemon
    setupStdinListener();

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
    console.error(`[worker] Fatal error: ${getErrorMessage(error)}`);

    // Cleanup on error
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
