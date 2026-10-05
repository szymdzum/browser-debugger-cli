import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as chromeLauncher from 'chrome-launcher';

import type { LaunchedChrome, Logger } from './types.js';
import type { ChildProcess } from 'child_process';
import type { Options as ChromeLaunchOptions } from 'chrome-launcher';

import {
  BDG_CHROME_PREFS,
  DEFAULT_CDP_PORT,
  CHROME_PROFILE_DIR,
  DEFAULT_CHROME_LOG_LEVEL,
  DEFAULT_CHROME_HANDLE_SIGINT,
} from '@/constants.js';
import { getErrorMessage } from '@/utils/errors.js';
import { filterDefined } from '@/utils/objects.js';
import { isProcessAlive } from '@/utils/process.js';

import { ChromeLaunchError } from './errors.js';
import { resolveChromeBinary } from './launcher/binaryResolver.js';
import { buildChromeFlags } from './launcher/flagsBuilder.js';
import { loadChromePrefs, ensureJSONCompatiblePrefs } from './launcher/preferencesLoader.js';
import { reservePort } from './portReservation.js';
import { markStartupLogs, watchStartupExit } from './startupExit.js';

/**
 * Default logger instance for launcher (uses console).
 *
 * Can be overridden in tests or when launcher is used as a library.
 */
/**
 * How often to check whether Chrome's debugging port answers (chrome-launcher
 * defaults to 500 ms; Chrome is usually listening within 100–300 ms)
 */
const CHROME_READY_POLL_MS = 50;
/** Checks before giving up: 25 s in all, as with chrome-launcher's defaults */
const CHROME_READY_POLL_ATTEMPTS = 500;

const defaultLogger: Logger = {
  info: (msg) => console.error(msg),
  debug: () => {}, // No-op by default
};

/**
 * Options that control how Chrome is launched for CDP sessions.
 * Extended to support chrome-launcher advanced features.
 */
export interface LaunchOptions extends Pick<
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
  /** bdg session directory: recorded as a marker flag on the Chrome command line, and holds the default profile */
  sessionDir?: string | undefined;
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
    throw new ChromeLaunchError(`Invalid port number: ${port}`, {
      issue: { code: 'INVALID_PORT', context: { port } },
    });
  }

  const reservation = await reservePort(port);
  reservation.release();

  const userDataDir =
    options.userDataDir ?? getPersistentUserDataDir(options.baseDir ?? options.sessionDir);

  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      throw new ChromeLaunchError(`Failed to create user data directory`, {
        cause: error as Error,
        issue: {
          code: 'USER_DATA_DIR_CREATE_FAILED',
          context: { userDataDir, reason: getErrorMessage(error) },
        },
      });
    }
  }

  logger.info(`Launching Chrome on port ${port}...`);
  logger.debug(`User data directory: ${userDataDir}`);

  const chromeOptions = buildChromeOptions(options);
  const launcher = new chromeLauncher.Launcher(chromeOptions);

  const startup = watchStartupExit(
    () => (launcher as unknown as { chromeProcess?: ChildProcess }).chromeProcess,
    markStartupLogs(userDataDir),
    userDataDir
  );
  try {
    const launchStart = Date.now();
    logger.info('Waiting for Chrome to be ready...');
    await Promise.race([launcher.launch(), startup.exited]);
    startup.stop();

    const launchDurationMs = Date.now() - launchStart;
    logger.info(`✓ Chrome ready (${launchDurationMs}ms)`);

    const chromeProcessPid = launcher.pid ?? 0;

    if (!chromeProcessPid || chromeProcessPid <= 0 || !isProcessAlive(chromeProcessPid)) {
      launcher.kill();
      launcher.destroyTmp();

      const didNotStart = !chromeProcessPid || chromeProcessPid <= 0;

      throw new ChromeLaunchError(
        `Chrome ${didNotStart ? 'failed to launch' : 'died immediately after launch'} (PID: ${chromeProcessPid})`,
        {
          issue: {
            code: didNotStart ? 'CHROME_LAUNCH_FAILED' : 'CHROME_DIED_AFTER_LAUNCH',
            context: { port, pid: chromeProcessPid },
          },
        }
      );
    }

    logger.info(`Chrome launched successfully (PID: ${chromeProcessPid}, ${launchDurationMs}ms)`);

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
    startup.stop();
    launcher.kill();
    launcher.destroyTmp();

    if (error instanceof ChromeLaunchError) {
      throw error;
    }

    throw new ChromeLaunchError(`Failed to launch Chrome: ${getErrorMessage(error)}`, {
      ...(error instanceof Error && { cause: error }),
      issue: {
        code: 'CHROME_LAUNCH_FAILED',
        context: { port, reason: getErrorMessage(error) },
      },
    });
  }
}

/**
 * Get the default persistent user-data-dir path.
 *
 * Uses the session directory (`~/.bdg`, `$BDG_SESSION_DIR`, or
 * `<base>/sessions/<name>` for a named session, passed as `sessionDir`) to
 * store Chrome profile data,
 * ensuring each session has its own isolated Chrome profile. This prevents
 * SingletonLock conflicts when multiple agents run concurrently.
 *
 * Note: Login state is NOT shared between sessions. Each session starts fresh.
 * For shared login state across sessions, use --user-data-dir to specify a
 * shared location explicitly.
 *
 * @param baseDir - Optional base directory (defaults to `~/.bdg` or `$BDG_SESSION_DIR`). Allows injection for testing or custom locations.
 * @returns Absolute path to session-isolated user-data-dir
 * @throws Error if user data directory cannot be created due to permission issues
 */
function getPersistentUserDataDir(baseDir?: string): string {
  // Inline session dir logic to avoid circular dependency with session module
  const getDefaultSessionDir = (): string => {
    const override = process.env['BDG_SESSION_DIR'];
    if (override && override.trim().length > 0) {
      return path.isAbsolute(override) ? override : path.resolve(override);
    }
    return path.join(os.homedir(), '.bdg');
  };

  const dir = baseDir ?? getDefaultSessionDir();
  const userDataDir = path.join(dir, CHROME_PROFILE_DIR);

  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      throw new ChromeLaunchError(`Failed to create user data directory`, {
        cause: error as Error,
        issue: {
          code: 'USER_DATA_DIR_CREATE_FAILED',
          context: { userDataDir, reason: getErrorMessage(error) },
        },
      });
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
  const userDataDir =
    options.userDataDir ?? getPersistentUserDataDir(options.baseDir ?? options.sessionDir);
  const chromePathOverride = resolveChromeBinary(options);

  const mergedPrefs = userPrefs ? { ...BDG_CHROME_PREFS, ...userPrefs } : BDG_CHROME_PREFS;

  return {
    logLevel: options.logLevel ?? DEFAULT_CHROME_LOG_LEVEL,
    handleSIGINT: options.handleSIGINT ?? DEFAULT_CHROME_HANDLE_SIGINT,
    ignoreDefaultFlags: true,
    chromeFlags: buildChromeFlags(options),
    userDataDir,

    ...filterDefined({
      port: options.port,
      startingUrl: options.url,
      connectionPollInterval: options.connectionPollInterval ?? CHROME_READY_POLL_MS,
      maxConnectionRetries: options.maxConnectionRetries ?? CHROME_READY_POLL_ATTEMPTS,
      portStrictMode: options.portStrictMode,
      prefs: ensureJSONCompatiblePrefs(mergedPrefs),
      envVars: options.envVars,
      chromePath: chromePathOverride,
    }),
  };
}
