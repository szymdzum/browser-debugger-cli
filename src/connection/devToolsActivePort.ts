/**
 * Finding a running Chrome through its `DevToolsActivePort` file (`bdg attach`
 * without `--chrome-ws-url`, #473): Chrome writes it into its user data dir
 * when remote debugging is on, also when the user enabled it at
 * chrome://inspect/#remote-debugging (no `/json` endpoints then). Its first
 * line is the port, its second the browser path `/devtools/browser/<id>`, so
 * the browser WebSocket URL is built from it without any HTTP call.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CommandError } from '@/errors/index.js';
import {
  devToolsActivePortMissingError,
  devToolsActivePortUnreadableError,
} from '@/errors/messages.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** The file Chrome writes into its user data dir */
const ACTIVE_PORT_FILE = 'DevToolsActivePort';

/** The browser path line: `/devtools/browser/<id>` */
const BROWSER_PATH = /^\/devtools\/browser\/[\w.-]+$/;

/** The port line */
const PORT = /^\d{1,5}$/;

/** Test-only variable: `bdg attach` must be given `--chrome-ws-url` (or `--user-data-dir`) */
export const REQUIRE_WS_URL_ENV = 'BDG_ATTACH_REQUIRE_WS_URL';

/** Values of `BDG_ATTACH_REQUIRE_WS_URL` that leave the guard off */
const GUARD_OFF_VALUES = ['', '0', 'false', 'no', 'off'];

/**
 * Whether `BDG_ATTACH_REQUIRE_WS_URL` forbids reading Chrome's default
 * profile: any value but unset, empty, `0`, `false`, `no` or `off` (any case),
 * so a mistyped value keeps the guard on instead of silently disabling it.
 *
 * @param env - Environment (default: this process)
 * @returns True when attach may only connect through `--chrome-ws-url`
 */
export function isWsUrlRequired(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return !GUARD_OFF_VALUES.includes(env[REQUIRE_WS_URL_ENV]?.trim().toLowerCase() ?? '');
}

/** Where the default Chrome profile lives: the platform and its environment */
export interface ChromeDirContext {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

/** The browser endpoint a `DevToolsActivePort` file names */
export interface DiscoveredBrowser {
  /** `ws://127.0.0.1:<port>/devtools/browser/<id>` */
  wsUrl: string;
  /** The file it was read from */
  file: string;
}

/**
 * The default user data dir of Chrome stable on this platform, as Chrome
 * computes it (`chrome_paths_*.cc`): on Linux `CHROME_CONFIG_HOME`, else
 * `XDG_CONFIG_HOME`, else `~/.config`, then `google-chrome`.
 *
 * @param context - Platform, home dir and environment (default: this process)
 * @returns The directory
 */
export function defaultChromeUserDataDir(
  context: ChromeDirContext = { platform: process.platform, home: os.homedir(), env: process.env }
): string {
  const { platform, home } = context;
  const env = (name: string): string | undefined =>
    context.env[name] === '' ? undefined : context.env[name];
  if (platform === 'win32') {
    const localAppData = env('LOCALAPPDATA') ?? path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(localAppData, 'Google', 'Chrome', 'User Data');
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  const configHome =
    env('CHROME_CONFIG_HOME') ?? env('XDG_CONFIG_HOME') ?? path.posix.join(home, '.config');
  return path.posix.join(configHome, 'google-chrome');
}

/**
 * Port and browser path from a `DevToolsActivePort` file's text.
 *
 * @param text - File content
 * @returns Port and path, or null when the text is not such a file
 */
export function parseDevToolsActivePort(text: string): { port: number; path: string } | null {
  const [portLine = '', pathLine = ''] = text.split(/\r?\n/).map((line) => line.trim());
  const port = Number(portLine);
  if (!PORT.test(portLine) || port < 1 || port > 65535) return null;
  return BROWSER_PATH.test(pathLine) ? { port, path: pathLine } : null;
}

/**
 * Why a `DevToolsActivePort` text did not parse (never quoting its content).
 *
 * @param text - File content
 * @returns The reason
 */
function garbledReason(text: string): string {
  const [portLine = '', pathLine = ''] = text.split(/\r?\n/).map((line) => line.trim());
  if (text.trim() === '') return 'the file is empty';
  if (parseDevToolsActivePort(`${portLine}\n/devtools/browser/x`) === null) {
    return 'line 1 is not a port (1-65535)';
  }
  return pathLine === ''
    ? 'line 2 (the browser path) is missing'
    : 'line 2 is not /devtools/browser/<id>';
}

/**
 * A directory given on the command line with a leading `~` (not expanded
 * by the shell in `--user-data-dir=~/x`) resolved against the home dir.
 *
 * @param dir - The directory
 * @param home - Home dir (default: this user's)
 * @returns The directory with `~` expanded
 */
export function expandHome(dir: string, home: string = os.homedir()): string {
  if (dir === '~') return home;
  return /^~[/\\]/.test(dir) ? path.join(home, dir.slice(2)) : dir;
}

/**
 * The browser endpoint the `DevToolsActivePort` file of a user data dir names.
 *
 * @param userDataDir - Chrome's user data dir
 * @returns Browser WebSocket URL and the file
 * @throws CommandError 83 when the file is missing, unreadable or garbled
 */
export function discoverBrowser(userDataDir: string): DiscoveredBrowser {
  const file = path.join(userDataDir, ACTIVE_PORT_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    fail(missing ? devToolsActivePortMissingError(file) : unreadable(file, error));
  }
  const parsed = parseDevToolsActivePort(text);
  if (!parsed) fail(unreadable(file, garbledReason(text)));
  return { wsUrl: `ws://127.0.0.1:${parsed.port}${parsed.path}`, file };
}

/**
 * The unreadable-file error, with the reason it could not be read.
 *
 * @param file - The file
 * @param reason - The read error, or why the content did not parse
 * @returns Message and suggestion
 */
function unreadable(file: string, reason: unknown): { message: string; suggestion: string } {
  const err = devToolsActivePortUnreadableError(file);
  const detail = typeof reason === 'string' ? reason : getErrorMessage(reason);
  return { ...err, message: `${err.message}: ${detail}` };
}

/**
 * Throw a discovery error (83).
 *
 * @param err - Message and suggestion
 * @throws CommandError always
 */
function fail(err: { message: string; suggestion: string }): never {
  throw new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}
