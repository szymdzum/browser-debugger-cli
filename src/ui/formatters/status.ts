import type { SessionActivity, PageState } from '@/ipc/index.js';
import { describeRunningChrome, type RunningChromeInfo } from '@/session/chrome.js';
import type { LastSessionEnd } from '@/session/lastSession.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { calculateDuration, formatTimeAgo } from '@/session/statusData.js';
import type { ColorScheme, ViewportSize } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { colorSchemeLabel, sessionActiveLine } from '@/ui/messages/commands.js';
import { lastSessionEndText } from '@/ui/messages/session.js';
import { noActiveSessionMessage, sessionCommand } from '@/ui/messages/sessionCommand.js';
import { isProcessAlive } from '@/utils/process.js';

export interface StatusData {
  /** Name of the selected session (named sessions only) */
  session?: string;
  active: boolean;
  bdgPid?: number;
  /** Chrome launched by bdg; null for an attached Chrome */
  chromePid?: number | null | undefined;
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
  /** Viewport given with `--viewport` (`pageState.viewport` is the current one) */
  viewport?: ViewportSize;
  /** Color scheme given with `--color-scheme` (`pageState.colorScheme` is the current one) */
  colorScheme?: ColorScheme;
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
 * @param sessionName - Name of a named session
 */
export function formatSessionStatus(
  metadata: SessionMetadata,
  pid: number,
  activity?: SessionActivity,
  pageState?: PageState,
  verbose = false,
  sessionName?: string
): string {
  const duration = calculateDuration(metadata.startTime);

  const chromeAlive = metadata.chromePid ? isProcessAlive(metadata.chromePid) : false;

  const fmt = new OutputFormatter();

  fmt.text(sessionActiveLine(pageState)).blank();
  fmt.text('Session Status').separator('━', 50);
  fmt.keyValueList(
    [
      ...(sessionName ? [['Session', sessionName] as [string, string]] : []),
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
    fmt.keyValueList(appearanceLines(metadata, pageState), 18);
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
      `Peek data:       ${sessionCommand('bdg peek', sessionName ?? null)}`,
      `Run JavaScript:  ${sessionCommand('bdg dom eval <script>', sessionName ?? null)}`,
      `End session:     ${sessionCommand('bdg stop', sessionName ?? null)}`,
    ]);

  return fmt.build();
}

/**
 * Viewport and color scheme lines of the target: what the page renders with,
 * and whether `--viewport` / `--color-scheme` set it or it is the system's.
 * The color scheme is the `prefers-color-scheme` the page sees, not its theme.
 *
 * @param metadata - Session metadata (the start options)
 * @param pageState - Page state (what the page reported)
 * @returns Key-value pairs (none for what is unknown)
 */
export function appearanceLines(
  metadata: Pick<SessionMetadata, 'viewport' | 'colorScheme'>,
  pageState: PageState
): Array<[string, string]> {
  const viewport = pageState.viewport ?? metadata.viewport;
  const scheme = pageState.colorScheme ?? metadata.colorScheme;
  return [
    ...(viewport
      ? [
          [
            'Viewport',
            `${viewport.width}×${viewport.height}${metadata.viewport ? ` (emulated ${metadata.viewport.width}x${metadata.viewport.height}${metadata.viewport.mobile ? ', phone' : ''})` : ''}`,
          ] as [string, string],
        ]
      : []),
    ...(scheme
      ? [
          ['Color scheme', colorSchemeLabel(scheme, metadata.colorScheme !== undefined)] as [
            string,
            string,
          ],
        ]
      : []),
  ];
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
    chromePid:
      metadata.chromePid !== undefined && metadata.chromePid > 0 ? metadata.chromePid : null,
    ...(metadata.chromePid ? { chromeAlive } : { externalChrome: true }),
    startTime: metadata.startTime,
    duration: duration.durationMs,
    durationFormatted: duration.formatted,
    port: metadata.port,
    ...(metadata.autoStopAt && { autoStopAt: new Date(metadata.autoStopAt).toISOString() }),
    ...(metadata.viewport && { viewport: metadata.viewport }),
    ...(metadata.colorScheme && { colorScheme: metadata.colorScheme }),
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
      .text(`Commands work once "${sessionCommand('bdg <url>', data.session ?? null)}" returns.`)
      .build();
  }
  if (data.ending) {
    return fmt.text('The session is ending (its Chrome is being closed)').build();
  }
  const session = data.session ?? null;
  fmt.text(noActiveSessionMessage(session));
  if (data.lastSession) fmt.text(lastSessionEndText(data.lastSession));
  if (data.orphanedChromePid) {
    fmt.text(`Chrome of an earlier session is still running (PID ${data.orphanedChromePid})`);
  }
  return fmt
    .hints('Suggestions:', [
      `Start a new session:     ${sessionCommand('bdg <url>', session)}`,
      data.orphanedChromePid
        ? `Close that Chrome:       ${sessionCommand('bdg cleanup', session)}`
        : `Clean up after a crash:  ${sessionCommand('bdg cleanup', session)}`,
    ])
    .build();
}
