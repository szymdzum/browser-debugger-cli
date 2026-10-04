#!/usr/bin/env node
/**
 * Daemon entry point.
 *
 * Spawned by the CLI (`launchDaemon`). Hosts one in-process browser session
 * and exits when that session ends.
 */

import { DaemonError } from '@/daemon/errors.js';
import { IPCServer } from '@/daemon/ipcServer.js';
import { DAEMON_ALREADY_RUNNING_CODE } from '@/daemon/server/SocketServer.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('daemon');
const server = new IPCServer();

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    log.info(`Received ${signal}, shutting down...`);
    void server.shutdown();
  });
}

void (async () => {
  try {
    await server.start();
    log.info('IPC server started successfully');
  } catch (error) {
    if (error instanceof DaemonError && error.code === DAEMON_ALREADY_RUNNING_CODE) {
      log.info('Another daemon owns the socket, exiting');
      process.exit(0);
    }
    log.info(`Failed to start: ${getErrorMessage(error)}`);
    process.exit(1);
  }
})();
