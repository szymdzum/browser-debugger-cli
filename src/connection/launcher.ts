import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as chromeLauncher from 'chrome-launcher';

import type { Options as ChromeLaunchOptions } from 'chrome-launcher';

import {
  BDG_CHROME_FLAGS,
  BDG_CHROME_PREFS,
  DEFAULT_CDP_PORT,
  DEFAULT_CHROME_LOG_LEVEL,
  DEFAULT_CHROME_HANDLE_SIGINT,
  CHROME_PROFILE_DIR,
  HEADLESS_FLAG,
} from '@/constants.js';
import { isProcessAlive } from '@/session/process.js';
import type { LaunchedChrome } from '@/types';
import {
  formatDiagnosticsForError,
  chromeLaunchStartMessage,
  chromeLaunchSuccessMessage,
  chromeUserDataDirMessage,
  invalidPortError,
  userDataDirError,
  prefsFileNotFoundError,
  invalidPrefsFormatError,
  prefsLoadError,
  chromeLaunchFailedError,
} from '@/ui/messages/chrome.js';
import { getChromeDiagnostics } from '@/utils/chromeDiagnostics.js';
import { ChromeLaunchError, getErrorMessage } from '@/utils/errors.js';
import { createLogger } from '@/utils/logger.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('chrome');

/**
 * Get formatted Chrome diagnostics for error messages.
 *
 * Retrieves Chrome installation information and formats it for display
 * in error messages. Uses cached diagnostics to avoid repeated filesystem scans.
 *
 * @returns Array of formatted diagnostic strings
 */
function getFormattedDiagnostics(): string[] {
  const diagnostics = getChromeDiagnostics();
  return formatDiagnosticsForError(diagnostics);
}

// Other Constants
const FILE_NOT_EXIST_ERROR = 'File does not exist';
const INVALID_JSON_STRUCTURE_ERROR = 'Invalid JSON structure';
const REMOTE_DEBUGGING_FLAG = (port: number): string => `--remote-debugging-port=${port}`;

/**
 * JSONLike type matching chrome-launcher's internal type definition.
 *
 * Used for Chrome preferences that must be JSON-serializable values.
 * chrome-launcher enforces this constraint to ensure preferences can be
 * safely serialized and passed to Chrome process.
 */
type JSONLike =
  | {
      [property: string]: JSONLike;
    }
  | readonly JSONLike[]
  | string
  | number
  | boolean
  | null;

/**
 * Options that control how Chrome is launched for CDP sessions.
 * Extended to support chrome-launcher advanced features.
 */
export interface LaunchOptions
  extends Pick<
    ChromeLaunchOptions,
    | 'logLevel'
    | 'connectionPollInterval'
    | 'maxConnectionRetries'
    | 'portStrictMode'
    | 'envVars'
    | 'handleSIGINT'
    | 'ignoreDefaultFlags'
    | 'chromeFlags'
  > {
  /** Remote debugging port (defaults to 9222 when omitted) */
  port?: number;
  /** Directory for Chrome profile data. Falls back to persistent ~/.bdg/chrome-profile directory */
  userDataDir?: string | undefined;
  /** When true, launches Chrome in headless mode. Defaults to standard windowed experience */
  headless?: boolean;
  /** Initial URL to open. Defaults to about:blank and is typically replaced during session setup */
  url?: string;
  /** Chrome preferences object to override default settings */
  prefs?: Record<string, unknown> | undefined;
  /** Path to JSON file containing Chrome preferences */
  prefsFile?: string | undefined;
}

/**
 * Launch Chrome with remote debugging enabled using chrome-launcher.
 *
 * Supports macOS, Linux, and Windows. Chrome will be launched with
 * the specified debugging port and user data directory.
 *
 * Validates Chrome process is alive after launch to detect immediate crashes
 * or port conflicts. Includes Chrome installation diagnostics in error messages
 * to aid troubleshooting.
 *
 * @param options - Launch configuration options
 * @returns LaunchedChrome instance with PID and kill method
 * @throws ChromeLaunchError if Chrome fails to launch, process dies immediately, or CDP doesn't become available
 * @throws Error if user data directory cannot be created
 *
 * @remarks
 * Chrome 136+ requires --user-data-dir with a non-default directory.
 * Uses chrome-launcher for cross-platform Chrome detection and launching.
 */
export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchedChrome> {
  const port = options.port ?? DEFAULT_CDP_PORT;

  // Validate port range
  if (port < 1 || port > 65535) {
    throw new ChromeLaunchError(invalidPortError(port));
  }

  const userDataDir = options.userDataDir ?? getPersistentUserDataDir();

  log.info(chromeLaunchStartMessage(port));
  log.debug(chromeUserDataDirMessage(userDataDir));

  const chromeOptions = buildChromeOptions(options);
  const launcher = new chromeLauncher.Launcher(chromeOptions);

  try {
    const launchStart = Date.now();
    await launcher.launch();
    await launcher.waitUntilReady();
    const launchDurationMs = Date.now() - launchStart;

    const chromeProcessPid = launcher.pid ?? 0;

    // Validate PID before printing success message (Issue #4 from IMPROVEMENTS_ANALYSIS.md)
    if (!chromeProcessPid || chromeProcessPid <= 0) {
      launcher.kill();
      launcher.destroyTmp();

      // Get Chrome diagnostics to provide helpful context
      const diagnosticLines = getFormattedDiagnostics();

      throw new ChromeLaunchError(
        `Chrome failed to launch (PID: ${chromeProcessPid})\n\n` +
          `Possible causes:\n` +
          `  - Port ${port} already in use (check: lsof -ti:${port})\n` +
          `  - Chrome binary not found\n` +
          `  - Insufficient permissions\n\n` +
          `${diagnosticLines.join('\n')}\n\n` +
          `Try:\n` +
          `  - bdg cleanup\n` +
          `  - Use different port: bdg <url> --port ${port + 1}`
      );
    }

    // Verify Chrome process is actually running (Issue #4 fix)
    if (!isProcessAlive(chromeProcessPid)) {
      launcher.kill();
      launcher.destroyTmp();

      throw new ChromeLaunchError(
        `Chrome process died immediately after launch (PID: ${chromeProcessPid})\n\n` +
          `This usually indicates:\n` +
          `  - Port ${port} conflict (another process is using this port)\n` +
          `  - Chrome crashed on startup\n` +
          `  - Insufficient system resources\n\n` +
          `Diagnostics:\n` +
          `  → Check port usage: lsof -ti:${port}\n` +
          `  → Check Chrome logs for crash details\n\n` +
          `Try:\n` +
          `  - bdg cleanup\n` +
          `  - Kill conflicting process: kill $(lsof -ti:${port})\n` +
          `  - Use different port: bdg <url> --port ${port + 1}`
      );
    }

    // Only print success message after validating PID and process liveness
    log.info(chromeLaunchSuccessMessage(chromeProcessPid, launchDurationMs));

    return {
      pid: chromeProcessPid,
      port: launcher.port ?? port,
      userDataDir: launcher.userDataDir,
      process: launcher.chromeProcess ?? null,
      kill: async (): Promise<void> => {
        return Promise.resolve().then(() => {
          launcher.kill();
          launcher.destroyTmp();
        });
      },
    };
  } catch (error) {
    launcher.kill();
    launcher.destroyTmp();

    // If it's already a ChromeLaunchError with diagnostics, just re-throw
    if (error instanceof ChromeLaunchError) {
      throw error;
    }

    // For generic launch failures, add Chrome diagnostics
    const diagnosticLines = getFormattedDiagnostics();

    throw new ChromeLaunchError(
      `${chromeLaunchFailedError(getErrorMessage(error))}\n\n${diagnosticLines.join('\n')}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get the default persistent user-data-dir path.
 *
 * We use a persistent directory to maintain browser state (cookies, localStorage,
 * session storage) across bdg sessions. This prevents users from having to
 * repeatedly log in or accept cookie consent dialogs during debugging workflows.
 *
 * @returns Absolute path to persistent user-data-dir
 * @throws Error if user data directory cannot be created due to permission issues
 */
function getPersistentUserDataDir(): string {
  const homeDir = os.homedir();
  const userDataDir = path.join(homeDir, CHROME_PROFILE_DIR);

  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      throw new Error(userDataDirError(userDataDir, getErrorMessage(error)));
    }
  }

  return userDataDir;
}

/**
 * Load Chrome preferences from options.
 *
 * File-based preferences take precedence over inline preferences because
 * files allow for complex, reusable configurations that can be version
 * controlled and shared across team members or CI environments.
 *
 * @param options - Launch options containing prefs or prefsFile
 * @returns Chrome preferences object or undefined if no preferences specified
 * @throws ChromeLaunchError if prefs file cannot be read, parsed, or doesn't exist
 */
function loadChromePrefs(options: LaunchOptions): Record<string, unknown> | undefined {
  if (options.prefsFile) {
    // Validate file exists before attempting to read
    if (!fs.existsSync(options.prefsFile)) {
      throw new ChromeLaunchError(
        prefsFileNotFoundError(options.prefsFile),
        new Error(FILE_NOT_EXIST_ERROR)
      );
    }

    try {
      const prefsContent = fs.readFileSync(options.prefsFile, 'utf8');
      const parsed: unknown = JSON.parse(prefsContent);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ChromeLaunchError(
          invalidPrefsFormatError(options.prefsFile, typeof parsed),
          new Error(INVALID_JSON_STRUCTURE_ERROR)
        );
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ChromeLaunchError) {
        throw error;
      }

      throw new ChromeLaunchError(
        prefsLoadError(options.prefsFile, getErrorMessage(error)),
        error instanceof Error ? error : undefined
      );
    }
  }

  return options.prefs;
}

/**
 * Build Chrome flags array from launch options.
 *
 * Uses chrome-launcher default flags as base (unless ignoreDefaultFlags is true)
 * and layers bdg-specific overrides on top. Headless mode uses the new headless
 * implementation for better compatibility.
 *
 * @param options - Launch options containing flag preferences
 * @returns Array of Chrome command-line flags
 */
function buildChromeFlags(options: LaunchOptions): string[] {
  const port = options.port ?? DEFAULT_CDP_PORT;

  const baseFlags = options.ignoreDefaultFlags ? [] : chromeLauncher.Launcher.defaultFlags();

  const bdgFlags: string[] = [REMOTE_DEBUGGING_FLAG(port), ...BDG_CHROME_FLAGS];

  if (options.headless) {
    bdgFlags.push(HEADLESS_FLAG);
  }

  return [...baseFlags, ...bdgFlags, ...(options.chromeFlags ?? [])];
}

/**
 * Type-safe conversion for Chrome preferences from unknown to JSONLike.
 *
 * chrome-launcher requires preferences to match its internal JSONLike type constraint
 * for type safety. This conversion is safe because preferences should always be
 * JSON-serializable values loaded from JSON files or constructed with compatible types.
 *
 * @param prefs - Preferences object with unknown values from JSON parsing
 * @returns Preferences compatible with chrome-launcher's JSONLike constraint, or undefined
 */
function ensureJSONCompatiblePrefs(
  prefs: Record<string, unknown> | undefined
): Record<string, JSONLike> | undefined {
  if (prefs === undefined) {
    return undefined;
  }

  // Safe cast because preferences come from JSON.parse or compatible sources
  return prefs as Record<string, JSONLike>;
}

/**
 * Build chrome-launcher options from bdg launch options.
 *
 * Maps LaunchOptions to chrome-launcher API format using a clean utility approach
 * that filters out undefined values automatically. User preferences override bdg
 * defaults to allow customization while maintaining sensible base configuration.
 *
 * @param options - bdg launch options to convert
 * @returns chrome-launcher compatible options object
 * @throws ChromeLaunchError if preference loading fails
 */
function buildChromeOptions(options: LaunchOptions): ChromeLaunchOptions {
  const userPrefs = loadChromePrefs(options);
  const userDataDir = options.userDataDir ?? getPersistentUserDataDir();

  // User preferences take precedence over bdg defaults
  const mergedPrefs = userPrefs ? { ...BDG_CHROME_PREFS, ...userPrefs } : BDG_CHROME_PREFS;

  return {
    logLevel: options.logLevel ?? DEFAULT_CHROME_LOG_LEVEL,
    handleSIGINT: options.handleSIGINT ?? DEFAULT_CHROME_HANDLE_SIGINT,
    ignoreDefaultFlags: options.ignoreDefaultFlags ?? false,
    chromeFlags: buildChromeFlags(options),
    userDataDir,

    ...filterDefined({
      port: options.port,
      startingUrl: options.url,
      connectionPollInterval: options.connectionPollInterval,
      maxConnectionRetries: options.maxConnectionRetries,
      portStrictMode: options.portStrictMode,
      prefs: ensureJSONCompatiblePrefs(mergedPrefs),
      envVars: options.envVars,
    }),
  };
}
