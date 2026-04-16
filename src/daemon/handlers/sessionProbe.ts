/**
 * Session probe + target-intent helpers for `handleStartSession`.
 *
 * Splits liveness detection and mismatch logic out of SessionHandlers so the
 * handler stays readable and each concern can be exercised in isolation.
 *
 * WHY: Fix for #221 — the daemon previously returned "already running" without
 * verifying that the stored `webSocketDebuggerUrl` still points at a live
 * Chrome, causing new `--chrome-ws-url` requests to be silently ignored.
 */

import { HTTP_LOCALHOST } from '@/constants.js';
import { LAUNCHED_CHROME_DESCRIPTION } from '@/errors/messages.js';
import type { StartSessionRequest } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';
import type { Logger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';

/**
 * Short per-attempt timeout for the liveness probe. Keeps the daemon
 * responsive when Chrome is unreachable, while still long enough to avoid
 * false negatives on a loaded machine.
 */
const PROBE_TIMEOUT_MS = 500;

/** Retry once on timeout/empty reply — Chrome's HTTP endpoint is occasionally briefly busy. */
const PROBE_MAX_ATTEMPTS = 2;

/**
 * Brief pause between probe attempts so the retry samples a genuinely later
 * moment, not the same ~1ms window as the first call.
 */
const PROBE_RETRY_DELAY_MS = 75;

/**
 * Result of a session liveness probe.
 */
export interface SessionProbeResult {
  /** True when at least one CDP target was reachable via HTTP. */
  alive: boolean;
  /** URL of the stored target, when the probe found it. */
  targetUrl?: string;
}

/**
 * Describes a mismatch between the caller's requested target and the
 * currently-active session's target.
 */
export interface TargetMismatch {
  current: string | undefined;
  requested: string | undefined;
}

/**
 * Determine the host and port to reach Chrome's HTTP endpoint for a session.
 *
 * For daemon-launched Chrome, `metadata.port` on HTTP_LOCALHOST is used.
 * For external Chrome via `--chrome-ws-url`, the host/port are parsed from
 * `webSocketDebuggerUrl` since the stored `port` is bdg's default and does
 * not reflect where the external Chrome actually listens.
 */
export function extractCdpEndpoint(metadata: SessionMetadata): {
  host: string;
  port: number | undefined;
} {
  if (metadata.webSocketDebuggerUrl) {
    try {
      const u = new URL(metadata.webSocketDebuggerUrl);
      const parsedPort = u.port ? Number(u.port) : undefined;
      return {
        host: u.hostname || HTTP_LOCALHOST,
        port: parsedPort ?? metadata.port,
      };
    } catch {
      // Fall through to defaults
    }
  }
  return { host: HTTP_LOCALHOST, port: metadata.port };
}

/**
 * Probe whether the currently-recorded session's Chrome is still reachable.
 *
 * Uses a short timeout with one retry so a dead Chrome is detected quickly
 * without flagging a momentarily-busy healthy Chrome as dead.
 */
export async function probeSessionAlive(
  metadata: SessionMetadata | null,
  logger: Logger
): Promise<SessionProbeResult> {
  if (!metadata) {
    return { alive: false };
  }

  const { host, port } = extractCdpEndpoint(metadata);
  if (!port) {
    return { alive: false };
  }

  for (let attempt = 0; attempt < PROBE_MAX_ATTEMPTS; attempt++) {
    const targets = await fetchCDPTargets(port, logger, { host, timeoutMs: PROBE_TIMEOUT_MS });
    if (targets.length > 0) {
      const target = metadata.targetId
        ? targets.find((t) => t.id === metadata.targetId)
        : targets[0];
      return target?.url ? { alive: true, targetUrl: target.url } : { alive: true };
    }
    if (attempt < PROBE_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
    }
  }

  return { alive: false };
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
 * sessions (`--chrome-ws-url`) store `chromePid: 0` because the worker does
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
