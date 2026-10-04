import fs from 'node:fs';
import os from 'node:os';

import { Option, type Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { PORT_OPTION_DESCRIPTION } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import {
  chromeWsUrlConflictError,
  invalidChromeFlagError,
  invalidUserDataDirError,
  missingStartUrlError,
  unknownCommandError,
} from '@/errors/messages.js';
import type { TelemetryType } from '@/types.js';
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
  /** Launch Chrome in headless mode. Default: true if no display, false if display available. */
  headless?: boolean;
  /** WebSocket URL for connecting to existing Chrome instance (skips Chrome launch). */
  chromeWsUrl?: string;
  /** Quiet mode - suppress verbose landing page output for AI agents. */
  quiet?: boolean;
  /** Print the result as a JSON envelope. */
  json?: boolean;
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
      'Stop the session this many seconds after the page has loaded (unlimited if not specified)'
    )
    .option('-u, --user-data-dir <path>', 'Chrome user data directory (defaults to session dir)')
    .option(
      '-a, --all',
      'Include all data: no tracking/analytics filtering, and capture every response body (incl. binary)',
      false
    )
    .option('-m, --max-body-size <megabytes>', 'Maximum response body size in MB', '5')
    .addOption(new Option('--compact', 'No effect; kept for compatibility').hideHelp())
    .option(
      '--headless',
      'Run Chrome without a window (default unless DISPLAY or WAYLAND_DISPLAY is set)',
      defaultHeadless
    )
    .option('--no-headless', 'Show browser window')
    .option(
      '--chrome-ws-url <url>',
      'Connect to existing Chrome via its DevTools WebSocket URL: browser (ws://host:port/devtools/browser/<id>, uses the first tab) or page (.../devtools/page/<id>)'
    )
    .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
    .addOption(jsonOption())
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
  port: number | undefined;
  timeout: number | undefined;
  userDataDir: string | undefined;
  includeAll: boolean;
  maxBodySize: number | undefined;
  headless: boolean;
  chromeWsUrl: string | undefined;
  quiet: boolean;
  json: boolean;
  chromeFlags: string[] | undefined;
} {
  const maxBodySizeRule = positiveIntRule({
    name: '--max-body-size',
    min: 1,
    max: 100,
    required: false,
  });
  const timeoutRule = positiveIntRule({ name: '--timeout', min: 1, max: 3600, required: false });
  const portRule = positiveIntRule({ name: '--port', min: 1024, max: 65535, required: false });

  const maxBodySizeMB =
    options.maxBodySize !== undefined ? maxBodySizeRule.validate(options.maxBodySize) : undefined;
  const timeout = options.timeout !== undefined ? timeoutRule.validate(options.timeout) : undefined;

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
    port: options.port !== undefined ? portRule.validate(options.port) : undefined,
    timeout,
    userDataDir,
    includeAll: options.all ?? false,
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    headless: options.headless ?? !hasDisplay(),
    chromeWsUrl: options.chromeWsUrl,
    quiet: options.quiet ?? false,
    json: options.json ?? false,
    chromeFlags,
  };
}

/** Telemetry collected by every session. */
const SESSION_TELEMETRY: TelemetryType[] = ['dom', 'network', 'console'];

/** Flags users type as commands (`bdg version`). */
const FLAG_WORDS: Record<string, string> = { version: '--version', help: '--help' };

/**
 * Reject a bare word that is most likely a mistyped command.
 *
 * Without a dot, colon or slash an argument cannot be a public URL; treating
 * it as one would start Chrome on `http://<word>/`. A dotless host still
 * works as a full URL (`bdg http://intranet/`).
 *
 * @param arg - The URL argument
 * @param commandNames - Registered top-level command names
 * @throws CommandError (81) for a bare word other than `localhost`
 */
function assertNotCommandTypo(arg: string, commandNames: string[]): void {
  if (!/^[a-z][a-z0-9_-]*$/i.test(arg) || arg.toLowerCase() === 'localhost') return;
  const flag = FLAG_WORDS[arg.toLowerCase()];
  const err = unknownCommandError(arg, flag ? [flag] : findSimilar(arg, commandNames));
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Validate the URL and all start options before anything is spawned.
 *
 * @param url - Target URL
 * @param options - Parsed command-line options from Commander
 * @param commandNames - Registered top-level command names (for typo detection)
 * @returns The URL and normalized session options
 * @throws CommandError on any invalid input
 */
function validateStartInput(
  url: string | undefined,
  options: CollectorOptions,
  commandNames: string[]
): { url: string; sessionOptions: ReturnType<typeof buildSessionOptions> } {
  if (url === undefined) {
    const err = missingStartUrlError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  assertNotCommandTypo(url, commandNames);
  assertValidUrl(url);
  if (options.chromeWsUrl !== undefined) {
    assertValidChromeWsUrl(options.chromeWsUrl);
    assertNoLaunchOptions(options);
  }
  if (options.userDataDir !== undefined) assertUserDataDir(options.userDataDir);
  if (options.chromeWsUrl === undefined)
    assertChromeFlags([
      ...(process.env['BDG_CHROME_FLAGS']?.split(' ') ?? []),
      ...(options.chromeFlags?.split(' ') ?? []),
    ]);
  return { url, sessionOptions: buildSessionOptions(options) };
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
    if (url === undefined && !hasUserOptions(program)) {
      console.error(startCommandHelpMessage());
      process.exit(0);
    }

    let validated: ReturnType<typeof validateStartInput>;
    try {
      validated = validateStartInput(
        url,
        options,
        program.commands.map((command) => command.name())
      );
    } catch (error) {
      handleValidationError(error, options.json ?? false);
    }

    await startSessionViaDaemon(validated.url, validated.sessionOptions, SESSION_TELEMETRY);
  });
}

/**
 * Whether any start option was given on the command line (`bdg --port 9333`
 * without a URL is an error, a bare `bdg` shows help).
 *
 * @param program - Root command
 * @returns True if an option came from the command line
 */
function hasUserOptions(program: Command): boolean {
  return program.options.some(
    (option) => program.getOptionValueSource(option.attributeName()) === 'cli'
  );
}

/**
 * Reject a `-u` value that is an option (`-u --json` swallowed the next flag)
 * or an existing file.
 *
 * @param value - Value of `--user-data-dir`
 * @throws CommandError (81) when it cannot be a profile directory
 */
function assertUserDataDir(value: string): void {
  const resolved = expandHome(value);
  let reason: string | undefined;
  if (!value.trim()) reason = 'the path is empty';
  else if (value.startsWith('-')) reason = 'it looks like an option; -u needs a directory path';
  else if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) reason = 'it is a file';
  if (reason === undefined) return;
  const err = invalidUserDataDirError(value, reason);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Reject options that only apply to a Chrome bdg launches.
 *
 * @param options - Parsed options (with `--chrome-ws-url`)
 * @throws CommandError (81) for `--port` or `-u`
 */
function assertNoLaunchOptions(options: CollectorOptions): void {
  const conflicts = [
    ...(options.port !== undefined ? ['--port'] : []),
    ...(options.userDataDir !== undefined ? ['--user-data-dir'] : []),
  ];
  if (conflicts.length === 0) return;
  const err = chromeWsUrlConflictError(conflicts);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/** bdg's own options, which a `--chrome-flags` value must not be */
const BDG_OPTION_WORDS = new Set([
  '--json',
  '-j',
  '--port',
  '-p',
  '--no-headless',
  '-q',
  '--quiet',
]);

/**
 * Reject Chrome flags bdg sets itself, and a `--chrome-flags` value that is
 * one of bdg's options (`--chrome-flags --json` swallowed `--json`).
 *
 * @param flags - Flags from BDG_CHROME_FLAGS and --chrome-flags
 * @throws CommandError (81) for a conflicting or swallowed flag
 */
function assertChromeFlags(flags: string[]): void {
  const flag = flags.find(
    (value) => /^--remote-debugging-(port|pipe)\b/.test(value) || BDG_OPTION_WORDS.has(value)
  );
  if (flag === undefined) return;
  const err = invalidChromeFlagError(flag);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
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
