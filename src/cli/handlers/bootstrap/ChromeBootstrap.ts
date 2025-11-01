import { launchChrome, isChromeRunning } from '@/connection/launcher.js';
import type { LaunchedChrome } from '@/types';

/**
 * Handles Chrome browser launch and connection
 */
export class ChromeBootstrap {
  /**
   * Launch Chrome if not already running, or connect to existing instance
   *
   * @param port - Chrome debugging port
   * @param targetUrl - Initial URL to navigate to
   * @param userDataDir - Optional Chrome user data directory
   * @returns LaunchedChrome instance if Chrome was launched, null if already running
   */
  static async launch(
    port: number,
    targetUrl: string,
    userDataDir?: string
  ): Promise<LaunchedChrome | null> {
    const chromeRunning = await isChromeRunning(port);

    if (!chromeRunning) {
      // Launch Chrome with target URL
      const chrome = await launchChrome({
        port,
        headless: false,
        url: targetUrl,
        userDataDir,
      });
      console.error(`Chrome launched (PID: ${chrome.pid})`);
      return chrome;
    }

    console.error(`Chrome already running on port ${port}`);
    return null;
  }
}
