import type { SessionActivity, PageState } from '@/ipc/index.js';
import { describeRunningChrome, type RunningChromeInfo } from '@/session/chrome.js';
import type { LastSessionEnd } from '@/session/lastSession.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { calculateDuration, formatTimeAgo } from '@/session/statusData.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { lastSessionEndText } from '@/ui/messages/session.js';
import { isProcessAlive } from '@/utils/process.js';

export interface StatusData {
  active: boolean;
  bdgPid?: number;
  chromePid?: number | undefined;
  chromeAlive?: boolean;
  /** Attached to a Chrome bdg did not launch (`--chrome-ws-url`); it has no known PID */
  externalChrome?: boolean;
  startTime?: number;
  duration?: number;
  durationFormatted?: string;
  port?: number;
  targetId?: string | undefined;
  webSocketDebuggerUrl?: string | undefined;
  telemetry?: string[];
  /** When `--timeout` stops the session (ISO time) */
  autoStopAt?: string;
  stale?: boolean;
  stalePid?: number;
  warning?: string;
  activity?: SessionActivity;
  pageState?: PageState;
  /** Set while `bdg <url>` is starting a session */
  starting?: { url: string; since: number };
  /** The session's Chrome (`--verbose`) */
  chrome?: RunningChromeInfo;
  /** The session is shutting down */
  ending?: boolean;
  /** How the last session ended, when not by `bdg stop` */
  lastSession?: LastSessionEnd;
  /** Chrome of an earlier session that is still running (no session owns it) */
  orphanedChromePid?: number;
}

/**
 * Format session status for human-readable output
 * @param metadata - Session metadata
 * @param pid - BDG process ID
 * @param activity - Live activity metrics from the session
 * @param pageState - Current page state from the session
 * @param verbose - Also show the session's Chrome executable, mode and profile
 */
export function formatSessionStatus(
  metadata: SessionMetadata,
  pid: number,
  activity?: SessionActivity,
  pageState?: PageState,
  verbose = false
): string {
  const duration = calculateDuration(metadata.startTime);

  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  const fmt = new OutputFormatter();

  fmt.text('Session Status').separator('━', 50);
  fmt.keyValueList(
    [
      ['Status', 'ACTIVE'],
      ['Duration', duration.formatted],
      ...(metadata.autoStopAt
        ? [['Auto-stop', new Date(metadata.autoStopAt).toLocaleTimeString()] as [string, string]]
        : []),
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
  } else {
    fmt.keyValue('Chrome', 'external (not launched by bdg)', 18);
  }

  fmt.keyValue('Port', metadata.port.toString(), 18);

  if (pageState) {
    fmt.blank().text('Target Information').separator('━', 50);
    fmt.keyValue('URL', pageState.url, 18);
    if (pageState.title) {
      fmt.keyValue('Title', pageState.title, 18);
    }
  }

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

  fmt.blank().text('Collectors').separator('━', 50);

  const activeTelemetry = metadata.activeTelemetry ?? ['network', 'console', 'dom'];

  fmt.keyValueList(
    [
      ['Network', activeTelemetry.includes('network') ? 'Active' : 'Inactive'],
      ['Console', activeTelemetry.includes('console') ? 'Active' : 'Inactive'],
      ['DOM', activeTelemetry.includes('dom') ? 'Active' : 'Inactive'],
    ],
    18
  );

  const chrome = verbose && metadata.chromePid ? describeRunningChrome(metadata.chromePid) : null;
  if (chrome) {
    fmt.blank().text('Chrome').separator('━', 50);
    fmt.keyValueList(
      [
        ['Executable', chrome.executable],
        ['Mode', chrome.headless ? 'headless' : 'with window'],
        ...(chrome.userDataDir ? [['Profile', chrome.userDataDir] as [string, string]] : []),
      ],
      18
    );
  }

  fmt
    .blank()
    .section('Commands:', [
      'Peek data:       bdg peek',
      'Run JavaScript:  bdg dom eval <script>',
      'End session:     bdg stop',
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

  const duration = calculateDuration(metadata.startTime);

  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  return {
    active: true,
    bdgPid: pid,
    chromePid: metadata.chromePid,
    ...(metadata.chromePid ? { chromeAlive } : { externalChrome: true }),
    startTime: metadata.startTime,
    duration: duration.durationMs,
    durationFormatted: duration.formatted,
    port: metadata.port,
    ...(metadata.autoStopAt && { autoStopAt: new Date(metadata.autoStopAt).toISOString() }),
    targetId: metadata.targetId,
    webSocketDebuggerUrl: metadata.webSocketDebuggerUrl,
    telemetry: metadata.activeTelemetry ?? ['network', 'console', 'dom'],
  };
}

/**
 * Format "no session" message
 */
export function formatNoSessionMessage(data: StatusData = { active: false }): string {
  const fmt = new OutputFormatter();
  if (data.starting) {
    const seconds = Math.round((Date.now() - data.starting.since) / 1000);
    return fmt
      .text(`Session starting: ${data.starting.url} (${seconds}s so far)`)
      .blank()
      .text('Commands work once "bdg <url>" returns.')
      .build();
  }
  if (data.ending) {
    return fmt.text('The session is ending (its Chrome is being closed)').build();
  }
  fmt.text('No active session found');
  if (data.lastSession) fmt.text(lastSessionEndText(data.lastSession));
  if (data.orphanedChromePid) {
    fmt.text(`Chrome of an earlier session is still running (PID ${data.orphanedChromePid})`);
  }
  return fmt
    .hints('Suggestions:', [
      'Start a new session:     bdg <url>',
      data.orphanedChromePid
        ? 'Close that Chrome:       bdg cleanup'
        : 'Clean up after a crash:  bdg cleanup',
    ])
    .build();
}
