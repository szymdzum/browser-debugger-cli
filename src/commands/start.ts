import os from 'node:os';

import type { Command } from 'commander';

import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { PORT_OPTION_DESCRIPTION } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import type { TelemetryType } from '@/types';
import { startCommandHelpMessage } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';
import { validateChromeWsUrl, validateUrl } from '@/utils/url.js';

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
  /** WebSocket URL for connecting to existing Chrome instance (skips Chrome launch). */
  chromeWsUrl?: string;
  /** Quiet mode - suppress verbose landing page output for AI agents. */
  quiet?: boolean;
  /** Verbose mode - force the post-start landing page even when stdout isn't a TTY. */
  verbose?: boolean;
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
 * Expand a leading `~/` in a path to the user's home directory.
 * Chrome itself does not expand `~`, so bdg normalizes it for users.
 */
export function expandHome(value: string): string {
  return value.startsWith('~/') ? value.replace(/^~/, os.homedir()) : value;
}

/**
 * Extract `--user-data-dir` from a flags array.
 *
 * Supports both `--user-data-dir=<path>` and `--user-data-dir <path>` forms.
 * When found, returns the path (with `~/` expanded) and the remaining flags
 * with every matching entry removed, so callers can avoid passing the same
 * switch to Chrome twice.
 */
export function extractUserDataDirFromFlags(flags: string[]): {
  userDataDir: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let userDataDir: string | undefined;

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i] as string;
    if (flag.startsWith('--user-data-dir=')) {
      userDataDir = flag.slice('--user-data-dir='.length);
      continue;
    }
    if (flag === '--user-data-dir' && i + 1 < flags.length) {
      userDataDir = flags[i + 1];
      i++;
      continue;
    }
    rest.push(flag);
  }

  return {
    userDataDir: userDataDir ? expandHome(userDataDir) : undefined,
    rest,
  };
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

  return command
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
    .option(
      '--chrome-ws-url <url>',
      'Connect to existing Chrome via WebSocket URL (e.g., ws://localhost:9222/devtools/page/...)'
    )
    .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
    .option('--verbose', 'Show the post-start landing page even when stdout is not a TTY', false)
    .option(
      '--chrome-flags <flags>',
      'Custom Chrome flags (space-separated, e.g., --chrome-flags="--ignore-certificate-errors --disable-web-security")'
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
  quiet: boolean;
  verbose: boolean;
  chromeFlags: string[] | undefined;
} {
  const maxBodySizeRule = positiveIntRule({
    min: 1,
    max: 100,
    required: false,
    fieldName: 'max-body-size',
  });
  const timeoutRule = positiveIntRule({
    min: 1,
    max: 3600,
    required: false,
    fieldName: 'timeout',
  });

  const maxBodySizeMB = options.maxBodySize
    ? maxBodySizeRule.validate(options.maxBodySize)
    : undefined;
  const timeout = options.timeout ? timeoutRule.validate(options.timeout) : undefined;

  // Merge env var flags with CLI flags (CLI flags come after, taking precedence)
  const envFlags = process.env['BDG_CHROME_FLAGS']?.split(' ').filter(Boolean) ?? [];
  const cliFlags = options.chromeFlags?.split(' ').filter(Boolean) ?? [];
  const { userDataDir: flagUserDataDir, rest: combinedFlags } = extractUserDataDirFromFlags([
    ...envFlags,
    ...cliFlags,
  ]);

  // Precedence: -u / --user-data-dir > --chrome-flags / BDG_CHROME_FLAGS > default
  const userDataDir = options.userDataDir ? expandHome(options.userDataDir) : flagUserDataDir;

  const chromeFlags = combinedFlags.length > 0 ? combinedFlags : undefined;

  return {
    port: parseInt(options.port, 10),
    timeout,
    userDataDir,
    includeAll: options.all ?? false,
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    compact: options.compact ?? false,
    headless: options.headless ?? !hasDisplay(),
    chromeWsUrl: options.chromeWsUrl,
    quiet: options.quiet ?? false,
    verbose: options.verbose ?? false,
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

    try {
      assertNotCommandTypo(url, program);
      assertValidUrl(url);
      if (options.chromeWsUrl !== undefined) {
        assertValidChromeWsUrl(options.chromeWsUrl);
      }
      await collectorAction(url, options);
    } catch (error) {
      handleValidationError(error, false);
    }
  });
}

/**
 * Reject when the URL argument looks like a misspelled command name.
 *
 * Without this guard, `bdg statsu` (meant `bdg status`) gets interpreted
 * as the URL `http://statsu` and Commander launches a browser session
 * there, which is destructive when a daemon isn't already running.
 *
 * Exact command-name matches are handled by Commander before this action
 * runs, so we only see strings that fell through — the typo case.
 */
function assertNotCommandTypo(input: string, program: Command): void {
  const commandNames = program.commands.map((cmd) => cmd.name()).filter((n) => n.length > 0);
  const suggestions = findSimilar(input, commandNames, { maxDistance: 2, maxSuggestions: 2 });
  if (suggestions.length === 0) return;
  const list = suggestions.map((s) => `bdg ${s}`).join(', ');
  throw new CommandError(
    `Unknown command: '${input}'`,
    { suggestion: `Did you mean: ${list}? (Use 'bdg --help' to list commands.)` },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}

function assertValidUrl(url: string): void {
  const result = validateUrl(url);
  if (result.valid) return;
  throw new CommandError(
    result.error,
    result.suggestion ? { suggestion: result.suggestion } : {},
    EXIT_CODES.INVALID_URL
  );
}

function assertValidChromeWsUrl(url: string): void {
  const result = validateChromeWsUrl(url);
  if (result.valid) return;
  throw new CommandError(
    result.error,
    result.suggestion ? { suggestion: result.suggestion } : {},
    EXIT_CODES.INVALID_URL
  );
}
