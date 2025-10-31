import { spawn } from 'child_process';

export interface LaunchOptions {
  port?: number;
  userDataDir?: string;
  headless?: boolean;
  url?: string;
}

/**
 * Launch Chrome with remote debugging enabled.
 *
 * Only supports macOS currently. Chrome will be launched in a new window
 * with the specified debugging port and user data directory.
 *
 * @param options - Launch configuration options
 * @throws Error if Chrome fails to launch or CDP doesn't become available
 *
 * @remarks
 * Chrome 136+ requires --user-data-dir with a non-default directory.
 * See CHROME_SETUP.md for details.
 */
export async function launchChrome(options: LaunchOptions = {}): Promise<void> {
  const port = options.port ?? 9222;
  const headless = options.headless ?? false;
  const url = options.url ?? 'about:blank';
  
  // Chrome 136+ requires --user-data-dir when using --remote-debugging-port
  const userDataDir = options.userDataDir ?? '/tmp/chrome-bdg';
  
  // Build Chrome launch arguments for macOS
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
  ];

  if (headless) {
    chromeArgs.push('--headless=new');
  }

  // Add the URL to open
  chromeArgs.push(url);

  // Use open command for macOS
  try {
    spawn('open', ['-na', 'Google Chrome', '--args', ...chromeArgs], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    
    // Wait for Chrome to start up and CDP to become available
    const maxAttempts = 15;
    const delayMs = 500;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      if (await isChromeRunning(port)) {
        return; // Chrome is ready!
      }
    }
    
    throw new Error('Chrome launched but CDP not available after 7.5 seconds');
  } catch (error) {
    throw new Error(`Failed to launch Chrome: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if Chrome is already running with CDP on the specified port.
 *
 * @param port - Chrome debugging port to check
 * @returns True if Chrome is running and CDP is available
 */
export async function isChromeRunning(port: number = 9222): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}
