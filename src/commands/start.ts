import os from 'node:os';

import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { DEFAULT_DEBUG_PORT, PORT_OPTION_DESCRIPTION } from '@/constants.js';
import type { TelemetryType } from '@/types';
import { startCommandHelpMessage } from '@/ui/messages/commands.js';
import { genericError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parseOptionalIntOption } from '@/utils/validation.js';

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
  const maxBodySizeMB = parseOptionalIntOption('max-body-size', options.maxBodySize, {
    min: 1,
    max: 100,
  });

  // Expand tilde in userDataDir path
  let userDataDir = options.userDataDir;
  if (userDataDir?.startsWith('~/')) {
    userDataDir = userDataDir.replace(/^~/, os.homedir());
  }

  return {
    port: parseInt(options.port, 10),
    timeout: parseOptionalIntOption('timeout', options.timeout, { min: 1, max: 3600 }),
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
      console.error(genericError(validation.error ?? 'Invalid URL'));
      if (validation.suggestion) {
        console.error(`Suggestion: ${validation.suggestion}`);
      }
      process.exit(EXIT_CODES.INVALID_URL);
    }

    await collectorAction(url, options);
  });
}
