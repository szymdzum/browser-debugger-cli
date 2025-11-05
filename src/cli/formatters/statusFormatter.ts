import type { SessionActivity, PageState } from '@/ipc/types.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { isProcessAlive } from '@/session/process.js';
import { getChromeDiagnostics, formatDiagnosticsForStatus } from '@/utils/chromeDiagnostics.js';
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
  collectors?: string[];
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

  const lines: string[] = [];
  lines.push('Session Status');
  lines.push('━'.repeat(50));
  lines.push(`Status:           ACTIVE`);
  lines.push(`Duration:         ${durationFormatted}`);
  lines.push('');
  lines.push('Process Information');
  lines.push('━'.repeat(50));
  lines.push(`Daemon PID:       ${pid}`);

  if (metadata.chromePid) {
    lines.push(
      `Chrome PID:       ${metadata.chromePid} ${chromeAlive ? '(running)' : '(not running)'}`
    );
  }

  lines.push(`Port:             ${metadata.port}`);

  // Target Information (from live worker data)
  if (pageState) {
    lines.push('');
    lines.push('Target Information');
    lines.push('━'.repeat(50));
    lines.push(`URL:              ${pageState.url}`);
    if (pageState.title) {
      lines.push(`Title:            ${pageState.title}`);
    }
  }

  // Activity Section (from live worker data)
  if (activity) {
    lines.push('');
    lines.push('Activity');
    lines.push('━'.repeat(50));
    lines.push(`Network Requests: ${activity.networkRequestsCaptured} captured`);
    if (activity.lastNetworkRequestAt) {
      lines.push(`  Last Request:   ${formatTimeAgo(activity.lastNetworkRequestAt)}`);
    }
    lines.push(`Console Messages: ${activity.consoleMessagesCaptured} captured`);
    if (activity.lastConsoleMessageAt) {
      lines.push(`  Last Message:   ${formatTimeAgo(activity.lastConsoleMessageAt)}`);
    }
  }

  // Collectors Section
  lines.push('');
  lines.push('Collectors');
  lines.push('━'.repeat(50));

  // Use activeCollectors from metadata, fallback to all collectors for backward compatibility
  const activeCollectors = metadata.activeCollectors ?? ['network', 'console', 'dom'];

  lines.push(`Network:          ${activeCollectors.includes('network') ? 'Active' : 'Inactive'}`);
  lines.push(`Console:          ${activeCollectors.includes('console') ? 'Active' : 'Inactive'}`);
  lines.push(`DOM:              ${activeCollectors.includes('dom') ? 'Active' : 'Inactive'}`);

  // Add verbose Chrome diagnostics if requested
  if (verbose) {
    lines.push('');
    lines.push('Chrome Diagnostics');
    lines.push('━'.repeat(50));

    // Get diagnostics using shared utility (cached to avoid repeated scans)
    const diagnostics = getChromeDiagnostics();
    const diagnosticLines = formatDiagnosticsForStatus(diagnostics);
    lines.push(...diagnosticLines);
  }

  lines.push('');
  lines.push('Commands:');
  lines.push('  Stop session:    bdg stop');
  lines.push('  Peek data:       bdg peek');
  lines.push('  Query browser:   bdg query <script>');

  return lines.join('\n');
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
    // Use activeCollectors from metadata, fallback to all collectors for backward compatibility
    collectors: metadata.activeCollectors ?? ['network', 'console', 'dom'],
  };
}

/**
 * Format "no session" message
 */
export function formatNoSessionMessage(): string {
  return `No active session found

Suggestions:
  Start a new session:     bdg <url>
  List Chrome tabs:        bdg tabs`;
}
