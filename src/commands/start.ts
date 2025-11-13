import os from 'node:os';

import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/commands/shared/daemonSessionController.js';
import { DEFAULT_DEBUG_PORT, PORT_OPTION_DESCRIPTION } from '@/constants.js';
import type { TelemetryType } from '@/types';
import { startCommandHelpMessage } from '@/ui/messages/commands.js';
import { invalidIntegerError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
  /** Launch Chrome in headless mode (no visible browser window). */
  headless?: boolean;
  /** WebSocket URL for connecting to existing Chrome instance (skips Chrome launch). */
  chromeWsUrl?: string;
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
    .option(
      '-t, --timeout <seconds>',
      'Auto-stop after timeout in seconds (unlimited if not specified)'
    )
    .option('-u, --user-data-dir <path>', 'Chrome user data directory', '~/.bdg/chrome-profile')
    .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)', false)
    .option('-m, --max-body-size <megabytes>', 'Maximum response body size in MB', '5')
    .option('--compact', 'Use compact JSON format (no indentation) for output files', false)
    .option('--headless', 'Launch Chrome in headless mode (no visible browser window)', false)
    .option(
      '--chrome-ws-url <url>',
      'Connect to existing Chrome via WebSocket URL (e.g., ws://localhost:9222/devtools/page/...)'
    );
}

/**
 * Parse a string to integer, returning undefined if not provided
 * @param value - Optional string value to parse
 * @param fieldName - Name of the field being parsed (for error messages)
 * @param min - Optional minimum allowed value
 * @param max - Optional maximum allowed value
 * @returns Parsed integer or undefined if value was not provided
 * @throws Error if value is provided but not a valid integer
 */
function parseOptionalInt(
  value: string | undefined,
  fieldName: string,
  min?: number,
  max?: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    const options = min !== undefined && max !== undefined ? { min, max } : undefined;
    throw new Error(invalidIntegerError(fieldName, value, options));
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
  headless: boolean;
  chromeWsUrl: string | undefined;
} {
  const maxBodySizeMB = parseOptionalInt(options.maxBodySize, 'max-body-size', 1, 100);

  // Expand tilde in userDataDir path
  let userDataDir = options.userDataDir;
  if (userDataDir?.startsWith('~/')) {
    userDataDir = userDataDir.replace(/^~/, os.homedir());
  }

  return {
    port: parseInt(options.port, 10),
    timeout: parseOptionalInt(options.timeout, 'timeout', 1, 3600),
    userDataDir,
    includeAll: options.all ?? false,
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    compact: options.compact ?? false,
    headless: options.headless ?? false,
    chromeWsUrl: options.chromeWsUrl,
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
      console.error(startCommandHelpMessage());
      process.exit(0);
    }

    // Validate URL before starting session
    const { validateUrl } = await import('@/utils/url.js');
    const validation = validateUrl(url);
    if (!validation.valid) {
      console.error(`Error: ${validation.error}`);
      if (validation.suggestion) {
        console.error(`Suggestion: ${validation.suggestion}`);
      }
      process.exit(EXIT_CODES.INVALID_URL);
    }

    await collectorAction(url, options);
  });
}
