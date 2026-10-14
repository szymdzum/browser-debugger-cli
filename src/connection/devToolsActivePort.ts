/**
 * Finding a running Chrome through its `DevToolsActivePort` file (`bdg attach`
 * without `--chrome-ws-url`, #473): Chrome writes it into its user data dir
 * when remote debugging is on, also when the user enabled it at
 * chrome://inspect/#remote-debugging (no `/json` endpoints then).
 */

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
 * The default user data dir of Chrome stable on this platform.
 *
 * @param _context - Platform, home dir and environment
 * @returns The directory
 */
export function defaultChromeUserDataDir(_context?: ChromeDirContext): string {
  throw new Error('not implemented');
}

/**
 * Port and browser path from a `DevToolsActivePort` file's text.
 *
 * @param _text - File content
 * @returns Port and path, or null when the text is not such a file
 */
export function parseDevToolsActivePort(_text: string): { port: number; path: string } | null {
  throw new Error('not implemented');
}

/**
 * The browser endpoint the `DevToolsActivePort` file of a user data dir names.
 *
 * @param _userDataDir - Chrome's user data dir
 * @returns Browser WebSocket URL and the file
 */
export function discoverBrowser(_userDataDir: string): DiscoveredBrowser {
  throw new Error('not implemented');
}
