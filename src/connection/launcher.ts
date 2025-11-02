import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as chromeLauncher from 'chrome-launcher';

import type { Options as ChromeLaunchOptions } from 'chrome-launcher';

import type { LaunchedChrome } from '@/types';
import { ChromeLaunchError, getErrorMessage } from '@/utils/errors.js';

/**
 * Options that control how Chrome is launched for CDP sessions.
 * Extended to support chrome-launcher advanced features.
 *
 * @property port                   Remote debugging port (defaults to 9222 when omitted).
 * @property userDataDir            Directory used for Chrome profile data. Falls back to
 *                                  the persistent `~/.bdg/chrome-profile` directory.
 * @property headless               When true, launches Chrome in headless mode. Defaults
 *                                  to the standard windowed experience.
 * @property url                    Initial URL to open. Defaults to `about:blank` and is
 *                                  typically replaced during session setup.
 * @property logLevel               Chrome launcher logging level (verbose|info|error|silent).
 *                                  Defaults to 'silent' for minimal output.
 * @property connectionPollInterval Milliseconds between CDP readiness checks. Defaults to 500ms.
 * @property maxConnectionRetries   Maximum retry attempts before failing. Defaults to 50.
 * @property portStrictMode         Fail if port is already in use. Defaults to false (lenient).
 * @property prefs                  Chrome preferences object to override default settings.
 * @property prefsFile              Path to JSON file containing Chrome preferences.
 * @property envVars                Environment variables to pass to Chrome process.
 * @property handleSIGINT           Let chrome-launcher handle SIGINT. Defaults to false (bdg handles it).
 * @property ignoreDefaultFlags     Skip chrome-launcher default flags. Defaults to false.
 * @property chromeFlags            Additional Chrome flags to append to defaults.
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
  port?: number;
  userDataDir?: string | undefined;
  headless?: boolean;
  url?: string;
  prefs?: Record<string, unknown> | undefined;
  prefsFile?: string | undefined;
}

/**
 * Launch Chrome with remote debugging enabled using chrome-launcher.
 *
 * Supports macOS, Linux, and Windows. Chrome will be launched with
 * the specified debugging port and user data directory.
 *
 * @param options - Launch configuration options
 * @returns LaunchedChrome instance with PID and kill method
 * @throws Error if Chrome fails to launch or CDP doesn't become available
 *
 * @remarks
 * Chrome 136+ requires --user-data-dir with a non-default directory.
 * Uses chrome-launcher for cross-platform Chrome detection and launching.
 */
export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchedChrome> {
  const port = options.port ?? 9222;
  const userDataDir = options.userDataDir ?? getPersistentUserDataDir();

  console.error(`Launching Chrome with CDP on port ${port}...`);
  console.error(`User data directory: ${userDataDir}`);

  // Build chrome-launcher options
  const chromePath = findChromeBinary();
  const chromeOptions = buildChromeOptions(options);

  const finalOptions = {
    ...chromeOptions,
    ...(chromePath ? { chromePath } : {}),
  };

  // Create launcher instance
  const launcher = new chromeLauncher.Launcher(finalOptions);

  try {
    // Launch Chrome and wait for it to be ready
    const launchStart = Date.now();
    await launcher.launch();
    await launcher.waitUntilReady();
    const launchDuration = Date.now() - launchStart;

    console.error(`Chrome launched successfully (PID: ${launcher.pid})`);
    console.error(`Launch duration: ${launchDuration}ms`);

    // Return enhanced LaunchedChrome instance with new fields
    return {
      pid: launcher.pid ?? 0, // Should always be defined after successful launch
      port: launcher.port ?? port, // Fall back to requested port
      userDataDir: launcher.userDataDir,
      process: launcher.chromeProcess ?? null,
      kill: async (): Promise<void> => {
        return Promise.resolve().then(() => {
          launcher.kill();
          launcher.destroyTmp(); // Cleanup temp directories
        });
      },
    };
  } catch (error) {
    // Cleanup on failure
    launcher.kill();
    launcher.destroyTmp();

    throw new ChromeLaunchError(
      `Failed to launch Chrome: ${getErrorMessage(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Find Chrome binary path for the current platform.
 *
 * Returns undefined to let chrome-launcher use its own detection logic.
 * Can be extended to support custom paths if needed.
 *
 * @returns Chrome binary path or undefined for auto-detection
 */
function findChromeBinary(): string | undefined {
  // Let chrome-launcher handle Chrome detection
  // It already supports macOS, Linux, Windows, and various Chrome flavors
  return undefined;
}

/**
 * Get the default persistent user-data-dir path.
 *
 * Uses ~/.bdg/chrome-profile to persist cookies, settings, and other
 * browser state across bdg sessions. This allows cookies to be saved
 * and avoids showing cookie consent dialogs on every run.
 *
 * @returns Absolute path to persistent user-data-dir
 */
function getPersistentUserDataDir(): string {
  const homeDir = os.homedir();
  const userDataDir = path.join(homeDir, '.bdg', 'chrome-profile');

  // Create directory if it doesn't exist
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  return userDataDir;
}

/**
 * Load Chrome preferences from options.
 *
 * Supports both inline prefs object and prefs file path.
 * File path takes precedence if both are provided.
 *
 * @param options - Launch options containing prefs or prefsFile
 * @returns Chrome preferences object or undefined
 * @throws Error if prefs file cannot be read or parsed
 */
function loadChromePrefs(options: LaunchOptions): Record<string, unknown> | undefined {
  // Prefs file takes precedence
  if (options.prefsFile) {
    try {
      const prefsContent = fs.readFileSync(options.prefsFile, 'utf8');
      return JSON.parse(prefsContent) as Record<string, unknown>;
    } catch (error) {
      throw new ChromeLaunchError(
        `Failed to load Chrome prefs from ${options.prefsFile}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Fall back to inline prefs
  return options.prefs;
}

/**
 * Build Chrome flags array from launch options.
 *
 * Uses chrome-launcher default flags as base (unless ignoreDefaultFlags is true)
 * and layers bdg-specific overrides on top.
 *
 * @param options - Launch options
 * @returns Array of Chrome command-line flags
 */
function buildChromeFlags(options: LaunchOptions): string[] {
  const port = options.port ?? 9222;

  // Use chrome-launcher defaults as base (unless explicitly ignored)
  const baseFlags = options.ignoreDefaultFlags ? [] : chromeLauncher.Launcher.defaultFlags();

  // Build bdg-specific flags
  // Note: userDataDir is handled by chrome-launcher via ChromeLaunchOptions.userDataDir
  const bdgFlags: string[] = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
  ];

  if (options.headless) {
    bdgFlags.push('--headless=new');
  }

  // Add CI-specific flags when running in container environments
  // These are required for Chrome to run in GitHub Actions and similar environments
  const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';
  if (isCI) {
    bdgFlags.push(
      '--no-sandbox', // Required in containers without proper sandboxing
      '--disable-dev-shm-usage', // Required in containers with limited /dev/shm
      '--disable-gpu' // Not needed in headless mode, prevents GPU errors
    );
  }

  // Combine: base flags + bdg flags + custom flags
  return [...baseFlags, ...bdgFlags, ...(options.chromeFlags ?? [])];
}

/**
 * Build chrome-launcher options from bdg launch options.
 *
 * Maps LaunchOptions to chrome-launcher API format.
 *
 * @param options - bdg launch options
 * @returns chrome-launcher options object
 */
function buildChromeOptions(options: LaunchOptions): ChromeLaunchOptions {
  const prefs = loadChromePrefs(options);
  const userDataDir = options.userDataDir ?? getPersistentUserDataDir();

  return {
    logLevel: options.logLevel ?? 'silent', // Preserve current quiet behavior
    handleSIGINT: options.handleSIGINT ?? false, // Let bdg handle signals
    ignoreDefaultFlags: options.ignoreDefaultFlags ?? false,
    chromeFlags: buildChromeFlags(options),
    userDataDir, // Forward the resolved userDataDir to chrome-launcher
    // Only include optional properties if they're defined
    ...(options.port !== undefined && { port: options.port }),
    ...(options.url !== undefined && { startingUrl: options.url }),
    ...(options.connectionPollInterval !== undefined && {
      connectionPollInterval: options.connectionPollInterval,
    }),
    ...(options.maxConnectionRetries !== undefined && {
      maxConnectionRetries: options.maxConnectionRetries,
    }),
    ...(options.portStrictMode !== undefined && { portStrictMode: options.portStrictMode }),
    // chrome-launcher expects Record<string, JSONLike> but we use Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    ...(prefs !== undefined && { prefs: prefs as any }),
    ...(options.envVars !== undefined && { envVars: options.envVars }),
  };
}
