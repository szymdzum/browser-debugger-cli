import * as chromeLauncher from 'chrome-launcher';
import { LaunchedChrome } from '../types.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface LaunchOptions {
  port?: number;
  userDataDir?: string;
  headless?: boolean;
  url?: string;
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
  const headless = options.headless ?? false;
  const startingUrl = options.url ?? 'about:blank';

  // Generate unique user-data-dir if not provided
  const userDataDir = options.userDataDir ?? generateUniqueUserDataDir();

  console.error(`Launching Chrome with CDP on port ${port}...`);
  console.error(`User data directory: ${userDataDir}`);

  // Build Chrome launch flags
  const chromeFlags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
  ];

  if (headless) {
    chromeFlags.push('--headless=new');
  }

  try {
    const chrome = await chromeLauncher.launch({
      port,
      chromePath: findChromeBinary(), // Let chrome-launcher find Chrome
      chromeFlags,
      startingUrl,
      ignoreDefaultFlags: false,
    });

    console.error(`Chrome launched successfully (PID: ${chrome.pid})`);

    // Wait for CDP to be fully available
    await waitForCDP(port);

    // Return LaunchedChrome instance
    return {
      pid: chrome.pid,
      port: chrome.port,
      kill: async () => {
        try {
          await chrome.kill();
        } catch (error) {
          console.error(`Error killing Chrome: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    };
  } catch (error) {
    throw new Error(`Failed to launch Chrome: ${error instanceof Error ? error.message : String(error)}`);
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
 * Generate a unique temporary user-data-dir path.
 *
 * Creates a unique directory in the system temp folder to avoid
 * conflicts with other Chrome instances or bdg sessions.
 *
 * @returns Absolute path to unique user-data-dir
 */
function generateUniqueUserDataDir(): string {
  const tmpDir = os.tmpdir();
  const uniqueId = `bdg-${Date.now()}-${process.pid}`;
  const userDataDir = path.join(tmpDir, uniqueId);

  // Create directory if it doesn't exist
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  return userDataDir;
}

/**
 * Wait for Chrome CDP to become available.
 *
 * Polls the CDP version endpoint until it responds successfully.
 *
 * @param port - CDP port to check
 * @param maxWaitMs - Maximum time to wait in milliseconds
 * @throws Error if CDP doesn't become available within timeout
 */
async function waitForCDP(port: number, maxWaitMs = 10000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (await isChromeRunning(port)) {
      return; // CDP is ready!
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`CDP not available on port ${port} after ${maxWaitMs}ms`);
}

/**
 * Check if Chrome is already running with CDP on the specified port.
 *
 * @param port - Chrome debugging port to check
 * @returns True if Chrome is running and CDP is available
 */
export async function isChromeRunning(port: number = 9222): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}
