/**
 * Direct CDP mode for one-shot commands without daemon.
 *
 * Allows commands like `bdg dom screenshot` to work with `--chrome-ws-url`
 * directly connecting to a Chrome instance without needing a running session.
 */

import type { ClientResponse } from '@/ipc/protocol/index.js';

import { CDPConnection } from './cdp.js';

// Use global to ensure singleton across dynamic imports
declare global {
   
  var __bdgDirectMode:
    | {
        wsUrl: string | null;
        connection: CDPConnection | null;
      }
    | undefined;
}

function getState(): { wsUrl: string | null; connection: CDPConnection | null } {
  global.__bdgDirectMode ??= { wsUrl: null, connection: null };
  return global.__bdgDirectMode;
}

/**
 * Set the direct WebSocket URL for one-shot CDP commands.
 * When set, CDP calls will use this connection instead of the daemon.
 */
export function setDirectWsUrl(wsUrl: string): void {
  getState().wsUrl = wsUrl;
}

/**
 * Get the current direct WebSocket URL.
 */
export function getDirectWsUrl(): string | null {
  return getState().wsUrl;
}

/**
 * Check if direct mode is active.
 */
export function isDirectMode(): boolean {
  return getState().wsUrl !== null;
}

/**
 * Get or create the direct CDP connection.
 */
async function getDirectConnection(): Promise<CDPConnection> {
  const state = getState();
  if (!state.wsUrl) {
    throw new Error('Direct mode not configured - no WebSocket URL set');
  }

  if (!state.connection) {
    state.connection = new CDPConnection();
    await state.connection.connect(state.wsUrl);
  }

  return state.connection;
}

/**
 * Execute a CDP call in direct mode.
 */
export async function callCDPDirect(
  method: string,
  params?: Record<string, unknown>
): Promise<ClientResponse<'cdp_call'>> {
  const connection = await getDirectConnection();
  const cdpResult = await connection.send(method, params ?? {});

  return {
    type: 'cdp_call_response',
    status: 'ok',
    data: { result: cdpResult },
    sessionId: 'direct',
  };
}

/**
 * Close the direct connection if open.
 */
export function closeDirectConnection(): void {
  const state = getState();
  if (state.connection) {
    state.connection.close();
    state.connection = null;
  }
  state.wsUrl = null;
}
