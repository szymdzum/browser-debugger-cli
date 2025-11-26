#!/usr/bin/env node

import { Command } from 'commander';

import { generateMachineReadableHelp, generateSubcommandHelp } from '@/commands/helpJson.js';
import { commandRegistry } from '@/commands.js';
import { isDaemonRunning, launchDaemon } from '@/daemon/launcher.js';
import { createLogger, enableDebugLogging } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { VERSION } from '@/utils/version.js';

const DAEMON_WORKER_ENV_VAR = 'BDG_DAEMON';
const DAEMON_WORKER_ENV_VALUE = '1';

const DAEMON_ALREADY_RUNNING_ERROR_CODE = 'DAEMON_ALREADY_RUNNING';

const DEFAULT_EXIT_CODE_ON_ERROR = 1;

const DAEMON_STARTING_MESSAGE = 'Starting daemon...';
const DAEMON_STARTED_MESSAGE = 'Daemon started successfully';
const DAEMON_ALREADY_RUNNING_MESSAGE = 'Daemon is already running';
const DAEMON_START_FAILED_PREFIX = 'Failed to start daemon:';

const CLI_NAME = 'bdg';
const CLI_DESCRIPTION = 'Browser telemetry via Chrome DevTools Protocol';

const log = createLogger('bdg');

/**
 * Extract command path from argv for subcommand help routing.
 *
 * Parses argv to find command names before --help flag.
 * Stops at first flag (starts with -) or --help.
 *
 * @param argv - Process arguments array
 * @returns Array of command names (e.g., ['dom', 'query'])
 *
 * @example
 * ```typescript
 * extractCommandPath(['node', 'bdg', 'dom', 'query', '--help', '--json'])
 * // Returns: ['dom', 'query']
 *
 * extractCommandPath(['node', 'bdg', '--help', '--json'])
 * // Returns: []
 * ```
 */
function extractCommandPath(argv: string[]): string[] {
  const commandPath: string[] = [];
  const args = argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith('-')) {
      break;
    }
    commandPath.push(arg);
  }

  return commandPath;
}

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
 * 1. Check for --help --json flag early (bypass daemon requirement)
 * 2. Check if running as daemon worker (BDG_DAEMON=1 env var)
 * 3. If CLI client: ensure daemon is running (spawn if needed)
 * 4. Initialize Commander and register command handlers
 * 5. Parse arguments and route to appropriate command
 */
/**
 * Check if JSON output mode is requested.
 *
 * Detects --json flag early to suppress human-readable log messages
 * that would break JSON parsing.
 *
 * @returns True if --json flag is present in arguments
 */
function isJsonOutputMode(): boolean {
  return process.argv.includes('--json');
}

async function main(): Promise<void> {
  if (process.argv.includes('--debug')) {
    enableDebugLogging();
  }

  const program = new Command()
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose output)');

  commandRegistry.forEach((register) => register(program));

  if (process.argv.includes('--help') && process.argv.includes('--json')) {
    const commandPath = extractCommandPath(process.argv);
    const help =
      commandPath.length > 0
        ? generateSubcommandHelp(program, commandPath)
        : generateMachineReadableHelp(program);
    console.log(JSON.stringify(help, null, 2));
    process.exit(0);
  }

  if (!isDaemonWorkerProcess()) {
    await ensureDaemonRunning(isJsonOutputMode());
  }

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
 * @param silent - Suppress info-level logs (for JSON output mode)
 * @throws Never - exits process on error instead
 */
async function ensureDaemonRunning(silent = false): Promise<void> {
  if (!isDaemonRunning()) {
    if (!silent) log.info(DAEMON_STARTING_MESSAGE);
    log.debug('Checking daemon PID file and acquiring lock...');
    try {
      await launchDaemon();
      if (!silent) log.info(DAEMON_STARTED_MESSAGE);
      log.debug('Daemon process spawned and socket ready');
    } catch (error: unknown) {
      if (isDaemonAlreadyRunningError(error)) {
        if (!silent) log.info(getErrorMessage(error));
        process.exit(getExitCodeFromError(error));
      }
      if (!silent) log.info(`${DAEMON_START_FAILED_PREFIX} ${getErrorMessage(error)}`);
      process.exit(DEFAULT_EXIT_CODE_ON_ERROR);
    }
  } else {
    log.debug(DAEMON_ALREADY_RUNNING_MESSAGE);
    log.debug('Daemon PID file exists and process is alive');
  }
}

void main();
