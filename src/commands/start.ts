import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/commands/shared/daemonSessionController.js';
import {
  DEFAULT_DEBUG_PORT,
  PORT_OPTION_DESCRIPTION,
  TIMEOUT_OPTION_DESCRIPTION,
  USER_DATA_DIR_OPTION_DESCRIPTION,
} from '@/constants.js';
import type { TelemetryType } from '@/types';

/**
 * Parsed command-line flags shared by the start subcommands.
 */
interface CollectorOptions {
  /** Chrome debugging port as provided by the user. */
  port: string;
  /** Optional auto-stop timeout (seconds, string form). */
  timeout?: string;
  /** Custom Chrome profile directory path. */
  userDataDir?: string;
  /** When true, disables default filtering of noisy data. */
  all?: boolean;
  /** Maximum response body size in megabytes (default: 5MB). */
  maxBodySize?: string;
  /** Use compact JSON format (no indentation) for output files. */
  compact?: boolean;
}

/**
 * Apply shared telemetry options to a command
 *
 * @param command - Commander.js Command instance to apply options to
 * @returns The modified Command instance with all telemetry options applied
 */
function applyCollectorOptions(command: Command): Command {
  return command
    .option('-p, --port <number>', PORT_OPTION_DESCRIPTION, DEFAULT_DEBUG_PORT)
    .option('-t, --timeout <seconds>', TIMEOUT_OPTION_DESCRIPTION)
    .option('-u, --user-data-dir <path>', USER_DATA_DIR_OPTION_DESCRIPTION)
    .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)')
    .option(
      '-m, --max-body-size <megabytes>',
      'Maximum response body size in MB (default: 5MB)',
      '5'
    )
    .option('--compact', 'Use compact JSON format (no indentation) for output files');
}

/**
 * Parse a string to integer, returning undefined if not provided
 * @param value - Optional string value to parse
 * @param fieldName - Name of the field being parsed (for error messages)
 * @returns Parsed integer or undefined if value was not provided
 * @throws Error if value is provided but not a valid integer
 */
function parseOptionalInt(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: "${value}" is not a valid integer`);
  }
  return parsed;
}

/**
 * Transform CLI options into session options
 *
 * @param options - Parsed command-line options from Commander
 * @returns Session options object with parsed and normalized values
 */
function buildSessionOptions(options: CollectorOptions): {
  port: number;
  timeout: number | undefined;
  userDataDir: string | undefined;
  includeAll: boolean;
  maxBodySize: number | undefined;
  compact: boolean;
} {
  const maxBodySizeMB = parseOptionalInt(options.maxBodySize, 'max-body-size');
  return {
    port: parseInt(options.port, 10),
    timeout: parseOptionalInt(options.timeout, 'timeout'),
    userDataDir: options.userDataDir,
    includeAll: options.all ?? false,
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    compact: options.compact ?? false,
  };
}

/**
 * Common action handler for telemetry commands
 *
 * @param url - Target URL to collect telemetry from
 * @param options - Parsed command-line options from Commander
 * @returns Promise that resolves when session completes or is stopped
 */
async function collectorAction(url: string, options: CollectorOptions): Promise<void> {
  const sessionOptions = buildSessionOptions(options);

  // Always collect all 3 types (dom, network, console)
  const telemetry: TelemetryType[] = ['dom', 'network', 'console'];

  // Dispatch to daemon via IPC instead of running in-process
  await startSessionViaDaemon(url, sessionOptions, telemetry);
}

/**
 * Register the start command
 *
 * @param program - Commander.js Command instance to register command on
 * @returns void
 */
export function registerStartCommands(program: Command): void {
  // Default command: always collects all 3 types (dom, network, console)
  applyCollectorOptions(
    program.argument('[url]', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string | undefined, options: CollectorOptions) => {
    // Show friendly help if no URL provided
    if (!url) {
      console.error('');
      console.error('Start a new session by providing a URL:');
      console.error('');
      console.error('  bdg example.com');
      console.error('  bdg localhost:3000');
      console.error('  bdg https://github.com');
      console.error('');
      console.error('Or manage existing session:');
      console.error('');
      console.error('  bdg status      Check session state');
      console.error('  bdg stop        End session');
      console.error('  bdg --help      Show all commands');
      console.error('');
      process.exit(0);
    }

    await collectorAction(url, options);
  });
}
