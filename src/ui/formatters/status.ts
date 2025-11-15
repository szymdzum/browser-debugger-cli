import { getChromeDiagnostics } from '@/connection/diagnostics.js';
import type { SessionActivity, PageState } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { isProcessAlive } from '@/session/process.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { formatDiagnosticsForStatus } from '@/ui/messages/chrome.js';
import { VERSION } from '@/utils/version.js';

export interface StatusData {
  version: string;
  active: boolean;
  bdgPid?: number;
  chromePid?: number | undefined;
  chromeAlive?: boolean;
  startTime?: number;
  duration?: number;
  durationFormatted?: string;
  port?: number;
  targetId?: string | undefined;
  webSocketDebuggerUrl?: string | undefined;
  telemetry?: string[];
  stale?: boolean;
  stalePid?: number;
  warning?: string;
  // Enhanced activity data
  activity?: SessionActivity;
  pageState?: PageState;
}

/**
 * Format "time ago" string from timestamp
 */
function formatTimeAgo(timestamp: number): string {
  const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  return `${hoursAgo}h ago`;
}

/**
 * Format session status for human-readable output
 * @param metadata - Session metadata
 * @param pid - BDG process ID
 * @param activity - Live activity metrics from worker
 * @param pageState - Current page state from worker
 * @param verbose - Show detailed Chrome diagnostics
 */
export function formatSessionStatus(
  metadata: SessionMetadata,
  pid: number,
  activity?: SessionActivity,
  pageState?: PageState,
  verbose = false
): string {
  // Calculate duration
  const now = Date.now();
  const durationMs = now - metadata.startTime;
  const durationSec = Math.floor(durationMs / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const durationFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Check if Chrome is alive
  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  const fmt = new OutputFormatter();

  fmt.text('Session Status').separator('━', 50);
  fmt.keyValueList(
    [
      ['Status', 'ACTIVE'],
      ['Duration', durationFormatted],
    ],
    18
  );

  fmt.blank().text('Process Information').separator('━', 50);
  fmt.keyValue('Daemon PID', pid.toString(), 18);

  if (metadata.chromePid) {
    fmt.keyValue(
      'Chrome PID',
      `${metadata.chromePid} ${chromeAlive ? '(running)' : '(not running)'}`,
      18
    );
  }

  fmt.keyValue('Port', metadata.port.toString(), 18);

  // Target Information (from live worker data)
  if (pageState) {
    fmt.blank().text('Target Information').separator('━', 50);
    fmt.keyValue('URL', pageState.url, 18);
    if (pageState.title) {
      fmt.keyValue('Title', pageState.title, 18);
    }
  }

  // Activity Section (from live worker data)
  if (activity) {
    fmt.blank().text('Activity').separator('━', 50);
    fmt.keyValue('Network Requests', `${activity.networkRequestsCaptured} captured`, 18);
    if (activity.lastNetworkRequestAt) {
      fmt.keyValue('  Last Request', formatTimeAgo(activity.lastNetworkRequestAt), 18);
    }
    fmt.keyValue('Console Messages', `${activity.consoleMessagesCaptured} captured`, 18);
    if (activity.lastConsoleMessageAt) {
      fmt.keyValue('  Last Message', formatTimeAgo(activity.lastConsoleMessageAt), 18);
    }
  }

  // Telemetry Section
  fmt.blank().text('Collectors').separator('━', 50);

  // Use activeTelemetry from metadata, fallback to all telemetry modules for backward compatibility
  const activeTelemetry = metadata.activeTelemetry ?? ['network', 'console', 'dom'];

  fmt.keyValueList(
    [
      ['Network', activeTelemetry.includes('network') ? 'Active' : 'Inactive'],
      ['Console', activeTelemetry.includes('console') ? 'Active' : 'Inactive'],
      ['DOM', activeTelemetry.includes('dom') ? 'Active' : 'Inactive'],
    ],
    18
  );

  // Add verbose Chrome diagnostics if requested
  if (verbose) {
    fmt.blank().text('Chrome Diagnostics').separator('━', 50);

    // Get diagnostics using shared utility (cached to avoid repeated scans)
    const diagnostics = getChromeDiagnostics();
    const diagnosticLines = formatDiagnosticsForStatus(diagnostics);
    diagnosticLines.forEach((line) => fmt.text(line));
  }

  fmt
    .blank()
    .section('Commands:', [
      'Stop session:    bdg stop',
      'Peek data:       bdg peek',
      'Query browser:   bdg query <script>',
    ]);

  return fmt.build();
}

/**
 * Convert status data to JSON format
 */
export function formatStatusAsJson(
  metadata: SessionMetadata | null,
  pid: number | null
): StatusData {
  if (!pid) {
    return { version: VERSION, active: false };
  }

  const isAlive = isProcessAlive(pid);

  if (!isAlive) {
    return { version: VERSION, active: false, stale: true, stalePid: pid };
  }

  if (!metadata) {
    return {
      version: VERSION,
      active: true,
      bdgPid: pid,
      warning: 'Metadata not found (session may be from older version)',
    };
  }

  // Calculate duration
  const now = Date.now();
  const durationMs = now - metadata.startTime;
  const durationSec = Math.floor(durationMs / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const durationFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Check if Chrome is alive
  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  return {
    version: VERSION,
    active: true,
    bdgPid: pid,
    chromePid: metadata.chromePid,
    chromeAlive,
    startTime: metadata.startTime,
    duration: durationMs,
    durationFormatted,
    port: metadata.port,
    targetId: metadata.targetId,
    webSocketDebuggerUrl: metadata.webSocketDebuggerUrl,
    // Use activeTelemetry from metadata, fallback to all telemetry types for backward compatibility
    telemetry: metadata.activeTelemetry ?? ['network', 'console', 'dom'],
  };
}

/**
 * Format "no session" message
 */
export function formatNoSessionMessage(): string {
  const fmt = new OutputFormatter();

  return fmt
    .text('No active session found')
    .blank()
    .section('Suggestions:', [
      'Start a new session:     bdg <url>',
      'List Chrome tabs:        bdg tabs',
    ])
    .build();
}
