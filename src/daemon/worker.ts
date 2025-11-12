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
import { launchChrome } from '@/connection/launcher.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { startTelemetryCollectors } from '@/daemon/worker/collectors.js';
import { createCommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { WorkerConfig } from '@/daemon/worker/types.js';
import type { WorkerReadyMessage } from '@/daemon/workerIpc.js';
import type { CommandName, WorkerRequestUnion, WorkerResponse } from '@/ipc/commands.js';
import { writeChromePid } from '@/session/chrome.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { writeSessionOutput } from '@/session/output.js';
import { writePid } from '@/session/pid.js';
import { isProcessAlive, killChromeProcess } from '@/session/process.js';
import { collectDOM } from '@/telemetry/dom.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
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
import { normalizeUrl } from '@/utils/url.js';

const log = createLogger('worker');

const telemetryStore = new TelemetryStore();
const commandRegistry = createCommandRegistry(telemetryStore);

let chrome: LaunchedChrome | null = null;
let cdp: CDPConnection | null = null;
let cleanupFunctions: CleanupFunction[] = [];

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
    const normalized: WorkerConfig = {
      url: config.url,
      port: config.port ?? 9222,
      telemetry: config.telemetry ?? ['network', 'console', 'dom'],
      includeAll: config.includeAll ?? false,
      headless: config.headless ?? false,
    };

    if (config.timeout !== undefined) {
      normalized.timeout = config.timeout;
    }
    if (config.userDataDir !== undefined) {
      normalized.userDataDir = config.userDataDir;
    }
    if (config.maxBodySize !== undefined) {
      normalized.maxBodySize = config.maxBodySize;
    }
    if (config.chromeWsUrl !== undefined) {
      normalized.chromeWsUrl = config.chromeWsUrl;
    }

    return normalized;
  } catch (error) {
    throw new Error(`Failed to parse worker config: ${getErrorMessage(error)}`);
  }
}

// Command handlers are defined via createCommandRegistry for modularity.

/**
 * Handle incoming IPC message from daemon via stdin.
 */
async function handleWorkerIPC(message: WorkerRequestUnion): Promise<void> {
  const commandName = message.type.replace('_request', '') as CommandName;
  const handler = commandRegistry[commandName];

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
  const targetInfo = telemetryStore.targetInfo;
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

    if (reason === 'normal' && telemetryStore.activeTelemetry.includes('dom') && cdp) {
      log.debug(workerCollectingDOM());
      try {
        telemetryStore.setDomData(await collectDOM(cdp));
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
        const finalOutput = telemetryStore.buildOutput(false);
        writeSessionOutput(finalOutput);
      } catch (error) {
        console.error(`[worker] Error writing final output: ${getErrorMessage(error)}`);
      }
    } else {
      try {
        log.debug(`[worker] Writing partial output (reason: ${reason})`);
        const partialOutput = telemetryStore.buildOutput(true); // partial=true
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

    telemetryStore.resetSessionStart();
    telemetryStore.setDomData(null);
    telemetryStore.networkRequests.length = 0;
    telemetryStore.consoleMessages.length = 0;
    telemetryStore.navigationEvents.length = 0;
    telemetryStore.setTargetInfo(null);

    writePid(process.pid);

    if (config.chromeWsUrl) {
      console.error(`[worker] ${chromeExternalConnectionMessage()}`);
      console.error(`[worker] ${chromeExternalWebSocketMessage(config.chromeWsUrl)}`);

      chrome = null;

      const targetId = config.chromeWsUrl.split('/').pop() ?? 'external';

      telemetryStore.setTargetInfo({
        id: targetId,
        type: 'page',
        title: 'External Chrome',
        url: config.url,
        webSocketDebuggerUrl: config.chromeWsUrl,
      });

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

      telemetryStore.setTargetInfo(foundTarget);
      console.error(`[worker] Found target: ${foundTarget.title} (${foundTarget.url})`);
    }

    if (!telemetryStore.targetInfo) {
      throw new Error('Failed to obtain target information');
    }

    cdp = new CDPConnection();
    await cdp.connect(telemetryStore.targetInfo.webSocketDebuggerUrl, {
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
    const telemetryCleanups = await startTelemetryCollectors(cdp, config, telemetryStore, log);
    cleanupFunctions.push(...telemetryCleanups);
    console.error(`[worker] Collectors active and ready to capture telemetry`);

    const normalizedUrl = normalizeUrl(config.url);
    console.error(`[worker] Navigating to ${normalizedUrl}...`);
    await cdp.send('Page.navigate', { url: normalizedUrl });

    await waitForPageReady(cdp, {
      maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
    });
    console.error(`[worker] Page ready`);

    if (chrome && telemetryStore.targetInfo) {
      const currentTargetId = telemetryStore.targetInfo.id;
      const updatedTargets = await fetchCDPTargets(config.port);
      const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
      if (updatedTarget) {
        telemetryStore.setTargetInfo(updatedTarget);
        console.error(`[worker] Target updated: ${updatedTarget.title} (${updatedTarget.url})`);
      }
    }

    writeSessionMetadata({
      bdgPid: process.pid,
      chromePid: chrome?.pid ?? 0, // 0 indicates external Chrome (not managed by bdg)
      startTime: telemetryStore.sessionStartTime,
      port: config.port,
      targetId: telemetryStore.targetInfo?.id,
      webSocketDebuggerUrl: telemetryStore.targetInfo?.webSocketDebuggerUrl,
      activeTelemetry: telemetryStore.activeTelemetry,
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
