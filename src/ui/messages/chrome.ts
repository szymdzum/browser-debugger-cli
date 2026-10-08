/**
 * Chrome-related user-facing messages.
 *
 * Centralized location for Chrome diagnostics, launch errors, and troubleshooting messages.
 */

import { getChromeDiagnostics, type ChromeDiagnostics } from '@/connection/diagnostics.js';
import type { IssueDetails } from '@/errors/issues.js';
import type { ChromeNoticeCode, NoticeDetails } from '@/errors/notices.js';
import { pluralize, joinLines } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Format a structured Chrome-related notice into a user-facing log line.
 *
 * Counterpart to {@link formatChromeIssue} for happy-path events. Wire a
 * NoticeSink that does `log.info(formatChromeNotice(notice))` at the
 * boundary so core modules stay free of UI imports.
 */
export function formatChromeNotice(notice: NoticeDetails<ChromeNoticeCode>): string {
  const ctx = notice.context ?? {};
  switch (notice.code) {
    case 'EXTERNAL_CHROME_CONNECTING':
      return chromeExternalConnectionMessage();
    case 'EXTERNAL_CHROME_WS_URL':
      return chromeExternalWebSocketMessage(ctx['wsUrl'] as string);
    case 'EXTERNAL_CHROME_NO_PID':
      return chromeExternalNoPidMessage();
    case 'EXTERNAL_CHROME_SKIP_TERMINATION':
      return chromeExternalSkipTerminationMessage();
  }
}

/**
 * Format a structured Chrome-related issue into a user-facing message.
 *
 * Called at the UI boundary when a ChromeLaunchError with `issue` details
 * reaches a CLI or daemon log sink. Core modules produce the IssueDetails;
 * this function is the only place wording is assembled.
 *
 * @param issue - Structured issue
 * @param diagnostics - Source of Chrome installation diagnostics (tests stub it)
 * @returns User-facing message
 */
export function formatChromeIssue(
  issue: IssueDetails,
  diagnostics: () => ChromeDiagnostics = getChromeDiagnostics
): string {
  const ctx = issue.context ?? {};
  switch (issue.code) {
    case 'PORT_IN_USE':
      return portInUseError(ctx['port'] as number, ctx['reason'] as string | undefined);
    case 'INVALID_PORT':
      return invalidPortError(ctx['port'] as number);
    case 'USER_DATA_DIR_CREATE_FAILED':
      return userDataDirError(ctx['userDataDir'] as string, (ctx['reason'] as string) ?? '');
    case 'CHROME_LAUNCH_FAILED':
    case 'CHROME_DIED_AFTER_LAUNCH': {
      const port = ctx['port'] as number;
      const reason = ctx['reason'] as string | undefined;
      const pid = typeof ctx['pid'] === 'number' ? ctx['pid'] : 'unknown';
      const header =
        issue.code === 'CHROME_DIED_AFTER_LAUNCH'
          ? `Chrome died immediately after launch (PID: ${pid})`
          : reason
            ? chromeLaunchFailedError(reason)
            : `Chrome failed to launch`;
      const found = diagnostics();
      const diagnosticLines = formatDiagnosticsForError(found);
      if (noChromeFound(found)) return joinLines(header, '', ...diagnosticLines);
      return joinLines(
        header,
        '',
        'Possible causes:',
        `  - Port ${port} conflict (check: lsof -ti:${port})`,
        `  - Chrome binary not found`,
        `  - Insufficient permissions`,
        `  - Chrome crashed on startup`,
        '',
        ...diagnosticLines,
        '',
        'Try:',
        `  - ${sessionCommand('bdg cleanup')}`,
        `  - See what uses the port: lsof -i :${port}`,
        `  - Use different port: ${sessionCommand(`bdg <url> --port ${port + 1}`)}`,
        `  - In a container where Chrome's sandbox fails: BDG_NO_SANDBOX=1 ${sessionCommand('bdg <url>')}`
      );
    }
    case 'CHROME_EXITED_DURING_STARTUP':
      return chromeExitedDuringStartupError(
        ctx['exitCode'] as number | null,
        (ctx['output'] as string[] | undefined) ?? [],
        ctx['userDataDir'] as string,
        ctx['profileInUse'] === true
      );
    case 'NO_PAGE_TARGET_FOUND':
      return noPageTargetFoundError(
        ctx['port'] as number,
        ctx['availableTargets'] as string | null
      );
    case 'CHROME_BINARY_NOT_FOUND': {
      return joinLines(
        chromeBinaryOverrideNotFound(ctx['chromePath'] as string, ctx['source'] as string),
        '',
        ...formatDiagnosticsForError(diagnostics(), { suggestChromePath: false })
      );
    }
    case 'CHROME_BINARY_IS_DIRECTORY':
      return chromeBinaryOverrideIsDirectory(ctx['chromePath'] as string, ctx['source'] as string);
    case 'CHROME_BINARY_NOT_EXECUTABLE': {
      const reason = ctx['reason'] as string | undefined;
      const base = chromeBinaryOverrideNotExecutable(
        ctx['chromePath'] as string,
        ctx['source'] as string
      );
      return reason ? `${base}\n\n${reason}` : base;
    }
    case 'PREFS_FILE_NOT_FOUND':
      return prefsFileNotFoundError(ctx['file'] as string);
    case 'PREFS_INVALID_FORMAT':
      return invalidPrefsFormatError(ctx['file'] as string, ctx['actualType'] as string);
    case 'PREFS_LOAD_FAILED':
      return prefsLoadError(ctx['file'] as string, (ctx['reason'] as string) ?? '');
    case 'PREFS_NOT_JSON_SERIALIZABLE':
      return `Chrome preferences must be JSON-serializable: ${(ctx['reason'] as string) ?? 'unknown error'}`;
  }
}

/** Chrome's launch ended because the session was stopped meanwhile */
export const CHROME_LAUNCH_ABORTED_MESSAGE = 'Chrome launch aborted: the session was stopped';

/**
 * Chrome exited before its debugging port opened.
 *
 * @param exitCode - Chrome's exit code
 * @param output - Chrome's last output lines
 * @param userDataDir - Chrome profile directory
 * @param profileInUse - Whether another Chrome has the profile open
 * @returns Message; its first line is the error, the rest the suggestion
 */
export function chromeExitedDuringStartupError(
  exitCode: number | null,
  output: string[],
  userDataDir: string,
  profileInUse: boolean
): string {
  if (profileInUse) {
    return joinLines(
      `The Chrome profile ${userDataDir} is in use by another Chrome`,
      `Close that Chrome, or use another profile directory: ${sessionCommand('bdg <url> -u ./other-profile')}`
    );
  }
  return joinLines(
    `Chrome exited during startup (exit code ${exitCode ?? 'none'})`,
    ...(output.length > 0 ? ['Chrome said:', ...output.map((line) => `  ${line}`)] : []),
    'Check --chrome-flags and BDG_CHROME_FLAGS (an unknown flag or value can stop Chrome)'
  );
}

/**
 * Whether no Chrome was found at all: no installation and no default binary
 * (chrome-launcher's default honors a valid CHROME_PATH).
 *
 * @param diagnostics - Chrome diagnostics
 * @returns True when there is nothing to launch
 */
function noChromeFound(diagnostics: ChromeDiagnostics): boolean {
  return diagnostics.installationCount === 0 && !diagnostics.defaultPath;
}

/**
 * A Chromium-based browser binary that chrome-launcher does not find on its
 * own, as an example value for CHROME_PATH.
 *
 * @param platform - OS the path is for
 * @returns Microsoft Edge's binary on macOS or Linux; none on other systems
 */
function exampleChromePath(platform: NodeJS.Platform): string | undefined {
  if (platform === 'darwin')
    return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  if (platform === 'linux') return '/usr/bin/microsoft-edge';
  return undefined;
}

/**
 * How to point bdg at another Chromium-based browser through CHROME_PATH.
 *
 * @param platform - OS the example is for
 * @returns Message lines, with an example command where one is known
 */
function chromePathSuggestion(platform: NodeJS.Platform): string[] {
  const example = exampleChromePath(platform);
  if (!example) return ['Set CHROME_PATH to a Chromium-based browser (Edge, Brave, Chromium)\n'];
  return [
    'Set CHROME_PATH to a Chromium-based browser (Edge, Brave, Chromium), e.g.:',
    `   CHROME_PATH="${example}" ${sessionCommand('bdg <url>')}\n`,
  ];
}

/**
 * Options of {@link formatDiagnosticsForError}.
 */
export interface DiagnosticsFormatOptions {
  /** OS the CHROME_PATH example is for (default: this one) */
  platform?: NodeJS.Platform;
  /** Suggest CHROME_PATH when no Chrome is found (off when CHROME_PATH is the problem) */
  suggestChromePath?: boolean;
}

/**
 * Format Chrome diagnostics for error reporting when Chrome launch fails.
 *
 * @param diagnostics - Chrome diagnostics information
 * @param options - Platform of the example and whether to suggest CHROME_PATH
 * @returns Formatted error message lines with troubleshooting steps
 *
 * @example
 * ```typescript
 * const diagnostics = getChromeDiagnostics();
 * const errorLines = formatDiagnosticsForError(diagnostics);
 * console.error(errorLines.join('\n'));
 * ```
 */
export function formatDiagnosticsForError(
  diagnostics: ChromeDiagnostics,
  { platform = process.platform, suggestChromePath = true }: DiagnosticsFormatOptions = {}
): string[] {
  const lines: string[] = [];

  if (noChromeFound(diagnostics)) {
    lines.push('Error: No Chrome installations detected\n');
    if (suggestChromePath) lines.push(...chromePathSuggestion(platform));
    lines.push(suggestChromePath ? 'Or install Chrome from:' : 'Install Chrome from:');
    lines.push('   https://www.google.com/chrome/\n');
  } else {
    lines.push(`Found ${pluralize(diagnostics.installationCount, 'Chrome installation')}:\n`);
    diagnostics.installations.forEach((path, index) => {
      lines.push(`  ${index + 1}. ${path}`);
    });
    lines.push('');

    if (diagnostics.defaultPath) {
      lines.push(`Default binary: ${diagnostics.defaultPath}\n`);
    } else {
      lines.push('Default binary: Could not determine\n');
    }
  }

  return lines;
}

/**
 * Generate invalid port error message.
 *
 * @param port - Invalid port number
 * @returns Formatted error message
 */
export function invalidPortError(port: number): string {
  return `Invalid port number: ${port}. Port must be between 1 and 65535.`;
}

/**
 * Generate user data directory creation error.
 *
 * @param dir - Directory path that failed
 * @param error - Error message
 * @returns Formatted error message
 */
export function userDataDirError(dir: string, error: string): string {
  return `Failed to create user data directory at ${dir}: ${error}`;
}

/**
 * Generate external Chrome connection message.
 *
 * @returns Formatted message
 */
export function chromeExternalConnectionMessage(): string {
  return 'Connecting to existing Chrome instance...';
}

/**
 * Generate external Chrome WebSocket URL message.
 *
 * @param wsUrl - WebSocket URL
 * @returns Formatted message
 */
export function chromeExternalWebSocketMessage(wsUrl: string): string {
  return `WebSocket URL: ${wsUrl}`;
}

/**
 * Generate external Chrome no PID message.
 *
 * @returns Formatted message
 */
export function chromeExternalNoPidMessage(): string {
  return 'Using external Chrome (no PID - not managed by bdg)';
}

/**
 * Generate external Chrome skip termination message.
 *
 * @returns Formatted message
 */
export function chromeExternalSkipTerminationMessage(): string {
  return 'Using external Chrome - skipping termination (not managed by bdg)';
}

/**
 * Generate error message when no page target is found after Chrome launch.
 *
 * @param port - CDP port number
 * @param availableTargets - Formatted list of available targets (or null if none)
 * @returns Formatted error message with diagnostics and troubleshooting steps
 */
export function noPageTargetFoundError(port: number, availableTargets: string | null): string {
  return joinLines(
    `Chrome started but opened no page to attach to (port ${port})`,
    `Retry: ${sessionCommand('bdg <url>')}. If it keeps failing, another program may use the port (lsof -i :` +
      `${port}) or a crashed session may be left over: ${sessionCommand('bdg cleanup')} && ${sessionCommand('bdg <url>')}`,
    ...(availableTargets ? ['', `Chrome targets:\n${availableTargets}`] : [])
  );
}

/**
 * Generate preferences file not found error.
 *
 * @param file - Preferences file path
 * @returns Formatted error message
 */
export function prefsFileNotFoundError(file: string): string {
  return `Chrome preferences file not found: ${file}`;
}

/**
 * Generate invalid preferences format error.
 *
 * @param file - Preferences file path
 * @param type - Actual type found
 * @returns Formatted error message
 */
export function invalidPrefsFormatError(file: string, type: string): string {
  return `Invalid Chrome preferences format in ${file}: expected object, got ${type}`;
}

/**
 * Generate preferences load error.
 *
 * @param file - Preferences file path
 * @param error - Error message
 * @returns Formatted error message
 */
export function prefsLoadError(file: string, error: string): string {
  return `Failed to load Chrome preferences from ${file}: ${error}`;
}

/**
 * Generate generic Chrome launch error.
 *
 * @param error - Error message
 * @returns Formatted error message
 */
export function chromeLaunchFailedError(error: string): string {
  return `Failed to launch Chrome: ${error}`;
}

/**
 * Generate error for invalid Chrome binary override path.
 *
 * @param path - Path that was provided via env/option
 * @param source - Human-readable source label (e.g. CHROME_PATH)
 * @returns Formatted error message
 */
export function chromeBinaryOverrideNotFound(path: string, source: string): string {
  return `Chrome binary override (${source}) points to "${path}", but that file does not exist.`;
}

/**
 * Generate error when Chrome binary override is not executable.
 *
 * @param path - Provided Chrome binary path
 * @param source - Human-readable source label (e.g. CHROME_PATH)
 * @returns Formatted error message with remediation guidance
 */
export function chromeBinaryOverrideNotExecutable(path: string, source: string): string {
  return (
    `Chrome binary override (${source}) points to "${path}", but it is not an executable file.\n` +
    'Update the path to the Chrome binary (e.g. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome) or unset the override to let bdg auto-detect Chrome.'
  );
}

/**
 * Generate error when Chrome binary override points to a directory.
 *
 * @param path - Provided Chrome binary path
 * @param source - Human-readable source label (e.g. CHROME_PATH)
 * @returns Formatted error message
 */
export function chromeBinaryOverrideIsDirectory(path: string, source: string): string {
  return `Chrome binary override (${source}) points to "${path}", which is a directory, not an executable file.`;
}

/**
 * Generate error when CDP port is already in use.
 *
 * @param port - Port number that is in use
 * @param reason - What was found on the port, when known
 * @returns Multi-line formatted error message with troubleshooting steps
 */
export function portInUseError(port: number, reason?: string): string {
  return joinLines(
    reason ? `Port ${port} is already in use: ${reason}.\n` : `Port ${port} is already in use.\n`,
    'Another program (or a Chrome left from a previous session) is listening on it.\n',
    'Try:',
    `  - Use a different port: ${sessionCommand(`bdg <url> --port ${port + 1}`)}`,
    `  - If a bdg session holds it: find it with bdg sessions, then end that one: bdg stop --session <name> (bdg cleanup --force --session <name> if it is stuck)`,
    `  - See what uses the port: lsof -i :${port}`
  );
}

/**
 * Why a launched Chrome is not the one answering on 127.0.0.1:<port>.
 *
 * @param answeredBy - What answers there: a different browser, another
 *   process, or nothing (the address is held but does not answer)
 * @param chromeHost - Address the launched Chrome listens on
 * @returns Reason for the PORT_IN_USE issue
 */
export function portTakenByReason(
  answeredBy: 'browser' | 'process' | 'nothing',
  chromeHost: string
): string {
  if (answeredBy === 'nothing')
    return `something holds 127.0.0.1 (Chrome fell back to ${chromeHost})`;
  const other = answeredBy === 'browser' ? 'another browser' : 'another process';
  return `${other} answers on 127.0.0.1 (Chrome listens on ${chromeHost})`;
}

/**
 * Why a launch failed when Chrome announced its port but did not answer on
 * it in time (a slow start, not a port conflict).
 *
 * @param port - Port Chrome announced
 * @param waitedMs - How long bdg waited
 * @returns Reason for the CHROME_LAUNCH_FAILED issue
 */
export function chromeNotAnsweringReason(port: number, waitedMs: number): string {
  return `Chrome announced port ${port} but did not answer on 127.0.0.1 within ${(waitedMs / 1000).toFixed(1)}s (slow start)`;
}

/**
 * Warning when bdg's Chrome preferences (password manager and leak check
 * off, etc.) could not be written into the profile.
 *
 * @param file - Preferences file
 * @param reason - Why
 * @returns Message
 */
export function chromePrefsNotAppliedMessage(file: string, reason: string): string {
  return `Warning: Chrome preferences not applied to ${file} (${reason}); password manager bubbles may capture clicks`;
}
