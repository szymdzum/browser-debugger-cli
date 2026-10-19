/**
 * Session, daemon and command lifecycle error messages.
 */

import { getSessionName } from '@/session/paths.js';
import { escapeControlChars, formatDuration, joinLines } from '@/ui/formatting.js';
import {
  noActiveSessionMessage,
  sessionCommand,
  startSessionSuggestion,
} from '@/ui/messages/sessionCommand.js';
import { displayUrl } from '@/utils/displayUrl.js';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * Generate "session already running" error message (commands carry
 * `--session` for a named session).
 *
 * @param pid - Process ID of running session
 * @param duration - Session duration in milliseconds
 * @param targetUrl - Optional target URL to show
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * const message = sessionAlreadyRunningError(12345, 60000, 'http://localhost:3000');
 * console.error(message);
 * ```
 */
export function sessionAlreadyRunningError(
  pid: number,
  duration: number,
  targetUrl?: string
): string {
  return joinLines(
    '',
    `Error: ${sessionLabel()} already running`,
    '',
    `  PID:      ${pid}`,
    targetUrl && `  Target:   ${targetUrl}`,
    `  Duration: ${formatDuration(duration)}`,
    '',
    'Suggestions:',
    `  View session:     ${sessionCommand('bdg status')}`,
    `  Stop and restart: ${stopAndRestartCommand()}`,
    ''
  );
}

/**
 * The daemon's one-line answer to `bdg <url>` while its session runs.
 *
 * @param pid - Daemon PID
 * @returns Message
 */
export function sessionAlreadyRunningMessage(pid: number): string {
  return `${sessionLabel()} already running (PID ${pid}). Stop it first with: ${sessionCommand('bdg stop')}`;
}

/**
 * "Session" or `Session "<name>"` for the selected session.
 *
 * @returns Label
 */
function sessionLabel(): string {
  const name = getSessionName();
  return name === null ? 'Session' : `Session "${name}"`;
}

/**
 * Stop the selected session and start it again.
 *
 * @returns Command line
 */
function stopAndRestartCommand(): string {
  return `${sessionCommand('bdg stop')} && ${sessionCommand('bdg <url>')}`;
}

/**
 * What to do when `bdg <url>` finds the selected session already running.
 *
 * @returns Suggestion
 */
export function alreadyRunningSuggestion(): string {
  return `Use the running session (${sessionCommand('bdg status')}), or stop it first: ${stopAndRestartCommand()}`;
}

/**
 * Human-readable description of a bdg-launched Chrome (as opposed to one
 * reached via `--chrome-ws-url`). Used in mismatch errors where the active
 * session or the caller's intent is launched-mode.
 */
export const LAUNCHED_CHROME_DESCRIPTION = 'launched Chrome (bdg-managed)';

/**
 * Generate "session target mismatch" error message.
 *
 * Raised when a new start-session request names a different Chrome target
 * (or switches between launched and attached modes) while an active session
 * is healthy. Distinct from `sessionAlreadyRunningError` so agents can react
 * programmatically via exit code + IPC error code.
 *
 * @param currentTarget - Target URL / ws URL / description of the active session
 * @param requestedTarget - The ws URL / description of what the caller asked for
 * @returns Formatted error message
 */
export function sessionTargetMismatchError(
  currentTarget: string | undefined,
  requestedTarget: string | undefined
): string {
  return joinLines(
    '',
    'Error: Active session is attached to a different Chrome target',
    '',
    `  Current:   ${currentTarget ?? '(unknown)'}`,
    `  Requested: ${requestedTarget ?? '(unknown)'}`,
    '',
    `Run '${sessionCommand('bdg stop')}' before attaching to a different target.`,
    ''
  );
}

/**
 * Context for daemon error messages.
 */
export interface DaemonErrorContext {
  /** Whether stale PID file was cleaned up */
  staleCleanedUp?: boolean;
  /** Whether to suggest checking status (for commands that expect daemon) */
  suggestStatus?: boolean;
  /** Whether to suggest retrying (for transient errors) */
  suggestRetry?: boolean;
  /** Last error message if available */
  lastError?: string;
}

/**
 * The daemon accepted the connection but did not answer in time (frozen or
 * overloaded).
 *
 * @param seconds - How long the command waited
 * @returns Message and suggestion
 */
export function sessionNotRespondingError(seconds: number): ErrorWithSuggestion {
  return {
    message: `The session did not respond within ${seconds}s`,
    suggestion: `Retry in a moment; if it stays unresponsive, end it with: ${sessionCommand('bdg cleanup --force')} (stops the daemon and its Chrome)`,
  };
}

/**
 * BDG_IPC_TIMEOUT_MS is set to something that is not a usable timeout.
 *
 * @param value - The variable's value
 * @param max - Largest accepted value in milliseconds
 * @returns Message and suggestion
 */
export function invalidIpcTimeoutEnvError(value: string, max: number): ErrorWithSuggestion {
  return {
    message: `BDG_IPC_TIMEOUT_MS must be a whole number of milliseconds between 1 and ${max} (got "${escapeControlChars(value)}")`,
    suggestion: `Set BDG_IPC_TIMEOUT_MS to a whole number from 1 to ${max} (e.g. 60000), or unset it to use the default (45000)`,
  };
}

/**
 * An option that takes a value was followed directly by `--json` / `-j`.
 *
 * @param option - The option as typed (`--last`)
 * @param token - The flag that stands where its value should be
 * @param longForm - The option's long spelling, which accepts `=value` (a short flag does not)
 * @returns Message and suggestion
 */
export function jsonTakenAsValueError(
  option: string,
  token: string,
  longForm: string
): ErrorWithSuggestion {
  return {
    message: `Option ${option} needs a value, but ${token} follows it`,
    suggestion: `Give ${option} a value before ${token}, or write ${longForm}=${token} to use "${token}" as the value`,
  };
}

/**
 * `bdg --json` with no command and no URL (often `bdg $URL --json` with an
 * empty `$URL`).
 *
 * @returns Message and suggestion
 */
export function noCommandOrUrlError(): ErrorWithSuggestion {
  return {
    message: 'No command or URL given',
    suggestion:
      'Start a session with: bdg <url>, or run a command (bdg <command> --json); for the machine-readable help run: bdg --help --json',
  };
}

/**
 * The daemon cannot parse a request frame.
 *
 * @param reason - What is wrong with the frame
 * @returns Message
 */
export function malformedIpcFrameError(reason: string): string {
  return `The session could not read the request: ${reason}`;
}

/**
 * The running session does not know a request type: it was started by an
 * older bdg than the command that sent it.
 *
 * @param requestType - The unknown request type
 * @returns Message and suggestion
 */
export function unknownIpcRequestError(requestType: string): ErrorWithSuggestion {
  return {
    message: `The running session does not know the request ${escapeControlChars(requestType)} (a mistyped type, or a session started by an older bdg)`,
    suggestion: `Restart the session: ${sessionCommand('bdg stop')}, then ${sessionCommand('bdg <url>')}`,
  };
}

/**
 * The daemon answered, but the command did not finish in time (slow or
 * frozen page work).
 *
 * @param seconds - Timeout in seconds
 */
export function commandTimedOutError(seconds: number): ErrorWithSuggestion {
  return {
    message: `The command did not finish within ${seconds}s (the page may be busy or frozen)`,
    suggestion: `Check the session with: ${sessionCommand('bdg status')}; if the page stays frozen, end it with: ${sessionCommand('bdg cleanup --force')}`,
  };
}

/**
 * A screenshot interrupted by Ctrl-C or SIGTERM: the daemon skips the
 * capture if it has not started and puts the page's emulation back before
 * any later page command runs.
 *
 * @param signal - The signal that stopped it
 * @returns Message and suggestion
 */
export function screenshotInterruptedError(signal: 'SIGINT' | 'SIGTERM'): ErrorWithSuggestion {
  return {
    message: `Screenshot cancelled (${signal === 'SIGINT' ? 'interrupted' : 'terminated'})`,
    suggestion:
      "No file was written; run it again to capture (the next command sees the page's own emulation)",
  };
}

/**
 * What an interrupted command may already have done: sent an action to the
 * page (`sent`: what, e.g. `click`), run a script the daemon then stopped
 * on the page (`stopped`: `eval`), changed the session itself
 * (`session`: `stop` or `cleanup`), or a file it writes (`file`: what kind;
 * `writing`: its path once the write has started, absent before). A sent
 * call or stopped script that also writes a file (`bdg cdp --out`) carries
 * `writing` too: there it is the file the command may write, set whenever
 * `--out` is given, whether or not the write has started.
 */
export type InterruptedWork =
  | { sent: string; writing?: string | undefined }
  | { stopped: 'script'; writing?: string | undefined }
  | { session: 'stop' | 'cleanup' }
  | InterruptedFileWrite;

/** A file an interruptible command writes; `writing` is set as the write starts */
export interface InterruptedFileWrite {
  file: string;
  writing?: string | undefined;
}

/**
 * Any command interrupted by Ctrl-C or SIGTERM before it reported: says
 * what may already have happened.
 *
 * @param work - What the command may have done, when it changes something
 * @returns Message and suggestion
 */
export function commandInterruptedError(work?: InterruptedWork): ErrorWithSuggestion {
  return { message: 'Interrupted', suggestion: interruptedWorkText(work) };
}

/**
 * The suggestion of {@link commandInterruptedError}.
 *
 * @param work - What the command may have done
 * @returns Text
 */
function interruptedWorkText(work: InterruptedWork | undefined): string {
  if (!work) return 'The command stopped before it reported; run it again for its result';
  if ('sent' in work) {
    const reached = `The ${work.sent} may already have reached the page`;
    return work.writing
      ? `${reached}; the file ${work.writing} may or may not have been written, and a missing or partial file means the collection stopped early; check ${work.writing} and ${sessionCommand('bdg peek')} before repeating it, and start over if the call ended something that cannot be repeated (e.g. Tracing.end after Tracing.start)`
      : `${reached}; check with ${sessionCommand('bdg peek')} before repeating it`;
  }
  if ('stopped' in work) {
    const stopped = `The ${work.stopped} was stopped on the page if it was still running; changes it made before the stop may remain`;
    return work.writing
      ? `${stopped}; the file ${work.writing} may or may not have been written (a missing or partial file means the collection stopped early); check ${work.writing} and ${sessionCommand('bdg peek')} before repeating it`
      : `${stopped}; check with ${sessionCommand('bdg peek')} before repeating it`;
  }
  if ('session' in work) {
    const begun =
      work.session === 'stop'
        ? 'The stop request may already have been sent'
        : 'The cleanup may already have ended processes or removed files';
    return `${begun}; check with ${sessionCommand('bdg status')} before running it again`;
  }
  return work.writing
    ? `The ${work.file} may or may not have been written to ${work.writing}; check it, or run the command again`
    : `The ${work.file} was not written (an existing file is unchanged); run the command again`;
}

/**
 * The suggestion of a start cancelled by Ctrl-C or SIGTERM.
 *
 * @returns Suggestion
 */
export function startCancelledSuggestion(): string {
  return `Start again with: ${sessionCommand('bdg <url>')}`;
}

/**
 * The one line an interrupted command prints on stderr (text output).
 *
 * @param err - From {@link commandInterruptedError}
 * @returns Line
 */
export function commandInterruptedLine(err: ErrorWithSuggestion): string {
  return `${err.message}. ${err.suggestion}`;
}

/**
 * What to do when a command finds no session to work with.
 *
 * @param exitCode - 85 while a start is in progress, otherwise 83
 * @returns Suggestion
 */
export function sessionUnavailableSuggestion(exitCode: number): string {
  return exitCode === 85
    ? `Wait until "${sessionCommand('bdg <url>')}" returns, then retry`
    : startSessionSuggestion();
}

/**
 * Generate unified "daemon not running" error message with context.
 *
 * This replaces the three previous variants:
 * - daemonNotRunningError()
 * - daemonConnectionFailedError()
 * - daemonNotRunningWithCleanup()
 *
 * @param context - Optional context about the error
 * @returns Formatted error message with suggestions
 *
 * @example
 * ```typescript
 * // Basic usage
 * console.error(daemonNotRunningError());
 *
 * // With stale cleanup
 * console.error(daemonNotRunningError({ staleCleanedUp: true }));
 *
 * // With status suggestion
 * console.error(daemonNotRunningError({ suggestStatus: true }));
 * ```
 */
export function daemonNotRunningError(context?: DaemonErrorContext): string {
  return joinLines(
    `Error: ${noActiveSessionMessage()}`,
    context?.staleCleanedUp && '(Stale daemon files were cleaned up)',
    context?.lastError && `Last error: ${context.lastError}`,
    startSessionSuggestion(),
    context?.suggestStatus && '',
    context?.suggestStatus && 'Or check daemon status:',
    context?.suggestStatus && `  ${sessionCommand('bdg status')}`,
    context?.suggestRetry && '',
    context?.suggestRetry && 'Or try the command again if this was transient'
  );
}

/**
 * Generate generic error message with optional context.
 *
 * @param message - Error message
 * @param context - Optional additional context
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * console.error(genericError('Operation failed', 'Network timeout'));
 * ```
 */
export function genericError(message: string, context?: string): string {
  const text = message.startsWith('Error:') ? message : `Error: ${message}`;
  return escapeControlChars(context ? `${text}\n${context}` : text);
}

/**
 * Generate "unknown error" message.
 *
 * @returns Formatted error message
 */
export function unknownError(): string {
  return 'Error: Unknown error';
}

/**
 * Generate "invalid response" error message.
 *
 * @param reason - Reason for invalid response
 * @returns Formatted error message
 */
export function invalidResponseError(reason: string): string {
  return `[bdg] Invalid response from daemon: ${reason}`;
}

/**
 * A Chrome flag bdg cannot pass on.
 *
 * @param flag - The flag
 */
export function invalidChromeFlagError(flag: string): ErrorWithSuggestion {
  return flag.startsWith('--remote-debugging')
    ? {
        message: `${flag} cannot be passed in --chrome-flags: bdg sets the debugging port`,
        suggestion: 'Use --port <number> instead',
      }
    : {
        message: `--chrome-flags got "${flag}", which is a bdg option`,
        suggestion:
          'Give Chrome flags as one quoted value: --chrome-flags="--lang=pl --disable-gpu"',
      };
}

/**
 * A page command on a page whose renderer crashed.
 *
 * @param crashedAt - When it crashed (epoch ms)
 * @returns Message and the way back
 */
export function pageCrashedError(crashedAt: number): ErrorWithSuggestion {
  return {
    message: `The page crashed at ${new Date(crashedAt).toLocaleTimeString()} (its renderer is gone), so page commands cannot run`,
    suggestion: `Load it again with: ${sessionCommand('bdg page reload')} (or start a new session: ${sessionCommand('bdg <url>')})`,
  };
}

/**
 * The session (its browser or daemon) went away while a command was running.
 */
export function sessionEndedDuringCommandError(): ErrorWithSuggestion {
  return {
    message: 'The session ended while the command was running',
    suggestion: `Start a new session with: ${sessionCommand('bdg <url>')}`,
  };
}

/**
 * An option that only takes effect together with another one.
 *
 * @param option - Option given
 * @param required - Option it needs
 * @returns Message and suggestion
 */
export function optionRequiresError(option: string, required: string): ErrorWithSuggestion {
  return {
    message: `${option} only works with ${required}`,
    suggestion: `Add ${required}, or drop ${option}`,
  };
}

/**
 * `bdg page navigate javascript:…`: scripts run with eval.
 */
export function javascriptNavigationError(): ErrorWithSuggestion {
  return {
    message: 'page navigate opens pages; it does not run javascript: URLs',
    suggestion: `Run the script in the page instead: bdg eval '...'`,
  };
}

/**
 * A command typed as one quoted argument (`bdg "page info"`): the words, not
 * a URL with spaces, are the mistake.
 *
 * @param url - The quoted argument as typed
 * @param command - The command meant, words separated by single spaces
 */
export function spacedCommandError(url: string, command: string): ErrorWithSuggestion {
  return {
    message: `Invalid URL format: '${url}' (contains spaces)`,
    suggestion: `Did you mean: bdg ${command}?`,
  };
}

/** Network errors a wrong scheme can cause (an HTTPS server spoken to in HTTP, or the reverse) */
const SCHEME_MISMATCH_ERRORS =
  /ERR_CONNECTION_REFUSED|ERR_SSL_|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/;

/**
 * The browser could not load the start URL at all.
 *
 * @param url - URL that failed, shown as {@link displayUrl} shows it (#757)
 * @param errorText - Chrome network error (e.g. net::ERR_NAME_NOT_RESOLVED)
 * @param addedScheme - Whether bdg prepended `http://` to the URL as typed
 *   (the hint is shown for errors a wrong scheme can cause)
 * @param redirectedTo - Where a redirect led, when that request failed
 */
export function navigationFailedError(
  url: string,
  errorText: string,
  addedScheme = false,
  redirectedTo?: string
): ErrorWithSuggestion {
  const check = 'Check the URL and that the server is running and reachable from this machine';
  const shown = displayUrl(url);
  const redirect = redirectedTo ? ` (redirected to ${displayUrl(redirectedTo)})` : '';
  return {
    message: `Could not load ${shown}${redirect}: ${errorText}`,
    suggestion:
      addedScheme && SCHEME_MISMATCH_ERRORS.test(errorText)
        ? `bdg added http:// to what you typed. ${check}; for an HTTPS server use: bdg ${shown.replace(/^http:/, 'https:')}`
        : check,
  };
}

/**
 * `bdg page back/forward` at the end of the page's history.
 *
 * @param direction - back or forward
 */
export function noHistoryEntryError(direction: 'back' | 'forward'): ErrorWithSuggestion {
  return {
    message: `There is no page to go ${direction} to`,
    suggestion: 'Open a page with: bdg page navigate <url>',
  };
}

/**
 * Internal error (should not happen in normal usage).
 */
export function internalError(context: string): ErrorWithSuggestion {
  return {
    message: context,
    suggestion: 'This is an internal error - please report this issue',
  };
}

/**
 * The skill file is not where the package should have it (a broken or
 * partial install).
 *
 * @param source - Expected SKILL.md path
 * @returns Message and suggestion
 */
export function skillSourceMissingError(source: string): ErrorWithSuggestion {
  return {
    message: `The bdg skill is missing from the installed package (${source})`,
    suggestion: 'Reinstall bdg: npm install -g browser-debugger-cli',
  };
}

/**
 * The skill could not be written to an agent's skill directory.
 *
 * @param path - File that could not be written
 * @param reason - The file system error
 * @param pathIsFile - Whether a part of the path is a file (ENOTDIR, EEXIST)
 * @param otherTargetFlag - Flag installing for the other agent only, when both were picked
 * @returns Message and suggestion
 */
export function skillWriteFailedError(
  path: string,
  reason: string,
  pathIsFile: boolean,
  otherTargetFlag?: string
): ErrorWithSuggestion {
  const fix = pathIsFile
    ? 'A part of that path is a file, not a directory: move it away'
    : 'Check the permissions of that directory';
  return {
    message: `Could not write ${path}: ${reason}`,
    suggestion: otherTargetFlag
      ? `${fix}, or install for the other agent only (${otherTargetFlag})`
      : fix,
  };
}

/**
 * An old spelling that exits 81 since 1.0 (#465): renamed, or removed
 * without a replacement.
 *
 * @param oldSpelling - Old spelling (`bdg dom pressKey`, `bdg <url> --compact`)
 * @param instead - The new spelling (`bdg dom press-key`), or for a removal what to do instead
 */
export function retiredNameError(
  oldSpelling: string,
  instead: { newSpelling: string } | { hint: string }
): ErrorWithSuggestion {
  return 'newSpelling' in instead
    ? {
        message: `"${oldSpelling}" was renamed to "${instead.newSpelling}"`,
        suggestion: `Use "${instead.newSpelling}"`,
      }
    : { message: `"${oldSpelling}" was removed`, suggestion: instead.hint };
}

/**
 * Error for an option given under both its old and its new spelling.
 *
 * @param oldSpelling - Old spelling (`bdg <url> --timeout`)
 * @param newSpelling - New spelling (`bdg <url> --stop-after`)
 */
export function renamedOptionConflictError(
  oldSpelling: string,
  newSpelling: string
): ErrorWithSuggestion {
  return {
    message: `"${oldSpelling}" and "${newSpelling}" are the same option, given different values`,
    suggestion: `Give it once, as "${newSpelling}", or the same value to both`,
  };
}
