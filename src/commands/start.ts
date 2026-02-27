import os from 'node:os';

import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { PORT_OPTION_DESCRIPTION } from '@/constants.js';
import type { TelemetryType } from '@/types';
import { startCommandHelpMessage } from '@/ui/messages/commands.js';
import { genericError } from '@/ui/messages/errors.js';
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
  /** Launch Chrome in headless mode. Default: true if no display, false if display available. */
  headless?: boolean;
  /** Quiet mode - suppress verbose landing page output for AI agents. */
  quiet?: boolean;
  /** Custom Chrome flags (space-separated string). */
  chromeFlags?: string;
}

/**
 * Check if a display server (X11 or Wayland) is available.
 * Used to determine default headless mode.
 */
function hasDisplay(): boolean {
  const display = process.env['DISPLAY'];
  const wayland = process.env['WAYLAND_DISPLAY'];
  return (display !== undefined && display !== '') || (wayland !== undefined && wayland !== '');
}

/**
 * Apply shared telemetry options to a command
 *
 * @param command - Commander.js Command instance to apply options to
 * @returns The modified Command instance with all telemetry options applied
 */
function applyCollectorOptions(command: Command): Command {
  // Default to headless if no display available
  const defaultHeadless = !hasDisplay();

  return (
    command
      .option('-p, --port <number>', PORT_OPTION_DESCRIPTION)
      .option(
        '-t, --timeout <seconds>',
        'Auto-stop after timeout in seconds (unlimited if not specified)'
      )
      .option('-u, --user-data-dir <path>', 'Chrome user data directory (defaults to session dir)')
      .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)', false)
      .option('-m, --max-body-size <megabytes>', 'Maximum response body size in MB', '5')
      .option('--compact', 'Use compact JSON format (no indentation) for output files', false)
      .option('--headless', 'Run in headless mode (auto if no display)', defaultHeadless)
      .option('--no-headless', 'Show browser window')
      // NOTE: --chrome-ws-url is NOT included here to avoid conflicts with subcommands
      // (e.g., dom screenshot --chrome-ws-url). Direct mode is handled by dom/cdp commands.
      .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
      .option(
        '--chrome-flags <flags>',
        'Custom Chrome flags (space-separated, e.g., --chrome-flags="--ignore-certificate-errors --disable-web-security")'
      )
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
  chromeWsUrl: undefined;
  quiet: boolean;
  chromeFlags: string[] | undefined;
} {
  const maxBodySizeRule = positiveIntRule({ min: 1, max: 100, required: false });
  const timeoutRule = positiveIntRule({ min: 1, max: 3600, required: false });

  const maxBodySizeMB = options.maxBodySize
    ? maxBodySizeRule.validate(options.maxBodySize)
    : undefined;
  const timeout = options.timeout ? timeoutRule.validate(options.timeout) : undefined;

  let userDataDir = options.userDataDir;
  if (userDataDir?.startsWith('~/')) {
    userDataDir = userDataDir.replace(/^~/, os.homedir());
  }

  // Merge env var flags with CLI flags (CLI flags come after, taking precedence)
  const envFlags = process.env['BDG_CHROME_FLAGS']?.split(' ').filter(Boolean) ?? [];
  const cliFlags = options.chromeFlags?.split(' ').filter(Boolean) ?? [];
  const combinedFlags = [...envFlags, ...cliFlags];
  const chromeFlags = combinedFlags.length > 0 ? combinedFlags : undefined;

  return {
    port: parseInt(options.port, 10),
    timeout,
    userDataDir,
    includeAll: options.all ?? false,
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    compact: options.compact ?? false,
    headless: options.headless ?? !hasDisplay(),
    chromeWsUrl: undefined, // Direct mode not supported via start command
    quiet: options.quiet ?? false,
    chromeFlags,
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

  const telemetry: TelemetryType[] = ['dom', 'network', 'console'];

  await startSessionViaDaemon(url, sessionOptions, telemetry);
}

/**
 * Register the start command
 *
 * @param program - Commander.js Command instance to register command on
 * @returns void
 */
export function registerStartCommands(program: Command): void {
  applyCollectorOptions(
    program.argument('[url]', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string | undefined, options: CollectorOptions) => {
    if (!url) {
      console.error(startCommandHelpMessage());
      process.exit(0);
    }

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
