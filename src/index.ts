#!/usr/bin/env node

import { Command } from 'commander';

import { commandRegistry } from '@/commandRegistry.js';
import { isDaemonRunning, launchDaemon } from '@/daemon/launcher.js';
import { getErrorMessage } from '@/utils/errors.js';
import { createLogger, enableDebugLogging } from '@/utils/logger.js';
import { VERSION } from '@/utils/version.js';

// ============================================================================
// Constants
// ============================================================================

const DAEMON_WORKER_ENV_VAR = 'BDG_DAEMON';
const DAEMON_WORKER_ENV_VALUE = '1';

const DAEMON_ALREADY_RUNNING_ERROR_CODE = 'DAEMON_ALREADY_RUNNING';

const DEFAULT_EXIT_CODE_ON_ERROR = 1;

// Log Messages
const DAEMON_STARTING_MESSAGE = 'Starting daemon...';
const DAEMON_STARTED_MESSAGE = 'Daemon started successfully';
const DAEMON_ALREADY_RUNNING_MESSAGE = 'Daemon is already running';
const DAEMON_START_FAILED_PREFIX = 'Failed to start daemon:';

// Commander Configuration
const CLI_NAME = 'bdg';
const CLI_DESCRIPTION = 'Browser telemetry via Chrome DevTools Protocol';

// ============================================================================
// Utilities
// ============================================================================

const log = createLogger('bdg');

/**
 * Check if the current process is running as the daemon worker.
 *
 * The daemon worker is identified by the BDG_DAEMON=1 environment variable,
 * which is set when spawning the daemon process. This prevents infinite
 * daemon launch loops and distinguishes between CLI client and daemon modes.
 *
 * @returns True if running as daemon worker, false if running as CLI client
 */
function isDaemonWorkerProcess(): boolean {
  return process.env[DAEMON_WORKER_ENV_VAR] === DAEMON_WORKER_ENV_VALUE;
}

/**
 * Check if an error is a "daemon already running" error.
 *
 * @param error - Error to check
 * @returns True if error indicates daemon is already running
 */
function isDaemonAlreadyRunningError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: string }).code === DAEMON_ALREADY_RUNNING_ERROR_CODE
  );
}

/**
 * Extract exit code from error object.
 *
 * @param error - Error that may contain an exitCode property
 * @returns Exit code from error, or default exit code if not present
 */
function getExitCodeFromError(error: unknown): number {
  if (error instanceof Error && 'exitCode' in error) {
    return (error as Error & { exitCode?: number }).exitCode ?? DEFAULT_EXIT_CODE_ON_ERROR;
  }
  return DEFAULT_EXIT_CODE_ON_ERROR;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main entry point - daemon-first architecture.
 *
 * Architecture rationale:
 * - Daemon persistence enables fast command execution (no Chrome reconnect overhead)
 * - Single daemon prevents port conflicts and resource contention
 * - Detached worker process maintains CDP connection across CLI invocations
 * - Commander provides consistent CLI UX with automatic --help and --version
 *
 * Process flow:
 * 1. Check if running as daemon worker (BDG_DAEMON=1 env var)
 * 2. If CLI client: ensure daemon is running (spawn if needed)
 * 3. Initialize Commander and register command handlers
 * 4. Parse arguments and route to appropriate command
 */
async function main(): Promise<void> {
  // Check for --debug flag early (before daemon check) to enable verbose logging
  if (process.argv.includes('--debug')) {
    enableDebugLogging();
  }

  if (!isDaemonWorkerProcess()) {
    await ensureDaemonRunning();
  }

  const program = new Command()
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose output)');

  commandRegistry.forEach((register) => register(program));

  program.parse();
}

/**
 * Ensure the daemon is running, launching it if necessary.
 *
 * This function handles three scenarios:
 * 1. Daemon not running → Launch daemon and wait for readiness
 * 2. Daemon already running → Log message and continue
 * 3. Daemon startup in progress → Error with helpful message
 *
 * Exit codes:
 * - Custom exit code from DAEMON_ALREADY_RUNNING error (typically 1)
 * - 1 for all other daemon launch failures
 *
 * @throws Never - exits process on error instead
 */
async function ensureDaemonRunning(): Promise<void> {
  if (!isDaemonRunning()) {
    log.info(DAEMON_STARTING_MESSAGE);
    log.debug('Checking daemon PID file and acquiring lock...');
    try {
      await launchDaemon();
      log.info(DAEMON_STARTED_MESSAGE);
      log.debug('Daemon process spawned and socket ready');
    } catch (error: unknown) {
      if (isDaemonAlreadyRunningError(error)) {
        log.info(getErrorMessage(error));
        process.exit(getExitCodeFromError(error));
      }
      log.info(`${DAEMON_START_FAILED_PREFIX} ${getErrorMessage(error)}`);
      process.exit(DEFAULT_EXIT_CODE_ON_ERROR);
    }
  } else {
    log.debug(DAEMON_ALREADY_RUNNING_MESSAGE);
    log.debug('Daemon PID file exists and process is alive');
  }
}

void main();
