#!/usr/bin/env node

import { Command } from 'commander';

import { commandRegistry } from '@/cli/registry.js';
import { isDaemonRunning, launchDaemon } from '@/daemon/launcher.js';
import { getErrorMessage } from '@/utils/errors.js';
import { VERSION } from '@/utils/version.js';

/**
 * Main entry point - daemon-first architecture.
 *
 * This entry point:
 * 1. Checks if we're running as the daemon worker (BDG_DAEMON=1)
 * 2. If not, ensures the daemon is running
 * 3. Initializes Commander and routes commands to the daemon
 */

// If we're the daemon worker, skip the daemon launch check
const isDaemonWorker = process.env['BDG_DAEMON'] === '1';

async function main(): Promise<void> {
  if (!isDaemonWorker) {
    // We're the CLI client - ensure daemon is running
    if (!isDaemonRunning()) {
      console.error('[bdg] Starting daemon...');
      try {
        await launchDaemon();
        console.error('[bdg] Daemon started successfully');
      } catch (error: unknown) {
        // Handle daemon already running error
        if (
          error instanceof Error &&
          'code' in error &&
          (error as Error & { code?: string; exitCode?: number }).code === 'DAEMON_ALREADY_RUNNING'
        ) {
          console.error(`[bdg] ${(error as Error & { message: string }).message}`);
          process.exit((error as Error & { exitCode?: number }).exitCode ?? 1);
        }
        // Handle other launch failures
        console.error('[bdg] Failed to start daemon:', getErrorMessage(error));
        process.exit(1);
      }
    } else {
      console.error('[bdg] Daemon is already running');
    }
  }

  // Initialize Commander and register commands
  const program = new Command()
    .name('bdg')
    .description('Browser telemetry via Chrome DevTools Protocol')
    .version(VERSION);

  commandRegistry.forEach((register) => register(program));

  program.parse();
}

void main();
