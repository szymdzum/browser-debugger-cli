import { launchChrome, isChromeRunning, type LaunchOptions } from '@/connection/launcher.js';
import type { LaunchedChrome } from '@/types';
import { ChromeLaunchError } from '@/utils/errors.js';

/**
 * Handles Chrome browser launch and connection
 */
export class ChromeBootstrap {
  /**
   * Launch Chrome if not already running, or connect to existing instance
   *
   * @param port - Chrome debugging port
   * @param targetUrl - Initial URL to navigate to
   * @param launchOptions - Chrome launcher options (userDataDir, logLevel, etc.)
   * @returns LaunchedChrome instance if Chrome was launched, null if already running
   * @throws ChromeLaunchError if portStrictMode is enabled and Chrome is already running
   */
  static async launch(
    port: number,
    targetUrl: string,
    launchOptions?: Partial<LaunchOptions>
  ): Promise<LaunchedChrome | null> {
    const chromeRunning = await isChromeRunning(port);

    // In strict mode, fail fast if Chrome is already running
    if (chromeRunning && launchOptions?.portStrictMode) {
      throw new ChromeLaunchError(
        `Chrome is already running on port ${port}. ` +
          `Use a different port or disable --port-strict to reuse the existing instance.`
      );
    }

    if (!chromeRunning) {
      // Launch Chrome with target URL and options
      const chrome = await launchChrome({
        port,
        headless: false,
        url: targetUrl,
        ...launchOptions,
      });
      console.error(`Chrome launched (PID: ${chrome.pid})`);
      return chrome;
    }

    console.error(`Chrome already running on port ${port}`);
    return null;
  }
}
