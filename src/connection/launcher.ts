import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as chromeLauncher from 'chrome-launcher';

import type { LaunchedChrome, Logger } from './types.js';
import type { Options as ChromeLaunchOptions } from 'chrome-launcher';

import { BDG_CHROME_PREFS, DEFAULT_CDP_PORT, CHROME_PROFILE_DIR } from '@/constants.js';
import { DEFAULT_CHROME_LOG_LEVEL, DEFAULT_CHROME_HANDLE_SIGINT } from '@/constants.js';
import {
  formatDiagnosticsForError,
  chromeLaunchSuccessMessage,
  chromeUserDataDirMessage,
  invalidPortError,
  userDataDirError,
  chromeLaunchFailedError,
} from '@/ui/messages/chrome.js';
import { filterDefined } from '@/utils/objects.js';
import { isProcessAlive } from '@/utils/process.js';

import { getChromeDiagnostics } from './diagnostics.js';
import { ChromeLaunchError, getErrorMessage } from './errors.js';
import { resolveChromeBinary } from './launcher/binaryResolver.js';
import { buildChromeFlags } from './launcher/flagsBuilder.js';
import { loadChromePrefs, ensureJSONCompatiblePrefs } from './launcher/preferencesLoader.js';
import { reservePort } from './portReservation.js';

/**
 * Default logger instance for launcher (uses console).
 *
 * Can be overridden in tests or when launcher is used as a library.
 */
const defaultLogger: Logger = {
  info: (msg) => console.error(msg),
  debug: () => {}, // No-op by default
};

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
    | 'chromePath'
  > {
  /** Remote debugging port (defaults to 9222 when omitted) */
  port?: number;
  /** Directory for Chrome profile data. Falls back to persistent ~/.bdg/chrome-profile directory */
  userDataDir?: string | undefined;
  /** Base directory for creating user data dir (defaults to OS temp dir, injectable for testing) */
  baseDir?: string | undefined;
  /** Logger instance (defaults to console, injectable for testing or custom logging) */
  logger?: Logger | undefined;
  /** When true, launches Chrome in headless mode. Defaults to standard windowed experience */
  headless?: boolean;
  /** Initial URL to open. Defaults to about:blank and is typically replaced during session setup */
  url?: string;
  /** Chrome preferences object to override default settings */
  prefs?: Record<string, unknown> | undefined;
  /** Path to JSON file containing Chrome preferences */
  prefsFile?: string | undefined;
  /** Override Chrome binary detection with an explicit path */
  chromePath?: string;
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
  const logger = options.logger ?? defaultLogger;
  const port = options.port ?? DEFAULT_CDP_PORT;

  if (port < 1 || port > 65535) {
    throw new ChromeLaunchError(invalidPortError(port));
  }

  const reservation = await reservePort(port);
  reservation.release();

  const userDataDir = options.userDataDir ?? getPersistentUserDataDir(options.baseDir);

  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      throw new ChromeLaunchError(
        userDataDirError(userDataDir, getErrorMessage(error)),
        error as Error
      );
    }
  }

  logger.info(`Launching Chrome on port ${port}...`);
  logger.debug(chromeUserDataDirMessage(userDataDir));

  const chromeOptions = buildChromeOptions(options);
  const launcher = new chromeLauncher.Launcher(chromeOptions);

  try {
    const launchStart = Date.now();
    await launcher.launch();

    logger.info('Waiting for Chrome to be ready...');
    await launcher.waitUntilReady();

    const launchDurationMs = Date.now() - launchStart;
    logger.info(`✓ Chrome ready (${launchDurationMs}ms)`);

    const chromeProcessPid = launcher.pid ?? 0;

    if (!chromeProcessPid || chromeProcessPid <= 0 || !isProcessAlive(chromeProcessPid)) {
      launcher.kill();
      launcher.destroyTmp();

      const diagnosticLines = getFormattedDiagnostics();

      const errorType =
        !chromeProcessPid || chromeProcessPid <= 0
          ? 'failed to launch'
          : 'died immediately after launch';

      throw new ChromeLaunchError(
        `Chrome ${errorType} (PID: ${chromeProcessPid})\n\n` +
          `Possible causes:\n` +
          `  - Port ${port} conflict (check: lsof -ti:${port})\n` +
          `  - Chrome binary not found\n` +
          `  - Insufficient permissions\n` +
          `  - Chrome crashed on startup\n\n` +
          `${diagnosticLines.join('\n')}\n\n` +
          `Try:\n` +
          `  - bdg cleanup\n` +
          `  - Kill conflicting process: kill $(lsof -ti:${port})\n` +
          `  - Use different port: bdg <url> --port ${port + 1}`
      );
    }

    logger.info(chromeLaunchSuccessMessage(chromeProcessPid, launchDurationMs));

    return {
      pid: chromeProcessPid,
      port: launcher.port ?? port,
      userDataDir: launcher.userDataDir,
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

    if (error instanceof ChromeLaunchError) {
      throw error;
    }

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
 * @param baseDir - Optional base directory (defaults to OS temp dir). Allows injection for testing or custom locations.
 * @returns Absolute path to persistent user-data-dir
 * @throws Error if user data directory cannot be created due to permission issues
 */
function getPersistentUserDataDir(baseDir?: string): string {
  const dir = baseDir ?? os.tmpdir();
  const userDataDir = path.join(dir, 'bdg-chrome', CHROME_PROFILE_DIR);

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
  const chromePathOverride = resolveChromeBinary(options);

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
      chromePath: chromePathOverride,
    }),
  };
}
