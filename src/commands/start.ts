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
  externalChromeUnreachableError,
  invalidChromeFlagError,
  notDevToolsEndpointError,
  invalidColorSchemeError,
  invalidUserDataDirError,
  invalidViewportError,
  missingStartUrlError,
  unknownCommandError,
} from '@/errors/messages.js';
import type { ColorScheme, TelemetryType, ViewportSize } from '@/types.js';
import { startCommandHelpMessage } from '@/ui/messages/commands.js';
import { directoryProblem } from '@/utils/directories.js';
import { hasDisplay } from '@/utils/display.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { probeDevToolsEndpoint } from '@/utils/http.js';
import { findSimilar } from '@/utils/suggestions.js';
import { devToolsHttpEndpoint, validateChromeWsUrl, validateUrl } from '@/utils/url.js';

/**
 * Parsed command-line flags shared by the start subcommands.
 */
export interface CollectorOptions {
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
  /** Viewport size, e.g. `1280x800`. */
  viewport?: string;
  /** Emulate a phone (`--mobile`) */
  mobile?: boolean;
  /** `prefers-color-scheme` to emulate: light or dark. */
  colorScheme?: string;
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
export function applyCollectorOptions(command: Command): Command {
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
      'Run Chrome without a window (default without a display: Linux without DISPLAY or WAYLAND_DISPLAY, macOS over SSH or in CI)',
      defaultHeadless
    )
    .option('--no-headless', 'Show browser window')
    .option(
      '--chrome-ws-url <url>',
      'Connect to an existing Chrome: its DevTools port (9222, host:port, http://host:port), or a WebSocket URL: browser (ws://host:port/devtools/browser/<id>, uses the first tab) or page (.../devtools/page/<id>)'
    )
    .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
    .addOption(jsonOption())
    .option(
      '--chrome-flags <flags>',
      'Custom Chrome flags (space-separated, e.g., --chrome-flags="--ignore-certificate-errors --disable-web-security")'
    )
    .option(
      '--viewport <WxH>',
      'Viewport size in CSS px for the whole session, e.g. 1280x800 (default: 1920x1080 window)'
    )
    .option(
      '--color-scheme <scheme>',
      'Emulate prefers-color-scheme for the session: light or dark (default: the system setting)'
    )
    .option(
      '--mobile',
      `Emulate a phone for the session: mobile viewport (${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height} unless --viewport), touch, mobile user agent`
    );
}

/** Viewport of `--mobile` without `--viewport` (a common phone, CSS px) */
export const MOBILE_VIEWPORT: ViewportSize = { width: 390, height: 844 };

/**
 * The viewport to emulate from `--viewport` and `--mobile`.
 *
 * @param viewport - `--viewport` value
 * @param mobile - `--mobile` was given
 * @returns Viewport (a phone's with `--mobile`), or undefined for neither
 * @throws CommandError (81) for an invalid size
 */
export function requestedViewport(
  viewport: string | undefined,
  mobile: boolean | undefined
): ViewportSize | undefined {
  const size = viewport !== undefined ? parseViewport(viewport) : undefined;
  if (!mobile) return size;
  return { ...(size ?? MOBILE_VIEWPORT), mobile: true };
}

/** Largest viewport side accepted by `--viewport` (CSS px) */
const MAX_VIEWPORT_SIDE = 10000;

/** Values of `--color-scheme` */
const COLOR_SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

/**
 * Parse a `--viewport` value: width and height in CSS px joined by `x`
 * (`1280x800`; `X`, `×` and `,` work too).
 *
 * @param value - Option value
 * @returns Viewport size
 * @throws CommandError (81) for anything else, or a side outside 1-10000
 */
export function parseViewport(value: string): ViewportSize {
  const match = /^\s*(\d+)\s*[xX×,]\s*(\d+)\s*$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  const valid = (side: number): boolean => side >= 1 && side <= MAX_VIEWPORT_SIDE;
  if (match && valid(width) && valid(height)) return { width, height };
  const err = invalidViewportError(value, MAX_VIEWPORT_SIDE);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Parse a `--color-scheme` value (case-insensitive).
 *
 * @param value - Option value
 * @returns The scheme
 * @throws CommandError (81) for another value, suggesting the closest one
 */
export function parseColorScheme(value: string): ColorScheme {
  const scheme = COLOR_SCHEMES.find((candidate) => candidate === value.trim().toLowerCase());
  if (scheme) return scheme;
  const err = invalidColorSchemeError(value, findSimilar(value, [...COLOR_SCHEMES]), COLOR_SCHEMES);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
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
  viewport: ViewportSize | undefined;
  colorScheme: ColorScheme | undefined;
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
    viewport: requestedViewport(options.viewport, options.mobile),
    colorScheme:
      options.colorScheme !== undefined ? parseColorScheme(options.colorScheme) : undefined,
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
 * Reject a subcommand typed without its group (`bdg query x` for
 * `bdg dom query x`) before Commander reads it as a start URL with extra
 * arguments.
 *
 * @param program - Root command with all commands registered
 * @param argv - Process arguments
 * @throws CommandError (81) naming the full command
 */
export function assertNotGroupSubcommand(program: Command, argv: string[]): void {
  const [first] = argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (first === undefined || program.commands.some((command) => command.name() === first)) return;
  const group = program.commands.find((command) =>
    command.commands.some((sub) => sub.name() === first)
  );
  if (!group) return;
  const err = unknownCommandError(first, [`${group.name()} ${first}`]);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Validate the URL and all start options before anything is spawned.
 *
 * @param url - Target URL
 * @param options - Parsed command-line options from Commander
 * @param program - Root command (registered command names for typo detection,
 *   and which options came from the command line)
 * @returns The URL and normalized session options
 * @throws CommandError on any invalid input
 */
function validateStartInput(
  url: string | undefined,
  options: CollectorOptions,
  program: Command
): { url: string; sessionOptions: ReturnType<typeof buildSessionOptions> } {
  if (url === undefined) {
    const err = missingStartUrlError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  assertNotCommandTypo(
    url,
    program.commands.map((command) => command.name())
  );
  assertValidUrl(url);
  if (options.chromeWsUrl !== undefined) {
    assertValidChromeWsUrl(options.chromeWsUrl);
    assertNoLaunchOptions(options, program);
  }
  if (options.userDataDir !== undefined) assertUserDataDir(options.userDataDir);
  if (options.chromeWsUrl === undefined)
    assertChromeFlags([
      ...(process.env['BDG_CHROME_FLAGS']?.split(' ') ?? []),
      ...(options.chromeFlags?.split(' ') ?? []),
    ]);
  const sessionOptions = buildSessionOptions(options);
  if (sessionOptions.userDataDir !== undefined) assertUsableProfile(sessionOptions.userDataDir);
  return { url, sessionOptions };
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
      validated = validateStartInput(url, options, program);
      validated.sessionOptions.chromeWsUrl = await resolveChromeWsUrl(
        validated.sessionOptions.chromeWsUrl
      );
    } catch (error) {
      handleValidationError(error, options.json ?? false);
    }

    await startSessionViaDaemon(validated.url, validated.sessionOptions, SESSION_TELEMETRY);
  });
}

/**
 * Turn a `--chrome-ws-url` that names the HTTP DevTools endpoint (a port,
 * `host:port`, or `http://host:port`) into the browser's WebSocket URL from
 * its `/json/version`, so users need not look it up themselves.
 *
 * @param value - Option value (WebSocket URLs are returned unchanged)
 * @returns WebSocket URL, or undefined without the option
 * @throws CommandError (101) when the endpoint does not answer or is not DevTools
 */
async function resolveChromeWsUrl(value: string | undefined): Promise<string | undefined> {
  const endpoint = value === undefined ? null : devToolsHttpEndpoint(value);
  if (endpoint === null) return value;
  const { hostname, port, protocol } = new URL(endpoint);
  const secure = protocol === 'https:';
  const defaultPort = secure ? 443 : 80;
  const probe = await probeDevToolsEndpoint(Number(port) || defaultPort, undefined, {
    host: hostname,
    secure,
  });
  if (probe.kind === 'devtools') return atEndpoint(probe.wsUrl, endpoint);
  const err =
    probe.kind === 'not-devtools'
      ? notDevToolsEndpointError(endpoint)
      : externalChromeUnreachableError(endpoint, false);
  throw new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.CDP_CONNECTION_FAILURE
  );
}

/**
 * Point a WebSocket URL Chrome reported at the endpoint the user gave: Chrome
 * reports its own host and port, which differ behind a proxy or forwarded
 * port, and only ws:// (an https endpoint is a TLS proxy, so wss://).
 *
 * @param wsUrl - URL from `/json/version`
 * @param endpoint - Endpoint origin the user gave
 * @returns The URL with the endpoint's host, port and matching scheme
 */
function atEndpoint(wsUrl: string, endpoint: string): string {
  const resolved = new URL(wsUrl);
  const target = new URL(endpoint);
  resolved.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  resolved.host = target.host;
  return resolved.toString();
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
 * Check that Chrome can create and write its profile directory (given with
 * `-u` or in `--chrome-flags`), before a daemon is spawned: a profile under
 * `/proc` spun the daemon at full CPU and wedged the session.
 *
 * @param dir - Profile directory, `~/` expanded
 * @throws CommandError (81) for a path that cannot hold a directory, (82)
 *   when its nearest existing directory is not writable
 */
function assertUsableProfile(dir: string): void {
  const problem = directoryProblem(dir);
  if (!problem) return;
  const err = invalidUserDataDirError(dir, problem.reason);
  throw new CommandError(
    err.message,
    { suggestion: err.suggestion },
    problem.denied ? EXIT_CODES.PERMISSION_DENIED : EXIT_CODES.INVALID_ARGUMENTS
  );
}

/**
 * Options given that only apply to a Chrome bdg launches. `--headless` has a
 * default, so it counts only when given on the command line.
 *
 * @param options - Parsed options
 * @param program - Command the options were parsed by
 * @returns The conflicting flags, e.g. ["--port", "--headless"]
 */
export function launchOptionConflicts(options: CollectorOptions, program: Command): string[] {
  const headlessGiven = program.getOptionValueSource('headless') === 'cli';
  return [
    ...(options.port !== undefined ? ['--port'] : []),
    ...(options.userDataDir !== undefined ? ['--user-data-dir'] : []),
    ...(headlessGiven ? [options.headless ? '--headless' : '--no-headless'] : []),
  ];
}

/**
 * Reject options that only apply to a Chrome bdg launches.
 *
 * @param options - Parsed options (with `--chrome-ws-url`)
 * @param program - Command the options were parsed by
 * @throws CommandError (81) for `--port`, `-u` or `--[no-]headless`
 */
function assertNoLaunchOptions(options: CollectorOptions, program: Command): void {
  const conflicts = launchOptionConflicts(options, program);
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
