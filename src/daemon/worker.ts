#!/usr/bin/env node
/**
 * Worker Process - Chrome CDP Session Manager
 *
 * This process:
 * 1. Spawns Chrome with remote debugging enabled
 * 2. Connects to Chrome via CDP WebSocket
 * 3. Activates requested telemetry modules (network, console, DOM)
 * 4. Sends readiness signal to parent daemon
 * 5. Handles graceful shutdown on SIGTERM/SIGKILL
 *
 * Communication Protocol:
 * - Parent provides config via env vars or process.argv
 * - Worker sends JSON line to stdout on success: \{"type":"worker_ready",...\}
 * - Worker handles SIGTERM for graceful shutdown
 */

import { CDPConnection } from '@/connection/cdp.js';
import { queryBySelector, getNodeInfo, createNodePreview } from '@/connection/domOperations.js';
import { launchChrome } from '@/connection/launcher.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import type { WorkerReadyMessage } from '@/daemon/workerIpc.js';
import type {
  COMMANDS,
  CommandName,
  WorkerRequestUnion,
  WorkerResponse,
  WorkerStatusData,
} from '@/ipc/commands.js';
import { writeChromePid } from '@/session/chrome.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { writeSessionOutput } from '@/session/output.js';
import { writePid } from '@/session/pid.js';
import { isProcessAlive, killChromeProcess } from '@/session/process.js';
import { writeQueryCache, getNodeIdByIndex } from '@/session/queryCache.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import { startDialogHandling } from '@/telemetry/dialogs.js';
import { prepareDOMCollection, collectDOM } from '@/telemetry/dom.js';
import { startNavigationTracking, type NavigationEvent } from '@/telemetry/navigation.js';
import { startNetworkCollection } from '@/telemetry/network.js';
import type {
  TelemetryType,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  CleanupFunction,
  LaunchedChrome,
  CDPTarget,
  BdgOutput,
} from '@/types';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  chromeExternalConnectionMessage,
  chromeExternalWebSocketMessage,
  chromeExternalNoPidMessage,
  chromeExternalSkipTerminationMessage,
  noPageTargetFoundError,
} from '@/ui/messages/chrome.js';
import {
  workerActivatingCollector,
  workerCollectorsActivated,
  workerUnknownCommand,
  workerHandlingCommand,
  workerCommandResponse,
  workerIPCParseError,
  workerStdinClosed,
  workerStdinListenerSetup,
  workerReadySignalSent,
  workerCollectingDOM,
  workerDOMCollected,
  workerDOMCollectionFailed,
  workerWritingOutput,
  workerRunningCleanup,
  workerClosingCDP,
  workerShutdownComplete,
  workerExitingConnectionLoss,
  workerReceivedSIGTERM,
  workerReceivedSIGINT,
  workerTimeoutReached,
  workerSessionActive,
} from '@/ui/messages/debug.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';
import { waitForPageReady } from '@/utils/pageReadiness.js';
import { normalizeUrl } from '@/utils/url.js';
import { VERSION } from '@/utils/version.js';

const log = createLogger('worker');

interface WorkerConfig {
  url: string;
  port: number;
  timeout?: number | undefined;
  telemetry?: TelemetryType[] | undefined;
  includeAll?: boolean | undefined;
  userDataDir?: string | undefined;
  maxBodySize?: number | undefined;
  headless?: boolean | undefined;
  /** WebSocket URL for connecting to existing Chrome instance (skips Chrome launch) */
  chromeWsUrl?: string | undefined;
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

let chrome: LaunchedChrome | null = null;
let cdp: CDPConnection | null = null;
let cleanupFunctions: CleanupFunction[] = [];

const networkRequests: NetworkRequest[] = [];
const consoleMessages: ConsoleMessage[] = [];
const navigationEvents: NavigationEvent[] = [];
let domData: DOMData | null = null;
let getCurrentNavigationId: (() => number) | null = null;

let sessionStartTime: number = Date.now();
let targetInfo: CDPTarget | null = null;
let activeTelemetry: TelemetryType[] = [];

/**
 * Parse worker configuration from environment variables or argv.
 */
function parseWorkerConfig(): WorkerConfig {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    throw new Error('Worker requires configuration arguments');
  }

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
      telemetry: config.telemetry ?? ['network', 'console', 'dom'],
      includeAll: config.includeAll ?? false,
      userDataDir: config.userDataDir ?? undefined,
      maxBodySize: config.maxBodySize ?? undefined,
      headless: config.headless ?? false,
      chromeWsUrl: config.chromeWsUrl ?? undefined,
    };
  } catch (error) {
    throw new Error(`Failed to parse worker config: ${getErrorMessage(error)}`);
  }
}

/**
 * Activate telemetry modules based on configuration.
 */
async function activateCollectors(config: WorkerConfig): Promise<void> {
  if (!cdp) {
    throw new Error('CDP connection not initialized');
  }

  activeTelemetry = config.telemetry ?? ['network', 'console', 'dom'];

  {
    log.debug('Enabling dialog auto-dismissal');
    const cleanup = await startDialogHandling(cdp);
    cleanupFunctions.push(cleanup);
  }

  {
    log.debug('Enabling navigation tracking');
    const { cleanup, getCurrentNavigationId: getNavId } = await startNavigationTracking(
      cdp,
      navigationEvents
    );
    getCurrentNavigationId = getNavId;
    cleanupFunctions.push(cleanup);
  }

  for (const collector of activeTelemetry) {
    log.debug(workerActivatingCollector(collector));

    switch (collector) {
      case 'network':
        {
          const networkOptions = {
            includeAll: config.includeAll ?? false,
            getCurrentNavigationId,
            ...filterDefined({
              maxBodySize: config.maxBodySize,
            }),
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
            config.includeAll ?? false,
            getCurrentNavigationId ?? undefined
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

  log.debug(workerCollectorsActivated(activeTelemetry));
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
    await cdp.send('DOM.enable');

    const nodeIds = await queryBySelector(cdp, params.selector);

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
        ...filterDefined({
          tag: nodeInfo.tag,
          classes: nodeInfo.classes,
        }),
        preview: createNodePreview(nodeInfo),
      });
    }

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
    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');

    let nodeIds: number[] = [];

    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      nodeIds = await queryBySelector(cdp, params.selector);

      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }

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

    const colorName = (params.color ?? 'red') as keyof typeof HIGHLIGHT_COLORS;
    const color = HIGHLIGHT_COLORS[colorName] ?? HIGHLIGHT_COLORS.red;
    const opacity = params.opacity ?? color.a;

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
    await cdp.send('DOM.enable');

    let nodeIds: number[] = [];

    if (params.nodeId !== undefined) {
      nodeIds = [params.nodeId];
    } else if (params.index !== undefined) {
      const nodeId = getNodeIdByIndex(params.index);
      if (!nodeId) {
        throw new Error(
          `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
        );
      }
      nodeIds = [nodeId];
    } else if (params.selector) {
      nodeIds = await queryBySelector(cdp, params.selector);

      if (nodeIds.length === 0) {
        throw new Error(`No elements found matching "${params.selector}"`);
      }

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
        const firstNode = nodeIds[0];
        if (firstNode === undefined) {
          throw new Error('No elements found');
        }
        nodeIds = [firstNode];
      }
    } else {
      throw new Error('Either selector, index, or nodeId must be provided');
    }

    const nodes = [];
    for (const nodeId of nodeIds) {
      const info = await getNodeInfo(cdp, nodeId);
      nodes.push({
        nodeId: info.nodeId,
        ...filterDefined({
          tag: info.tag,
          attributes: info.attributes,
          classes: info.classes,
          outerHTML: info.outerHTML,
        }),
      });
    }

    return {
      nodes,
    };
  },

  /**
   * DOM Screenshot Handler - Capture page screenshot
   */
  dom_screenshot: async (cdp, params) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const absolutePath = path.resolve(params.path);

    const parentDir = path.dirname(absolutePath);
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'EEXIST') {
        throw new Error(`Cannot create directory ${parentDir}: ${getErrorMessage(error)}`);
      }
    }

    const format = params.format ?? 'png';
    const quality = params.quality;
    const fullPage = params.fullPage ?? true;

    if (format === 'jpeg' && quality !== undefined && (quality < 0 || quality > 100)) {
      throw new Error('JPEG quality must be between 0 and 100');
    }

    const screenshotParams: Record<string, unknown> = {
      format,
      ...filterDefined({
        quality: format === 'jpeg' ? quality : undefined,
        captureBeyondViewport: fullPage ? true : undefined,
      }),
    };

    interface ScreenshotResponse {
      data: string; // Base64 encoded image
    }

    const response = (await cdp.send(
      'Page.captureScreenshot',
      screenshotParams
    )) as ScreenshotResponse;
    const imageData = Buffer.from(response.data, 'base64');

    await fs.writeFile(absolutePath, imageData);

    const stats = await fs.stat(absolutePath);

    let viewport: { width: number; height: number } | undefined;
    if (!fullPage) {
      interface MetricsResponse {
        layoutViewport: {
          clientWidth: number;
          clientHeight: number;
        };
      }
      const metrics = (await cdp.send('Page.getLayoutMetrics')) as MetricsResponse;
      viewport = {
        width: metrics.layoutViewport.clientWidth,
        height: metrics.layoutViewport.clientHeight,
      };
    }

    interface LayoutMetrics {
      contentSize: {
        width: number;
        height: number;
      };
    }
    const layoutMetrics = (await cdp.send('Page.getLayoutMetrics')) as LayoutMetrics;

    return {
      path: absolutePath,
      format,
      ...(format === 'jpeg' && quality !== undefined && { quality }),
      width: layoutMetrics.contentSize.width,
      height: layoutMetrics.contentSize.height,
      size: stats.size,
      ...(viewport && { viewport }),
      fullPage,
    };
  },

  /**
   * Worker Peek Handler - Return lightweight preview of collected data
   */
  worker_peek: async (_cdp, params) => {
    const lastN = Math.min(params.lastN ?? 10, 100); // Cap at 100
    const duration = Date.now() - sessionStartTime;

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

    return Promise.resolve({
      version: VERSION,
      startTime: sessionStartTime,
      duration,
      target: {
        url: targetInfo?.url ?? '',
        title: targetInfo?.title ?? '',
      },
      activeTelemetry,
      network: recentNetwork,
      console: recentConsole,
    });
  },

  /**
   * Worker Details Handler - Return full object for specific item
   *
   * Note: Navigation validation is intentionally skipped here. Historical network requests
   * and console messages remain valid even after page navigation, as they represent a
   * historical record of what happened. Stale reference checks only apply to live DOM
   * operations where elements might no longer exist.
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

      const message = consoleMessages[index];
      if (!message) {
        return Promise.reject(new Error(`Console message not found at index: ${params.id}`));
      }

      return Promise.resolve({ item: message });
    }
    return Promise.reject(
      new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
    );
  },

  /**
   * Worker Status Handler - Return live activity metrics and session state
   *
   * Provides comprehensive status information including activity counts,
   * last activity timestamps, current page state, and active telemetry modules.
   * Used by the status command to show detailed session information.
   */
  worker_status: async (_cdp, _params) => {
    const duration = Date.now() - sessionStartTime;

    const lastNetworkRequest = networkRequests[networkRequests.length - 1];
    const lastConsoleMessage = consoleMessages[consoleMessages.length - 1];

    const result: WorkerStatusData = {
      startTime: sessionStartTime,
      duration,
      target: {
        url: targetInfo?.url ?? '',
        title: targetInfo?.title ?? '',
      },
      activeTelemetry,
      activity: {
        networkRequestsCaptured: networkRequests.length,
        consoleMessagesCaptured: consoleMessages.length,
        ...(lastNetworkRequest?.timestamp !== undefined && {
          lastNetworkRequestAt: lastNetworkRequest.timestamp,
        }),
        ...(lastConsoleMessage?.timestamp !== undefined && {
          lastConsoleMessageAt: lastConsoleMessage.timestamp,
        }),
      },
    };

    return Promise.resolve(result);
  },

  /**
   * CDP Call Handler - Execute arbitrary CDP method
   */
  cdp_call: async (cdp, params) => {
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
    log.debug(workerUnknownCommand(commandName));
    return;
  }

  log.debug(workerHandlingCommand(commandName));

  try {
    if (!cdp) throw new Error('CDP connection not initialized');

    const { type: _type, requestId: _requestId, ...params } = message;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const data = await handler(cdp, params as any);

    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: true,
      data,
    };

    console.log(JSON.stringify(response));
    log.debug(workerCommandResponse(commandName, true));
  } catch (error) {
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: false,
      error: getErrorMessage(error),
    };

    console.log(JSON.stringify(response));
    log.debug(workerCommandResponse(commandName, false, response.error));
  }
}

/**
 * Set up stdin listener for IPC commands from daemon.
 */
function setupStdinListener(): void {
  let buffer = '';

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as WorkerRequestUnion;
          void handleWorkerIPC(message);
        } catch (error) {
          log.debug(workerIPCParseError(getErrorMessage(error)));
        }
      }
    }
  });

  process.stdin.on('end', () => {
    log.debug(workerStdinClosed());
  });

  log.debug(workerStdinListenerSetup());
}

/**
 * Send worker_ready signal to parent via stdout.
 */
function sendReadySignal(config: WorkerConfig): void {
  if (!targetInfo) {
    throw new Error('Cannot send ready signal: Target not initialized');
  }

  const chromePid = chrome?.pid ?? 0;

  const message: WorkerReadyMessage = {
    type: 'worker_ready',
    requestId: 'ready', // Special requestId for ready signal
    workerPid: process.pid,
    chromePid,
    port: config.port,
    target: {
      url: targetInfo.url,
      title: targetInfo.title,
    },
  };

  console.log(JSON.stringify(message));
  log.debug(workerReadySignalSent(process.pid, chromePid));
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
/**
 * Unified cleanup handler for all exit scenarios.
 *
 * Handles cleanup for normal shutdown, crashes, and timeouts.
 * Ensures Chrome is always killed and verified dead.
 *
 * @param reason - Why cleanup is happening
 */
async function cleanupWorker(reason: 'normal' | 'crash' | 'timeout'): Promise<void> {
  log.debug(`[worker] Cleanup started (reason: ${reason})`);

  try {
    const chromePid = chrome?.pid;
    if (chromePid) {
      try {
        writeChromePid(chromePid);
        log.debug(`[worker] Chrome PID ${chromePid} cached for cleanup`);
      } catch (error) {
        console.error(`[worker] Failed to cache Chrome PID: ${getErrorMessage(error)}`);
      }
    }

    if (reason === 'normal' && activeTelemetry.includes('dom') && cdp) {
      log.debug(workerCollectingDOM());
      try {
        domData = await collectDOM(cdp);
        log.debug(workerDOMCollected());
      } catch (error) {
        log.debug(workerDOMCollectionFailed(getErrorMessage(error)));
      }
    }

    log.debug(workerRunningCleanup());
    for (const cleanup of cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[worker] Cleanup function error: ${getErrorMessage(error)}`);
      }
    }

    if (cdp) {
      try {
        log.debug(workerClosingCDP());
        cdp.close();
        cdp = null;
      } catch (error) {
        console.error(`[worker] Error closing CDP: ${getErrorMessage(error)}`);
      }
    }

    if (chrome && chromePid) {
      try {
        console.error(`[worker] Terminating Chrome (PID ${chromePid})...`);
        await chrome.kill();

        let attempts = 0;
        const maxAttempts = 10;
        while (attempts < maxAttempts) {
          if (!isProcessAlive(chromePid)) {
            log.debug(`[worker] Chrome process ${chromePid} confirmed dead`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          attempts++;
        }

        if (isProcessAlive(chromePid)) {
          console.error(`[worker] Chrome did not die gracefully, force killing...`);
          try {
            killChromeProcess(chromePid, 'SIGKILL');
            await new Promise((resolve) => setTimeout(resolve, 500));

            if (isProcessAlive(chromePid)) {
              console.error(`[worker] WARNING: Chrome process ${chromePid} survived SIGKILL`);
            } else {
              log.debug(`[worker] Chrome process ${chromePid} force killed successfully`);
            }
          } catch (error) {
            console.error(`[worker] Failed to force kill Chrome: ${getErrorMessage(error)}`);
          }
        }

        chrome = null;
      } catch (error) {
        console.error(`[worker] Error killing Chrome: ${getErrorMessage(error)}`);
      }
    } else if (!chrome) {
      console.error(`[worker] ${chromeExternalSkipTerminationMessage()}`);
    }

    if (reason === 'normal') {
      try {
        log.debug(workerWritingOutput());
        const finalOutput = buildOutput(false);
        writeSessionOutput(finalOutput);
      } catch (error) {
        console.error(`[worker] Error writing final output: ${getErrorMessage(error)}`);
      }
    } else {
      try {
        log.debug(`[worker] Writing partial output (reason: ${reason})`);
        const partialOutput = buildOutput(true); // partial=true
        writeSessionOutput(partialOutput);
      } catch (error) {
        console.error(`[worker] Error writing partial output: ${getErrorMessage(error)}`);
      }
    }

    log.debug(workerShutdownComplete());
  } catch (error) {
    console.error(`[worker] Error during cleanup: ${getErrorMessage(error)}`);
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  console.error(`[worker] Starting (PID ${process.pid})`);

  let config: WorkerConfig;

  try {
    config = parseWorkerConfig();
    console.error(`[worker] Config: ${JSON.stringify(config)}`);

    writePid(process.pid);

    if (config.chromeWsUrl) {
      console.error(`[worker] ${chromeExternalConnectionMessage()}`);
      console.error(`[worker] ${chromeExternalWebSocketMessage(config.chromeWsUrl)}`);

      chrome = null;

      const targetId = config.chromeWsUrl.split('/').pop() ?? 'external';

      targetInfo = {
        id: targetId,
        type: 'page',
        title: 'External Chrome',
        url: config.url,
        webSocketDebuggerUrl: config.chromeWsUrl,
      };

      console.error(`[worker] ${chromeExternalNoPidMessage()}`);
    } else {
      console.error(`[worker] Launching Chrome on port ${config.port}...`);
      const launchOptions = {
        port: config.port,
        ...filterDefined({
          userDataDir: config.userDataDir,
          headless: config.headless,
        }),
      };
      chrome = await launchChrome(launchOptions);
      console.error(`[worker] Chrome launched (PID ${chrome.pid})`);

      writeChromePid(chrome.pid);
      console.error(`[worker] Chrome PID ${chrome.pid} cached for emergency cleanup`);

      console.error(`[worker] Connecting to Chrome via CDP...`);
      const targets = await fetchCDPTargets(config.port);

      const foundTarget = targets.find((t) => t.type === 'page');

      if (!foundTarget) {
        const availableTargets = targets.length
          ? targets
              .map(
                (t, i) =>
                  `  ${i + 1}. ${t.title || '(no title)'}\n     URL: ${t.url}\n     Type: ${t.type}`
              )
              .join('\n')
          : null;

        throw new Error(noPageTargetFoundError(config.port, availableTargets));
      }

      targetInfo = foundTarget;
      console.error(`[worker] Found target: ${foundTarget.title} (${foundTarget.url})`);
    }

    if (!targetInfo) {
      throw new Error('Failed to obtain target information');
    }

    cdp = new CDPConnection();
    await cdp.connect(targetInfo.webSocketDebuggerUrl, {
      autoReconnect: false,
      maxRetries: 10,
      // P1.1: Run cleanup if Chrome dies unexpectedly
      // WHY: Prevents zombie worker processes and ensures Chrome cleanup
      onDisconnect: (code, reason) => {
        console.error(`[worker] Chrome connection lost (code: ${code}, reason: ${reason})`);
        log.debug(workerExitingConnectionLoss());
        void cleanupWorker('crash').then(() => process.exit(1));
      },
    });
    console.error(`[worker] CDP connection established`);

    // CRITICAL: Activate telemetry modules BEFORE navigating to target URL
    // WHY: Network/Console events are only captured for requests that start
    console.error(`[worker] Activating collectors before navigation...`);
    await activateCollectors(config);
    console.error(`[worker] Collectors active and ready to capture telemetry`);

    const normalizedUrl = normalizeUrl(config.url);
    console.error(`[worker] Navigating to ${normalizedUrl}...`);
    await cdp.send('Page.navigate', { url: normalizedUrl });

    await waitForPageReady(cdp, {
      maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
    });
    console.error(`[worker] Page ready`);

    if (chrome && targetInfo) {
      const currentTargetId = targetInfo.id;
      const updatedTargets = await fetchCDPTargets(config.port);
      const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
      if (updatedTarget) {
        targetInfo = updatedTarget;
        console.error(`[worker] Target updated: ${updatedTarget.title} (${updatedTarget.url})`);
      }
    }

    writeSessionMetadata({
      bdgPid: process.pid,
      chromePid: chrome?.pid ?? 0, // 0 indicates external Chrome (not managed by bdg)
      startTime: sessionStartTime,
      port: config.port,
      targetId: targetInfo.id,
      webSocketDebuggerUrl: targetInfo.webSocketDebuggerUrl,
      activeTelemetry,
    });
    console.error(`[worker] Session metadata written`);

    sendReadySignal(config);

    setupStdinListener();

    process.on('SIGTERM', () => {
      log.debug(workerReceivedSIGTERM());
      void (async () => {
        await cleanupWorker('normal');
        process.exit(0);
      })();
    });

    process.on('SIGINT', () => {
      log.debug(workerReceivedSIGINT());
      void (async () => {
        await cleanupWorker('normal');
        process.exit(0);
      })();
    });

    if (config.timeout) {
      console.error(`[worker] Auto-stop after ${config.timeout}s`);
      setTimeout(() => {
        log.debug(workerTimeoutReached());
        void (async () => {
          await cleanupWorker('timeout');
          process.exit(0);
        })();
      }, config.timeout * 1000);
    }

    log.debug(workerSessionActive());
  } catch (error) {
    console.error(`[worker] Fatal error: ${getErrorMessage(error)}`);

    await cleanupWorker('crash');
    process.exit(1);
  }
}

void main();
