import { launchChrome, type LaunchOptions } from '@/connection/launcher.js';
import type { LaunchedChrome } from '@/types';

/**
 * Handles Chrome browser launch and connection
 */
export class ChromeBootstrap {
  /**
   * Launch Chrome if not already running, or connect to existing instance.
   *
   * Delegates to chrome-launcher which handles:
   * - Port availability checking
   * - Strict mode enforcement (via portStrictMode option)
   * - Chrome readiness polling
   * - Reusing existing Chrome instances when port is occupied
   *
   * @param port - Chrome debugging port
   * @param targetUrl - Initial URL to navigate to
   * @param launchOptions - Chrome launcher options (userDataDir, logLevel, etc.)
   * @returns LaunchedChrome instance if Chrome was launched, null if already running
   * @throws Error if chrome-launcher fails to launch or connect
   */
  static async launch(
    port: number,
    targetUrl: string,
    launchOptions?: Partial<LaunchOptions>
  ): Promise<LaunchedChrome | null> {
    // Attempt launch - chrome-launcher handles everything:
    // - Port availability checking
    // - Launching new Chrome or reusing existing instance
    // - Strict mode enforcement (throws if portStrictMode=true and can't connect)
    // - Chrome readiness polling with retries

    // Default to headless in CI environments (no display available)
    // User can override via launchOptions.headless if needed
    const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';
    const headless = launchOptions?.headless ?? (isCI ? true : false);

    const chrome = await launchChrome({
      port,
      headless,
      url: targetUrl,
      ...launchOptions,
    });

    // chrome-launcher returns a valid LaunchedChrome when successful
    // PID will be 0 or undefined if reusing an existing Chrome instance
    const isNewLaunch = chrome.pid && chrome.pid > 0;
    if (isNewLaunch) {
      console.error(`Chrome launched (PID: ${chrome.pid})`);
      return chrome; // Return handle so we can kill it on cleanup
    } else {
      console.error(`Chrome already running on port ${port}`);
      return null; // Don't return handle - we don't own this Chrome instance
    }
  }
}
