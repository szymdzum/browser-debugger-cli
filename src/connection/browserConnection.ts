/**
 * The one connection `bdg attach` opens to a running Chrome's browser
 * endpoint (#473). With remote debugging enabled at
 * chrome://inspect/#remote-debugging, every connection makes Chrome ask the
 * user to allow it, so it is opened once, never retried, and waits for the
 * answer.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Logger } from '@/ui/logging/index.js';

/** How long the connection waits for the user to answer Chrome's prompt */
export const ATTACH_APPROVAL_TIMEOUT_MS = 30_000;

/** Options of {@link connectToBrowser} */
export interface BrowserConnectOptions {
  log?: Logger;
  signal?: AbortSignal | undefined;
  onDisconnect?: (cdp: CDPConnection) => void;
  /** The `DevToolsActivePort` file the URL came from (nothing listening: a stale file) */
  activePortFile?: string | undefined;
  /** How long to wait for the connection (the user's answer) */
  timeoutMs?: number;
}

/**
 * Open the browser connection.
 *
 * @param _wsUrl - Browser WebSocket URL
 * @param _options - Options
 * @returns The connection
 */
export function connectToBrowser(
  _wsUrl: string,
  _options: BrowserConnectOptions = {}
): Promise<CDPConnection> {
  throw new Error('not implemented');
}
