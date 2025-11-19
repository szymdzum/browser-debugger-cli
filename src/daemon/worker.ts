#!/usr/bin/env node
/**
 * Worker Process - Main Entry Point
 *
 * Orchestrates worker lifecycle by delegating to specialized modules.
 * This file contains only high-level coordination logic.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { WorkerError } from '@/daemon/errors.js';
import { setupCDPAndNavigate } from '@/daemon/lifecycle/cdpSetup.js';
import { setupChromeConnection } from '@/daemon/lifecycle/chromeConnection.js';
import { setupSignalHandlers } from '@/daemon/lifecycle/signalHandlers.js';
import { cleanupWorker } from '@/daemon/lifecycle/workerCleanup.js';
import { parseWorkerConfig } from '@/daemon/lifecycle/workerConfig.js';
import { setupStdinListener } from '@/daemon/lifecycle/workerIpc.js';
import { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { createCommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { WorkerReadyMessage } from '@/daemon/workerIpc.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { writePid } from '@/session/pid.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
import { createLogger } from '@/ui/logging/index.js';
import { workerSessionActive } from '@/ui/messages/debug.js';

const log = createLogger('worker');
const telemetryStore = new TelemetryStore();
const commandRegistry = createCommandRegistry(telemetryStore);

let chrome: LaunchedChrome | null = null;
let cdp: CDPConnection | null = null;
let cleanupFunctions: CleanupFunction[] = [];

/**
 * Send worker_ready signal to parent via stdout.
 */
function sendReadySignal(workerPid: number, chromePid: number, port: number): void {
  const targetInfo = telemetryStore.targetInfo;
  if (!targetInfo) {
    throw new WorkerError(
      'Cannot send ready signal: Target not initialized',
      'TARGET_NOT_INITIALIZED'
    );
  }

  const message: WorkerReadyMessage = {
    type: 'worker_ready',
    requestId: 'ready',
    workerPid,
    chromePid,
    port,
    target: {
      url: targetInfo.url,
      title: targetInfo.title,
    },
  };

  console.log(JSON.stringify(message));
  log.debug(`[worker] Ready signal sent (PID ${workerPid}, Chrome PID ${chromePid})`);
}

/**
 * Initialize telemetry store to clean state.
 */
function initializeTelemetryStore(): void {
  telemetryStore.resetSessionStart();
  telemetryStore.setDomData(null);
  telemetryStore.networkRequests.length = 0;
  telemetryStore.consoleMessages.length = 0;
  telemetryStore.navigationEvents.length = 0;
  telemetryStore.setTargetInfo(null);
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  console.error(`[worker] Starting (PID ${process.pid})`);

  try {
    const config = parseWorkerConfig();
    console.error(`[worker] Config: ${JSON.stringify(config)}`);

    initializeTelemetryStore();
    writePid(process.pid);

    chrome = await setupChromeConnection(config, telemetryStore, log);

    const result = await setupCDPAndNavigate(config, telemetryStore, chrome, log, () => {
      void cleanupWorker('crash', { chrome, cdp, cleanupFunctions, telemetryStore, log }).then(() =>
        process.exit(1)
      );
    });

    cdp = result.cdp;
    cleanupFunctions = result.cleanupFunctions;

    writeSessionMetadata({
      bdgPid: process.pid,
      chromePid: chrome?.pid ?? 0,
      startTime: telemetryStore.sessionStartTime,
      port: config.port,
      targetId: telemetryStore.targetInfo?.id,
      webSocketDebuggerUrl: telemetryStore.targetInfo?.webSocketDebuggerUrl,
      activeTelemetry: telemetryStore.activeTelemetry,
    });
    console.error(`[worker] Session metadata written`);

    setupStdinListener(cdp, commandRegistry, log);

    sendReadySignal(process.pid, chrome?.pid ?? 0, config.port);

    setupSignalHandlers({ chrome, cdp, cleanupFunctions, telemetryStore, log }, config.timeout);

    log.debug(workerSessionActive());
  } catch (error) {
    console.error(
      `[worker] Fatal error: ${error instanceof Error ? error.message : String(error)}`
    );
    await cleanupWorker('crash', { chrome, cdp, cleanupFunctions, telemetryStore, log });
    process.exit(1);
  }
}

void main();
