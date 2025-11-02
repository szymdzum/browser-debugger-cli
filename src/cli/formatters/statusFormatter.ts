import { getChromeDiagnostics, formatDiagnosticsForStatus } from '@/utils/chromeDiagnostics.js';
import type { SessionMetadata } from '@/utils/session.js';
import { isProcessAlive } from '@/utils/session.js';

export interface StatusData {
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
}

/**
 * Format session status for human-readable output
 * @param metadata Session metadata
 * @param pid BDG process ID
 * @param verbose Show detailed Chrome diagnostics
 */
export function formatSessionStatus(
  metadata: SessionMetadata,
  pid: number,
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
  lines.push(`Status:           ACTIVE ✓`);
  lines.push(`BDG PID:          ${pid}`);

  if (metadata.chromePid) {
    lines.push(`Chrome PID:       ${metadata.chromePid} ${chromeAlive ? '✓' : '✗ (not running)'}`);
  }

  lines.push(`Duration:         ${durationFormatted}`);
  lines.push(`Port:             ${metadata.port}`);
  lines.push('');
  lines.push('Collectors');
  lines.push('━'.repeat(50));
  lines.push('Network:          ✓ Active');
  lines.push('Console:          ✓ Active');
  lines.push('DOM:              ✓ Active');

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
  lines.push('💡 Commands:');
  lines.push('  Stop session:    bdg stop');
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
    return { active: false };
  }

  const isAlive = isProcessAlive(pid);

  if (!isAlive) {
    return { active: false, stale: true, stalePid: pid };
  }

  if (!metadata) {
    return {
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
    collectors: ['network', 'console', 'dom'], // Default collectors
  };
}

/**
 * Format "no session" message
 */
export function formatNoSessionMessage(): string {
  return `No active session found

💡 Suggestions:
  Start a new session:     bdg <url>
  List Chrome tabs:        bdg tabs`;
}

/**
 * Format "stale session" message
 */
export function formatStaleSessionMessage(pid: number): string {
  return `Found stale session (PID ${pid} not running)

💡 Suggestions:
  Clean up:          bdg cleanup
  Start new session: bdg <url>`;
}

/**
 * Format "no metadata" message
 */
export function formatNoMetadataMessage(pid: number): string {
  return `Active session found (PID ${pid})
Warning: No metadata available
Session may have been started with an older version`;
}
