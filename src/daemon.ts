#!/usr/bin/env node
/**
 * Daemon Entry Point - Standalone IPC Server
 *
 * This is a minimal standalone daemon process that runs the IPC server.
 * For MVP: manually start with `node dist/daemon.js`
 * Future: integrate with proper daemon lifecycle management.
 */

import { IPCServer } from '@/daemon/ipcServer.js';

const server = new IPCServer();

// Graceful shutdown handlers
process.on('SIGINT', () => {
  console.error('\n[daemon] Received SIGINT, shutting down...');
  void server.stop().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.error('\n[daemon] Received SIGTERM, shutting down...');
  void server.stop().then(() => process.exit(0));
});

// Start the server
void (async () => {
  try {
    await server.start();
    console.error('[daemon] IPC server started successfully');
    console.error('[daemon] Press Ctrl+C to stop');
  } catch (error) {
    console.error('[daemon] Failed to start:', error);
    process.exit(1);
  }
})();
