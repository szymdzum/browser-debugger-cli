/**
 * Target-intent check for `start_session` while a session is already running.
 *
 * Decides whether a new start request targets the same Chrome as the running
 * session (launched vs attached via --chrome-ws-url, and which endpoint).
 */

import { LAUNCHED_CHROME_DESCRIPTION } from '@/errors/messages.js';
import type { StartSessionRequest } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';

/**
 * Describes a mismatch between the caller's requested target and the
 * currently-active session's target.
 */
export interface TargetMismatch {
  current: string | undefined;
  requested: string | undefined;
}

/**
 * Extract a normalized `host:port` string from a ws URL. Returns null when the
 * URL is malformed or has no hostname.
 *
 * Used to compare attach-mode endpoints since the user-supplied
 * `--chrome-ws-url` is typically browser-level (`/devtools/browser/<uuid>`)
 * while the stored `webSocketDebuggerUrl` is the selected page-level target
 * (`/devtools/page/<id>`). Host+port identifies the Chrome instance; the path
 * does not.
 */
function extractWsEndpoint(ws: string): string | null {
  try {
    const u = new URL(ws);
    if (!u.hostname) return null;
    const port = u.port || (u.protocol === 'wss:' ? '443' : '80');
    return `${u.hostname}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Decide whether a session represents attached-mode Chrome.
 *
 * bdg-launched Chrome always records its PID as a positive integer. Attached
 * sessions (`--chrome-ws-url`) store `chromePid: 0` because the session does
 * not own the external Chrome process. A missing `chromePid` is treated as
 * attached for safety — we would rather compare ws endpoints than assume a
 * mode we can't prove.
 */
function isAttachedMode(metadata: SessionMetadata | null): boolean {
  const pid = metadata?.chromePid;
  return !pid || pid <= 0;
}

/**
 * Detect whether a new start-session request names a different Chrome target
 * than the currently-active session.
 *
 * Modes:
 * - **Launched**: no `--chrome-ws-url` (request) / `chromePid > 0` (active).
 * - **Attached**: `--chrome-ws-url` present (request) / `chromePid` 0 or
 *   missing (active).
 *
 * Rules:
 * - Both launched → no mismatch (idempotent re-attach to bdg's Chrome).
 * - Mode differs → mismatch (attaching to a different browser is not
 *   compatible with the live one).
 * - Both attached → compare `host:port` (path/page-id may differ
 *   harmlessly). Different endpoints → mismatch.
 */
export function detectTargetMismatch(
  request: Pick<StartSessionRequest, 'chromeWsUrl'>,
  metadata: SessionMetadata | null
): TargetMismatch | null {
  const requestedWs = request.chromeWsUrl;
  const currentWs = metadata?.webSocketDebuggerUrl;
  const requestedIsAttach = Boolean(requestedWs);
  const currentIsAttach = isAttachedMode(metadata);

  if (!requestedIsAttach && !currentIsAttach) {
    return null;
  }

  if (requestedIsAttach && !currentIsAttach) {
    return { current: LAUNCHED_CHROME_DESCRIPTION, requested: requestedWs };
  }

  if (!requestedIsAttach && currentIsAttach) {
    return { current: currentWs, requested: LAUNCHED_CHROME_DESCRIPTION };
  }

  if (!requestedWs || !currentWs) {
    return { current: currentWs, requested: requestedWs };
  }

  const requestedEndpoint = extractWsEndpoint(requestedWs);
  const currentEndpoint = extractWsEndpoint(currentWs);
  if (requestedEndpoint && currentEndpoint && requestedEndpoint === currentEndpoint) {
    return null;
  }
  return { current: currentWs, requested: requestedWs };
}
