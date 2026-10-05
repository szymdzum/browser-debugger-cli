/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

import * as path from 'path';

import type { DomFrame, PendingRequestInfo } from '@/ipc/protocol/commands.js';
import {
  countedMatches,
  type WaitCondition,
  type WaitSnapshot,
} from '@/runtime/dom/waitCondition.js';
import { getSessionBaseDir, getSessionName } from '@/session/paths.js';
import type { DocumentRequestState, IndexSource } from '@/types.js';
import { escapeControlChars, formatDuration, joinLines } from '@/ui/formatting.js';
import {
  documentRequestText,
  frameLabel,
  frameUrlLabel,
  pendingRequestsText,
  waitSnapshotSummary,
  waitTargetLabel,
} from '@/ui/messages/commands.js';
import {
  noActiveSessionMessage,
  sessionCommand,
  startSessionSuggestion,
} from '@/ui/messages/sessionCommand.js';
import {
  detectSelectorQuoteDamage,
  detectScriptQuoteDamage,
  hasAttributeSelector,
} from '@/utils/shellDetection.js';

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
 * Generate element not found error with shell quote detection and CDP fallback.
 *
 * Provides guidance for when high-level DOM commands fail to find elements.
 * Detects shell quote damage for attribute selectors and provides specific
 * recovery suggestions including the two-step query-then-inspect pattern.
 *
 * @param selector - CSS selector that failed (as received by the command)
 * @returns Message and context-aware suggestion
 *
 * @example
 * ```typescript
 * // Simple selector - standard suggestions
 * elementNotFoundError('#missing-element')
 *
 * // Attribute selector with shell damage detected
 * elementNotFoundError('[data-test-id=value]')
 * // Suggestion: "Shell quote handling detected: ..."
 * ```
 */
export function elementNotFoundError(selector: string): ErrorWithSuggestion {
  const message = `Element not found: ${selector}`;
  const discovery = [
    'Discovery path:',
    `  1. Query first:  ${sessionCommand(`bdg dom query '${selector}'`)}`,
    `  2. Then inspect: ${sessionCommand('bdg dom a11y describe 0')}`,
  ];
  const quoteCheck = detectSelectorQuoteDamage(selector);
  if (quoteCheck.damaged) {
    return {
      message,
      suggestion: joinLines(
        'Shell quote handling detected: the selector arrived without its quotes.',
        quoteCheck.details && `  ${quoteCheck.details}`,
        ...discovery
      ),
    };
  }
  if (hasAttributeSelector(selector)) {
    return {
      message,
      suggestion: joinLines(
        'Attribute selector: check that the shell kept its quotes.',
        ...discovery,
        'Or see the page structure: bdg dom a11y tree'
      ),
    };
  }
  return {
    message,
    suggestion: joinLines(
      `Check the selector syntax, or wait for the element to load (${sessionCommand('bdg peek')} shows the page state)`,
      unreachableElementsNote(selector)
    ),
  };
}

/**
 * Error with suggestion pair for CommandError usage.
 */
export interface ErrorWithSuggestion {
  message: string;
  suggestion: string;
}

/**
 * Index out of range error.
 */
export function indexOutOfRangeError(index: number, max: number): ErrorWithSuggestion {
  return {
    message: `Index ${index} out of range (found ${max + 1} nodes)`,
    suggestion: `Use an index between 0 and ${max}`,
  };
}

/** Finding elements by accessible name, quoted for the shell (the name may contain spaces and colons). */
export const A11Y_NAME_QUERY_EXAMPLE = "bdg dom a11y query 'name=…'";

/** Where text filters can go, for selector errors. */
const SCOPED_FILTER_EXAMPLES =
  'Put the filter on the element it tests, e.g. li:has-text("Buy milk") .toggle (the .toggle in that row) or label:has-text("Name") input, or test what an element contains with :has(), e.g. li:has(label:text-is("Buy milk"))';

/** Playwright selector syntax bdg does not support (`:text()`, `>>` chains, `text=` engines, layout pseudo-classes). */
const PLAYWRIGHT_ONLY_SYNTAX =
  /:(?:text|text-matches|nth-match|left-of|right-of|above|below|near)\(|>>|^\s*(?:text|css|xpath|role|id|data-testid|internal:\w+)=/i;

/**
 * Empty (or blank) selector: the browser rejects it, so it is caught before
 * any page script runs.
 *
 * @returns Message and suggestion
 */
export function emptySelectorError(): ErrorWithSuggestion {
  return {
    message: 'Invalid CSS selector: The provided selector is empty',
    suggestion: 'Pass a selector, e.g. bdg dom query "button.primary"',
  };
}

/**
 * CSS selector rejected by the browser. Playwright-only syntax (`:text()`,
 * `>>`, `text=`) gets the filters bdg supports instead.
 *
 * @param selector - Selector as given
 * @param detail - Browser error, if any
 * @returns Message and suggestion
 */
export function invalidSelectorError(selector: string, detail?: string): ErrorWithSuggestion {
  return {
    message: `Invalid CSS selector: ${selector}${detail ? ` (${detail})` : ''}`,
    suggestion: PLAYWRIGHT_ONLY_SYNTAX.test(selector)
      ? `Playwright-only syntax is not CSS. bdg supports :has-text("…"), :text-is("…") and :visible, e.g. button:has-text("Save"), or scoped to a row or label: li:has-text("Buy milk") .toggle; or find elements by accessible name: ${A11Y_NAME_QUERY_EXAMPLE}`
      : 'Check the selector syntax, e.g. bdg dom query "button.primary"',
  };
}

/**
 * A text or visibility filter (`:has-text()`, `:text-is()`, `:visible`)
 * inside a pseudo-class other than `:has()`, e.g. `:not(:visible)`.
 *
 * @param selector - Selector as given
 * @param filter - The misplaced filter as written
 * @returns Message and suggestion
 */
export function misplacedSelectorFilterError(
  selector: string,
  filter: string
): ErrorWithSuggestion {
  return {
    message: `${filter} can only be used on an element of the selector or inside :has(), not inside other pseudo-classes: ${selector}`,
    suggestion: `${SCOPED_FILTER_EXAMPLES}; or find elements by accessible name: ${A11Y_NAME_QUERY_EXAMPLE}`,
  };
}

/**
 * A sibling combinator (`+`, `~`) after a filtered compound: the rest of the
 * selector is matched under the filtered element, so only descendant and
 * child combinators can follow it.
 *
 * @param selector - Selector as given
 * @param combinator - The combinator found
 * @returns Message and suggestion
 */
export function siblingAfterFilterError(selector: string, combinator: string): ErrorWithSuggestion {
  return {
    message: `Only a descendant (space) or child (>) combinator can follow a text or visibility filter, not "${combinator}": ${selector}`,
    suggestion: `Put the filter on the element to match, e.g. h2 + p:has-text("x"), or scope by a common ancestor: section:has-text("x") p`,
  };
}

/**
 * A `:has()` with filters whose selector starts with a sibling combinator
 * (`:has(+ a:visible)`): its matches are searched under the element, where
 * siblings are not.
 *
 * @param selector - Selector as given
 * @param combinator - `+` or `~`
 * @returns Message and suggestion
 */
export function siblingInHasError(selector: string, combinator: string): ErrorWithSuggestion {
  return {
    message: `:has() with text or visibility filters can only look inside an element, not at its siblings ("${combinator}"): ${selector}`,
    suggestion:
      'Use a descendant or child: li:has(a:visible), li:has(> a:visible); for a sibling, put the filter on it: li + a:visible',
  };
}

/** How a selector with filters is malformed (before the browser sees it). */
const MALFORMED_SELECTOR_DETAILS = {
  'empty-in-list': () => 'a selector in the list is empty',
  'leading-combinator': (combinator: string) => `it starts with the combinator "${combinator}"`,
  'trailing-combinator': () => 'it ends with a combinator',
  'empty-has': () => ':has() has an empty selector',
  'scope-in-has': () =>
    ':has() with filters is already relative to the element; write :has(> a:visible) instead of :has(:scope > a:visible)',
} as const;

/**
 * A selector with filters that is malformed in a way bdg detects while
 * splitting it (so the error shows the selector as given, not rewritten CSS).
 *
 * @param selector - Selector as given
 * @param problem - What is wrong
 * @param combinator - The combinator, for `leading-combinator`
 * @returns Message and suggestion
 */
export function malformedSelectorError(
  selector: string,
  problem: keyof typeof MALFORMED_SELECTOR_DETAILS,
  combinator = ''
): ErrorWithSuggestion {
  return invalidSelectorError(selector, MALFORMED_SELECTOR_DETAILS[problem](combinator));
}

/**
 * `:has-text()` with empty text, which every element would match.
 *
 * @param selector - Selector as given
 * @returns Message and suggestion
 */
export function emptyTextFilterError(selector: string): ErrorWithSuggestion {
  return {
    message: `:has-text() needs the text to look for (empty text matches every element): ${selector}`,
    suggestion:
      'Give the text, e.g. button:has-text("Save"); use :text-is("") for elements without text',
  };
}

/**
 * A text filter without its text, e.g. `:has-text` or `:text-is("x"`.
 *
 * @param selector - Selector as given
 * @param filter - Filter name, e.g. ":has-text"
 * @returns Message and suggestion
 */
export function invalidSelectorFilterError(selector: string, filter: string): ErrorWithSuggestion {
  return {
    message: `${filter} needs its text in closed parentheses: ${selector}`,
    suggestion: `Quote the text, e.g. button${filter}("Save"); escape quotes inside it with a backslash`,
  };
}

/**
 * `bdg help <topic>` for a command that does not exist.
 *
 * @param topic - Command path as typed, e.g. "dom quer"
 * @param closest - Most similar existing command path, if any
 */
export function unknownHelpTopicError(topic: string, closest?: string): ErrorWithSuggestion {
  const parent = topic.split(' ').slice(0, -1).join(' ');
  return {
    message: `Unknown command: "${topic}"`,
    suggestion: closest
      ? `Did you mean: bdg help ${closest}?`
      : `Run "bdg ${parent ? `${parent} ` : ''}--help" for commands`,
  };
}

/**
 * Chrome rejected a CDP method or its parameters.
 *
 * @param detail - Chrome's error message
 */
export function cdpRequestRejectedError(detail: string): ErrorWithSuggestion {
  return {
    message: detail,
    suggestion: 'Check the method and its parameters: bdg cdp <Method> --describe',
  };
}

/**
 * A file the user asked for (screenshot, HAR) cannot be written.
 *
 * @param filePath - Path as given
 * @param reason - What is wrong with it
 * @param extension - Extension of the file kind, for the example (default .png)
 */
export function outputFileError(
  filePath: string,
  reason: string,
  extension = '.png'
): ErrorWithSuggestion {
  const example = `output${path.extname(filePath) || extension}`;
  return {
    message: `Cannot write ${filePath}: ${reason}`,
    suggestion: `Choose a writable file path, e.g. ./${example} or /tmp/${example}`,
  };
}

/**
 * An empty output path.
 *
 * @param extension - Extension of the file kind, for the example
 */
export function emptyOutputPathError(extension = '.png'): ErrorWithSuggestion {
  return {
    message: 'The output path is empty',
    suggestion: `Give a file name, e.g. output${extension}`,
  };
}

/**
 * Start options given without the URL to open.
 */
export function missingStartUrlError(): ErrorWithSuggestion {
  return {
    message: 'Missing URL to open',
    suggestion: 'Put the URL first, e.g. bdg localhost:3000 --port 9333',
  };
}

/**
 * `--viewport` given something that is not a width and height.
 *
 * @param value - What was given
 * @param max - Largest side accepted
 */
export function invalidViewportError(value: string, max: number): ErrorWithSuggestion {
  return {
    message: `Invalid --viewport: "${value}"`,
    suggestion: `Give width x height in CSS px (1-${max} each), e.g. --viewport 1280x800`,
  };
}

/**
 * `--color-scheme` given another value than the ones it takes.
 *
 * @param value - What was given
 * @param similar - Close matches
 * @param schemes - Accepted values
 */
export function invalidColorSchemeError(
  value: string,
  similar: string[],
  schemes: readonly string[]
): ErrorWithSuggestion {
  return {
    message: `Unknown --color-scheme: "${value}"`,
    suggestion: similar[0] ? `Did you mean: ${similar[0]}?` : `Available: ${schemes.join(', ')}`,
  };
}

/**
 * `-u` / `--user-data-dir` given something that is not a directory path.
 *
 * @param value - What was given
 * @param reason - Why it cannot be used
 */
export function invalidUserDataDirError(value: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Invalid --user-data-dir "${value}": ${reason}`,
    suggestion:
      'Give a directory for the Chrome profile, e.g. -u ./profile (it is created if missing)',
  };
}

/**
 * A `--session` / `BDG_SESSION` name bdg cannot use as a directory name.
 *
 * @param name - The rejected name
 * @param maxLength - Longest allowed name
 */
export function invalidSessionNameError(name: string, maxLength: number): ErrorWithSuggestion {
  return {
    message: `Invalid session name "${name}"`,
    suggestion: `Use 1-${maxLength} letters, digits, "-" or "_", starting with a letter or digit, e.g. --session agent-1`,
  };
}

/**
 * A session name whose daemon socket path would exceed the OS limit.
 *
 * @param name - Session name
 * @param socketPath - Resulting socket path
 * @param max - Longest socket path in bytes
 */
export function sessionNameSocketTooLongError(
  name: string,
  socketPath: string,
  max: number
): ErrorWithSuggestion {
  return {
    message: `Session name "${name}" makes the daemon socket path too long (${Buffer.byteLength(socketPath)} bytes, at most ${max}): ${socketPath}`,
    suggestion: 'Use a shorter session name, or a shorter BDG_SESSION_DIR (e.g. /tmp/bdg)',
  };
}

/**
 * `bdg cleanup --purge` without a named session (the default session's
 * directory holds the named sessions).
 */
export function purgeNeedsNamedSessionError(): ErrorWithSuggestion {
  return {
    message: "--purge deletes a named session's directory and needs --session <name>",
    suggestion: 'Name the session: bdg cleanup --session <name> --purge (see bdg sessions)',
  };
}

/**
 * `bdg cleanup --purge` found the session still holding its directory after
 * cleaning up, so the directory is kept.
 *
 * @param dir - Session directory
 * @param reason - What still holds it
 */
export function purgeRefusedError(dir: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Not deleting ${dir}: ${reason}`,
    suggestion: `End the session first (${sessionCommand('bdg cleanup --force')}), then retry: ${sessionCommand('bdg cleanup --purge')}`,
  };
}

/** Fix for an unusable session directory */
const SESSION_DIR_SUGGESTION =
  'Set BDG_SESSION_DIR to a short, writable directory, e.g. BDG_SESSION_DIR=/tmp/bdg';

/**
 * The session directory exists but is not a directory.
 *
 * @param dir - Session directory
 */
export function sessionDirIsFileError(dir: string): ErrorWithSuggestion {
  return { message: `Session directory ${dir} is a file`, suggestion: SESSION_DIR_SUGGESTION };
}

/**
 * The session directory cannot be created or written.
 *
 * @param dir - Session directory
 * @param reason - File-system error
 */
export function sessionDirNotWritableError(dir: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Session directory ${dir} is not writable (${reason})`,
    suggestion: SESSION_DIR_SUGGESTION,
  };
}

/**
 * The daemon socket path exceeds the OS limit for Unix sockets.
 *
 * @param socketPath - Socket path
 * @param max - Longest path the OS accepts
 */
export function socketPathTooLongError(socketPath: string, max: number): ErrorWithSuggestion {
  return {
    message: `Session directory path is too long for the daemon socket (${Buffer.byteLength(socketPath)} bytes, at most ${max}): ${socketPath}`,
    suggestion: SESSION_DIR_SUGGESTION,
  };
}

/**
 * The Chrome of `--chrome-ws-url` does not answer on its HTTP endpoint.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param secure - Whether a wss: URL was given
 */
export function externalChromeUnreachableError(
  endpoint: string,
  secure: boolean
): ErrorWithSuggestion {
  return {
    message: `Cannot reach the Chrome DevTools endpoint at ${endpoint}`,
    suggestion: secure
      ? 'Chrome itself serves ws:// only; use ws://host:port/... unless a TLS proxy is in front of it'
      : 'Check that Chrome runs with --remote-debugging-port and is reachable from here',
  };
}

/**
 * Something answers on the `--chrome-ws-url` endpoint, but it is not Chrome's
 * DevTools HTTP endpoint (e.g. a web server on that port).
 *
 * @param endpoint - e.g. http://127.0.0.1:3000
 */
export function notDevToolsEndpointError(endpoint: string): ErrorWithSuggestion {
  return {
    message: `${endpoint} answers, but it is not a Chrome DevTools endpoint (no /json/version)`,
    suggestion:
      "Give Chrome's debugging port (the --remote-debugging-port it was started with), not the page's port",
  };
}

/**
 * Another running bdg session uses the Chrome (or tab) `--chrome-ws-url`
 * points to.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param owner - The other session: name (null for a default session),
 *   directory, base directory and whether it launched that Chrome
 */
export function chromeInUseBySessionError(
  endpoint: string,
  owner: { name: string | null; dir: string; baseDir: string; launched: boolean }
): ErrorWithSuggestion {
  const label = owner.name === null ? 'the default bdg session' : `bdg session "${owner.name}"`;
  const what = owner.launched ? 'was launched by' : 'has its tab driven by';
  const envPrefix =
    owner.baseDir === getSessionBaseDir() ? '' : `BDG_SESSION_DIR=${owner.baseDir} `;
  const ownerCommand = (command: string): string => envPrefix + sessionCommand(command, owner.name);
  return {
    message: `The Chrome at ${endpoint} ${what} ${label} (${owner.dir}); attaching would take it over`,
    suggestion: `Use that session (${ownerCommand('bdg status')}), stop it first (${ownerCommand('bdg stop')}), or attach to another Chrome or tab (a page URL from ${endpoint}/json/list)`,
  };
}

/**
 * The page id of a `--chrome-ws-url` page URL does not exist.
 *
 * @param id - Page id from the URL
 * @param endpoint - e.g. http://127.0.0.1:9222
 */
export function externalPageNotFoundError(id: string, endpoint: string): ErrorWithSuggestion {
  return {
    message: `No page with id ${id} in the Chrome at ${endpoint}`,
    suggestion: `List its pages: curl -s ${endpoint}/json/list`,
  };
}

/**
 * The browser id of a `--chrome-ws-url` browser URL is not this Chrome's.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param actual - The Chrome's browser WebSocket URL
 */
export function externalBrowserIdMismatchError(
  endpoint: string,
  actual: string
): ErrorWithSuggestion {
  return {
    message: `The Chrome at ${endpoint} has a different browser id (it was restarted, or the URL is from another Chrome)`,
    suggestion: `Use its current URL: ${sessionCommand(`bdg <url> --chrome-ws-url ${actual}`)}`,
  };
}

/**
 * Options that only apply when bdg launches Chrome, given with `--chrome-ws-url`.
 *
 * @param options - The conflicting options, e.g. ["--port", "-u"]
 */
export function chromeWsUrlConflictError(options: string[]): ErrorWithSuggestion {
  return {
    message: `${options.join(' and ')} cannot be used with --chrome-ws-url (the running Chrome already has its port, profile and window mode)`,
    suggestion: 'Drop them, or let bdg launch Chrome without --chrome-ws-url',
  };
}

/**
 * A numeric index given together with `--index`.
 *
 * @param index - The index argument
 * @param command - The `bdg dom` subcommand it was given to, e.g. "layout"
 */
export function indexWithIndexOptionError(index: string, command: string): ErrorWithSuggestion {
  return {
    message: `--index applies to a selector, but "${index}" is already an index from the last query`,
    suggestion: `Use one: bdg dom ${command} ${index}, or bdg dom ${command} "<selector>" --index <n>`,
  };
}

/** Problems with `bdg dom scroll` options, and how to fix each */
const SCROLL_PROBLEMS = {
  'index-without-selector': [
    '--index requires a selector',
    'Use: bdg dom scroll "selector" --index 2',
  ],
  vertical: [
    'Conflicting scroll directions: --up/--down/--top/--bottom',
    'Use one vertical direction',
  ],
  horizontal: ['Conflicting scroll directions: --left and --right', 'Use either --left or --right'],
  'selector-with-offset': [
    'A selector cannot be combined with --up/--down/--left/--right/--top/--bottom',
    'Scroll to the element (bdg dom scroll "footer"), or by an offset (bdg dom scroll --down 500)',
  ],
  'no-target': [
    'No scroll target specified',
    'Provide a selector (bdg dom scroll "footer") or offset (--down 500, --bottom)',
  ],
} as const;

/**
 * Invalid `bdg dom scroll` options.
 *
 * @param problem - Which rule was broken
 */
export function scrollOptionsError(problem: keyof typeof SCROLL_PROBLEMS): ErrorWithSuggestion {
  const [message, suggestion] = SCROLL_PROBLEMS[problem];
  return { message, suggestion };
}

/**
 * A key name `dom pressKey` does not know.
 *
 * @param keyName - Key as given
 * @param similar - Similar key names
 */
export function unknownKeyError(keyName: string, similar: string[]): ErrorWithSuggestion {
  return {
    message: `Unknown key: "${keyName}"`,
    suggestion: similar.length
      ? `Did you mean: ${similar.join(', ')}?`
      : 'Keys: Enter, Tab, Escape, Space, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12, a-z, A-Z, 0-9, !@#$%^&*()',
  };
}

/**
 * `dom screenshot` given an element both as an argument and as an option,
 * and they differ.
 *
 * @param option - The option and its value, e.g. `--selector #a`
 * @param positional - The element argument
 * @returns Message and suggestion
 */
export function conflictingTargetError(option: string, positional: string): ErrorWithSuggestion {
  return {
    message: `${option} and the element argument "${positional}" name different elements`,
    suggestion: 'Name the element once: bdg dom screenshot <path> <selector|index>',
  };
}

/**
 * Two options given together where one would be ignored.
 *
 * @param first - First option
 * @param second - Option it conflicts with
 * @returns Message
 */
export function conflictingOptionsMessage(first: string, second: string): string {
  return `${first} cannot be combined with ${second}; use one of them`;
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
 * @returns Message
 */
export function optionRequiresMessage(option: string, required: string): string {
  return `${option} only works with ${required}; add ${required} or drop ${option}`;
}

/**
 * `bdg page navigate javascript:…`: scripts run with dom eval.
 */
export function javascriptNavigationError(): ErrorWithSuggestion {
  return {
    message: 'page navigate opens pages; it does not run javascript: URLs',
    suggestion: `Run the script in the page instead: bdg dom eval '...'`,
  };
}

/**
 * A bare word given where a URL is expected, most likely a mistyped command.
 *
 * @param word - The argument
 * @param similar - Similar command names
 */
export function unknownCommandError(word: string, similar: string[]): ErrorWithSuggestion {
  const [closest] = similar;
  return {
    message: `Unknown command: "${word}"`,
    suggestion: closest
      ? `Did you mean: bdg ${closest}?`
      : `Run "bdg --help" for commands. To open a host named "${word}", use a full URL: bdg http://${word}/`,
  };
}

/**
 * The browser could not load the start URL at all.
 *
 * @param url - URL that failed
 * @param errorText - Chrome network error (e.g. net::ERR_NAME_NOT_RESOLVED)
 */
export function navigationFailedError(url: string, errorText: string): ErrorWithSuggestion {
  return {
    message: `Could not load ${url}: ${errorText}`,
    suggestion: 'Check the URL and that the server is running and reachable from this machine',
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

/** What a submit was still waiting for when its wait ran out */
export interface SubmitBlockers {
  /** The page request the submit sent, if any */
  document?: DocumentRequestState | undefined;
  /** Requests still running (the longest-running first) */
  pending?: PendingRequestInfo[] | undefined;
  /** All requests still running */
  pendingCount?: number | undefined;
}

/**
 * What to do about a submit that timed out waiting for a navigation, by how
 * far its page request got: without one the form probably submits via fetch.
 *
 * @param document - The page request, if one was sent
 * @returns Suggestion
 */
function submitNavigationSuggestion(document: DocumentRequestState | undefined): string {
  if (document === undefined) {
    return 'The form sent no page request, so it may not navigate (e.g. it submits via fetch); retry without --wait-navigation';
  }
  const details = `see it with ${sessionCommand('bdg network list --last 10')}`;
  if (document.errorText !== undefined) return `The page request failed; ${details}`;
  if (document.status !== undefined && document.status >= 400) {
    return `The server answered with an error; ${details}`;
  }
  if (document.status !== undefined) {
    return 'The server answered without a new page; retry without --wait-navigation';
  }
  return 'The server has not answered the page request yet; retry with a larger --timeout';
}

/**
 * What a timed-out submit was waiting on, in words: its page request when a
 * navigation was awaited or the request had not loaded a page, otherwise the
 * requests still running.
 *
 * @param waitNavigation - Whether a navigation was awaited
 * @param blockers - The page request and the requests still running
 * @returns e.g. `POST …/authenticate pending for 10s`; undefined when nothing is known
 */
function submitWaitDetail(waitNavigation: boolean, blockers: SubmitBlockers): string | undefined {
  const { document, pending = [] } = blockers;
  const loadedPage =
    document?.status !== undefined && document.status < 400 && document.errorText === undefined;
  if (document && (waitNavigation || !loadedPage)) return documentRequestText(document);
  if (pending.length === 0) return undefined;
  return `waiting on ${pendingRequestsText(pending, blockers.pendingCount ?? pending.length)}`;
}

/**
 * The form was submitted but the wait for its result timed out. The message
 * names what it was waiting on: the page request the submit sent (pending,
 * answered with an error, failed; waiting for a navigation, also one that
 * answered), or else the requests still running.
 *
 * @param timeout - Timeout in ms
 * @param waitNavigation - Whether a navigation was awaited
 * @param blockers - The page request and the requests still running
 * @returns e.g. `Form submitted, but timed out after 10000ms waiting for navigation: POST …/authenticate pending for 10s`
 */
export function submitTimeoutError(
  timeout: number,
  waitNavigation: boolean,
  blockers: SubmitBlockers = {}
): ErrorWithSuggestion {
  const detail = submitWaitDetail(waitNavigation, blockers);
  const message = `Form submitted, but timed out after ${timeout}ms waiting for ${waitNavigation ? 'navigation' : 'network idle'}${detail ? `: ${detail}` : ''}`;
  if (!waitNavigation) {
    return {
      message,
      suggestion: 'Increase --timeout, or use --wait-network 0 to return right after submitting',
    };
  }
  return { message, suggestion: submitNavigationSuggestion(blockers.document) };
}

/**
 * Warning of a submit whose navigation happened but whose network was still
 * busy when the wait ran out (the new page is there; a slow script or
 * tracker kept loading).
 *
 * @param timeout - Timeout in ms
 * @param pending - Requests still in flight
 * @returns Warning text
 */
export function submitNetworkBusyWarning(timeout: number, pending: number): string {
  const requests = pending === 1 ? '1 request' : `${pending} requests`;
  return `The new page loaded, but ${requests} still had not finished after ${timeout}ms`;
}

/**
 * No element has the given node id.
 *
 * @param nodeId - Backend node id given with --node-id
 */
export function nodeIdNotFoundError(nodeId: number): ErrorWithSuggestion {
  return {
    message: `No element with node id ${nodeId} in the page`,
    suggestion:
      'Get current node ids with "bdg dom query <selector>" or "bdg dom get <selector> --raw"',
  };
}

/**
 * The list an index refers to, in words.
 *
 * @param source - Where the index comes from
 * @returns e.g. `index 0 of the last dom query "h3"`, `index 2 of the last dom form`
 */
export function indexSourceText(source: IndexSource): string {
  return `index ${source.index} of ${cachedListText(source)}`;
}

/**
 * The cached list an index refers to, in words.
 *
 * @param source - Where the index comes from
 * @returns e.g. `the last dom query "h3"`
 */
function cachedListText(source: IndexSource): string {
  const query = source.query === undefined ? '' : ` "${source.query}"`;
  return `the last ${source.command}${query}`;
}

/**
 * The command that refreshes the list an index refers to.
 *
 * @param source - Where the index comes from
 * @returns e.g. `bdg dom query 'h3'`
 */
function refreshCommand(source: IndexSource): string {
  if (source.query === undefined) return sessionCommand(`bdg ${source.command}`);
  return sessionCommand(`bdg ${source.command} ${shellQuote(source.query)}`);
}

/** Why an element's cross-origin iframe could not be placed in the page */
export type FrameMappingProblem = 'no-box' | 'rotated' | 'unreadable';

/**
 * An element of a cross-origin iframe (from an a11y query) whose iframe
 * could not be placed in the top-level viewport, so a mouse event or layout
 * would land in the wrong place.
 *
 * @param problem - The iframe or element has no box, is rotated or skewed, or could not be read
 * @param detail - Underlying error, if any
 * @returns Message and suggestion
 */
export function frameMappingError(
  problem: FrameMappingProblem,
  detail?: string
): ErrorWithSuggestion {
  const reasons = {
    'no-box': 'neither the element nor its iframe document has a box (hidden or removed)',
    rotated: 'the iframe is rotated or skewed, which bdg cannot map',
    unreadable: `it could not be measured${detail ? ` (${detail})` : ''}`,
  };
  return {
    message: `Cannot place the element's cross-origin iframe in the page: ${reasons[problem]}`,
    suggestion: `Act inside the frame instead: ${sessionCommand('bdg dom frames')}, then ${sessionCommand('bdg dom eval --frame <n> \'document.querySelector("…").click()\'')}`,
  };
}

/**
 * A cached node is gone (page navigated or the element was removed).
 *
 * @param index - Index the user gave, if any
 * @param source - The list the index refers to, when known
 * @returns Message and suggestion
 */
export function staleNodeError(index?: number, source?: IndexSource): ErrorWithSuggestion {
  if (source) {
    return {
      message: `The element at ${indexSourceText(source)} is no longer in the page (it was removed or the page navigated)`,
      suggestion: `Re-run "${refreshCommand(source)}" to get fresh indices`,
    };
  }
  const element = index === undefined ? 'The element' : `The element at index ${index}`;
  return {
    message: `${element} is no longer in the page (it was removed or the page navigated)`,
    suggestion: 'Re-run "bdg dom query <selector>" (or "bdg dom form") to get fresh indices',
  };
}

/**
 * An index beyond the cached results.
 *
 * @param source - The index and the list it refers to
 * @param count - Number of cached results
 * @returns Message and suggestion
 */
export function cachedIndexOutOfRangeError(
  source: IndexSource,
  count: number
): ErrorWithSuggestion {
  const results = count === 1 ? '1 result' : `${count} results`;
  return {
    message: `Index ${source.index} is out of range for ${cachedListText(source)} (${results})`,
    suggestion:
      count > 0
        ? `Use an index between 0 and ${count - 1}, or re-run "${refreshCommand(source)}"`
        : `Re-run "${refreshCommand(source)}"`,
  };
}

/**
 * Note for a form command (fill, submit) whose index refers to results of
 * another command and hit an element it cannot act on.
 *
 * @param source - The index and the list it refers to
 * @param preview - What the cached element is, e.g. `h3 "Welcome"`
 * @returns e.g. `index 0 refers to the last dom query results ("h3": h3 "Welcome"); run bdg dom form to target form fields by index`
 */
export function otherIndexSourceNote(source: IndexSource, preview?: string): string {
  const query = source.query === undefined ? '' : `"${source.query}"`;
  const what = [query, preview].filter(Boolean).join(': ');
  return `index ${source.index} refers to the last ${source.command} results${what ? ` (${what})` : ''}; run ${sessionCommand('bdg dom form')} to target form fields by index`;
}

/** What a page holds that selectors cannot search (a cheap page check) */
export interface UnsearchedContent {
  /** Iframes whose document the page cannot read (cross-origin) */
  crossOriginFrames: boolean;
  /** `<object>`/`<embed>` elements */
  embeds: boolean;
}

/**
 * Where selectors do not reach (open shadow roots and same-origin iframes are
 * searched), and how to reach an element in a cross-origin iframe instead.
 * When the page was checked, only what it has is named (nothing when it has
 * neither cross-origin iframes nor embeds; closed shadow roots cannot be
 * detected).
 *
 * @param selector - Selector that matched nothing
 * @param unsearched - What the page holds, when it was checked
 * @returns Note for "not found" suggestions (empty when nothing applies)
 */
export function unreachableElementsNote(selector: string, unsearched?: UnsearchedContent): string {
  const script = `document.querySelector(${JSON.stringify(selector)})`.replaceAll("'", `'\\''`);
  const framesHelp = `For an element in a cross-origin iframe: ${sessionCommand('bdg dom frames')}, then ${sessionCommand(`bdg dom eval --frame <n> '${script}'`)}`;
  if (!unsearched) {
    return joinLines(
      'Closed shadow roots, cross-origin iframes and <object>/<embed> documents are not searched.',
      framesHelp
    );
  }
  const places = [
    unsearched.crossOriginFrames && 'cross-origin iframes',
    unsearched.embeds && '<object>/<embed> documents',
  ].filter(Boolean);
  if (places.length === 0) return '';
  return joinLines(
    `The page has ${places.join(' and ')}, which are not searched.`,
    unsearched.crossOriginFrames ? framesHelp : undefined
  );
}

/**
 * "Did you mean" for a selector that is a single id or class.
 *
 * @param kind - Id or class
 * @param names - Similar names on the page
 * @returns e.g. `Did you mean #remove-backpack? (similar id on the page)`; empty without names
 */
export function similarSelectorsLine(kind: 'id' | 'class', names: string[]): string {
  if (names.length === 0) return '';
  const sigil = kind === 'id' ? '#' : '.';
  const what = kind === 'id' ? 'id' : 'class';
  const plural = names.length === 1 ? what : kind === 'id' ? 'ids' : 'classes';
  return `Did you mean ${names.map((name) => sigil + name).join(', ')}? (similar ${plural} on the page)`;
}

/** What the page says about a selector that matched nothing */
export interface NoMatchContext {
  /** Elements only its `:visible` filters excluded */
  hidden?: number;
  /** The page's `document.readyState`, when known (a hint is added while it loads) */
  readyState?: string;
  /** What the page holds that selectors cannot search, when checked */
  unsearched?: UnsearchedContent;
  /** "Did you mean" line for a single id or class ({@link similarSelectorsLine}) */
  similar?: string;
}

/**
 * No nodes found for selector.
 *
 * @param selector - Selector as given
 * @param context - What the page says about it (hidden matches, readyState, unsearched content, similar names)
 */
export function noNodesFoundError(
  selector: string,
  context: NoMatchContext = {}
): ErrorWithSuggestion {
  const hiddenMatches = context.hidden ?? 0;
  const hidden =
    hiddenMatches > 0
      ? hiddenMatches === 1
        ? '1 element matches without :visible but is hidden (check with bdg dom layout). '
        : `${hiddenMatches} elements match without :visible but are hidden (check with bdg dom layout). `
      : '';
  const note = unreachableElementsNote(selector, context.unsearched);
  return {
    message: `No nodes found matching "${selector}"`,
    suggestion: withLoadingHint(
      joinLines(
        context.similar,
        `${hidden}Verify the CSS selector is correct.`,
        note ? note : undefined
      ),
      context.readyState,
      selector
    ),
  };
}

/**
 * Quote a value for a POSIX shell command line.
 *
 * @param value - Value
 * @returns The value in single quotes
 */
function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/** Why a page scroll moved nothing */
export interface ScrollNoEffect {
  /** Direction asked for */
  direction: 'up' | 'down' | 'left' | 'right';
  /** The document is no larger than the viewport, the page was at its edge already, or it did not move although it could */
  reason: 'too-small' | 'at-edge' | 'locked';
  /** Viewport size along the axis (px) */
  viewport: number;
  /** The page's `document.readyState` */
  readyState: string;
}

/** Edge of the page in each direction */
const SCROLL_EDGES = { up: 'top', down: 'bottom', left: 'left edge', right: 'right edge' };

/**
 * Warning of `bdg dom scroll` when the page did not move, with the
 * still-loading hint while the document is not complete (it may grow).
 *
 * @param effect - Why nothing scrolled
 * @returns e.g. `Nothing to scroll: the document is no taller than the viewport (993px)`
 */
export function scrollNoEffectWarning(effect: ScrollNoEffect): string {
  const vertical = effect.direction === 'up' || effect.direction === 'down';
  const reasons = {
    'too-small': `Nothing to scroll: the document is no ${vertical ? 'taller' : 'wider'} than the viewport (${effect.viewport}px)`,
    'at-edge': `Nothing scrolled: the page is already at the ${SCROLL_EDGES[effect.direction]}`,
    locked:
      'Nothing scrolled although the page is larger than the viewport; its scrolling may be locked (e.g. overflow: hidden while a dialog is open)',
  };
  const loading =
    effect.readyState === 'complete' ? undefined : pageStillLoadingHint(effect.readyState);
  return [reasons[effect.reason], loading].filter(Boolean).join('. ');
}

/**
 * Hint for something not found while the page has not finished loading.
 *
 * @param readyState - The page's `document.readyState` (not `complete`)
 * @param selector - Selector that matched nothing, if any
 * @returns e.g. `The page is still loading (document.readyState: loading); wait for the element with: bdg dom wait '#login'`
 */
export function pageStillLoadingHint(readyState: string, selector?: string): string {
  const wait =
    selector !== undefined && selector.trim() !== ''
      ? `wait for the element with: ${sessionCommand(`bdg dom wait ${shellQuote(selector)}`)}`
      : `wait for it with: ${sessionCommand('bdg dom wait --load')}`;
  return `The page is still loading (document.readyState: ${readyState}); ${wait}`;
}

/**
 * Put the still-loading hint before a "not found" suggestion when the page
 * has not finished loading.
 *
 * @param suggestion - Suggestion of the error
 * @param readyState - The page's `document.readyState`, if known
 * @param selector - Selector that matched nothing, if any
 * @returns The suggestion, with the hint first while the page loads
 */
export function withLoadingHint(
  suggestion: string,
  readyState: string | undefined,
  selector?: string
): string {
  if (readyState === undefined || readyState === 'complete') return suggestion;
  return joinLines(pageStillLoadingHint(readyState, selector), suggestion || undefined);
}

/**
 * `bdg dom wait` without a selector or --load, or with --text/--gone but no selector.
 *
 * @returns Message and suggestion
 */
export function waitTargetRequiredError(): ErrorWithSuggestion {
  return {
    message: 'dom wait needs a selector (--text and --gone apply to its matches), or --load',
    suggestion: `e.g. ${sessionCommand("bdg dom wait '#result' --visible")}, ${sessionCommand("bdg dom wait body --text 'Welcome'")} or ${sessionCommand('bdg dom wait --load')}`,
  };
}

/**
 * `bdg dom wait` that ran out of time: what it waited for and what the page
 * showed last, with a next step that fits.
 *
 * @param condition - What was waited for
 * @param snapshot - Last thing the page reported (none when it never answered)
 * @param timeoutMs - The --timeout
 * @returns Message and suggestion
 */
export function waitTimeoutError(
  condition: WaitCondition,
  snapshot: WaitSnapshot | undefined,
  timeoutMs: number
): ErrorWithSuggestion {
  const seen = snapshot
    ? `last seen: ${waitSnapshotSummary(snapshot, condition)}`
    : 'the page did not answer';
  return {
    message: `Timed out after ${formatDuration(timeoutMs)} waiting for ${waitGoal(condition)} (${seen})`,
    suggestion: waitTimeoutSuggestion(condition, snapshot),
  };
}

/**
 * What `bdg dom wait` waits for, as a phrase.
 *
 * @param condition - What is waited for
 * @returns e.g. `#finish to be visible` or `the page to load`
 */
function waitGoal(condition: WaitCondition): string {
  if (condition.selector === undefined) return 'the page to load';
  const state = condition.gone
    ? condition.visible
      ? 'to be hidden'
      : 'to be gone'
    : condition.visible
      ? 'to be visible'
      : 'to appear';
  return `${waitTargetLabel(condition)} ${state}${condition.load ? ' and the page to load' : ''}`;
}

/**
 * Next step after a `bdg dom wait` timeout.
 *
 * @param condition - What was waited for
 * @param snapshot - Last thing the page reported
 * @returns Suggestion
 */
function waitTimeoutSuggestion(
  condition: WaitCondition,
  snapshot: WaitSnapshot | undefined
): string {
  const more = 'allow more time with --timeout <ms>';
  const selector = condition.selector;
  if (snapshot && snapshot.readyState !== 'complete') {
    return `The page is still loading; see the requests it waits on with ${sessionCommand('bdg peek')}, or ${more}`;
  }
  if (
    !snapshot ||
    selector === undefined ||
    condition.gone ||
    countedMatches(snapshot, condition) > 0
  ) {
    return `Check the page with ${sessionCommand('bdg peek')}, or ${more}`;
  }
  if (snapshot.count === 0) {
    return `Check the selector with ${sessionCommand(`bdg dom query ${shellQuote(selector)}`)}, or ${more}`;
  }
  if (snapshot.textCount === 0) {
    return `The matches do not contain the text; see what they say with ${sessionCommand(`bdg dom query ${shellQuote(selector)}`)}`;
  }
  return `The matches are hidden; see why with ${sessionCommand(`bdg dom layout ${shellQuote(selector)}`)}, or ${more}`;
}

/**
 * Element not visible/rendered.
 */
export function elementNotVisibleError(): ErrorWithSuggestion {
  return {
    message: 'Element is not rendered (e.g. display: none), so it has no area to capture',
    suggestion: 'Make it visible first, or capture a visible ancestor',
  };
}

/**
 * Element has zero dimensions.
 */
export function elementZeroDimensionsError(): ErrorWithSuggestion {
  return {
    message: 'Element has zero width or height, so there is nothing to capture',
    suggestion: 'It may be collapsed or empty; capture a visible ancestor instead',
  };
}

/**
 * Missing required argument.
 */
export function missingArgumentError(usage: string): ErrorWithSuggestion {
  return {
    message: 'Missing required argument or flag',
    suggestion: usage,
  };
}

/**
 * Either/or argument required.
 */
export function eitherArgumentRequiredError(
  arg1: string,
  arg2: string,
  example: string
): ErrorWithSuggestion {
  return {
    message: `Either ${arg1} or ${arg2} must be provided`,
    suggestion: example,
  };
}

/**
 * Invalid query pattern.
 */
export function invalidQueryPatternError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'Query pattern must specify at least one field',
    suggestion: `Received: "${pattern}". Try: bdg dom a11y query role=button, or ${A11Y_NAME_QUERY_EXAMPLE}`,
  };
}

/**
 * A file to upload does not exist.
 *
 * @param file - Path that was not found
 */
export function fileNotFoundError(file: string): ErrorWithSuggestion {
  return {
    message: `File not found: ${file}`,
    suggestion:
      'Relative paths are resolved against the directory you run bdg in; separate several files with commas',
  };
}

/**
 * A directory given for a file input.
 *
 * @param file - Resolved path
 */
export function uploadDirectoryError(file: string): ErrorWithSuggestion {
  return {
    message: `Not a file: ${file} is a directory`,
    suggestion: 'Give the path of a file inside it',
  };
}

/**
 * Several files given for a file input that accepts one.
 *
 * @param count - Number of files given
 */
export function singleFileInputError(count: number): ErrorWithSuggestion {
  return {
    message: `This file input accepts a single file (${count} given)`,
    suggestion:
      'Pass one path; only inputs with the "multiple" attribute take a comma-separated list',
  };
}

/**
 * Unknown field in an a11y query pattern.
 *
 * @param field - The unrecognized key
 * @param similar - A known field it looks like a typo of
 * @param value - The `name=…`/`description=…` field that absorbed it
 */
export function unknownQueryFieldError(
  field: string,
  similar?: string,
  value?: string
): ErrorWithSuggestion {
  const usage =
    "Use role, name or description, e.g. bdg dom a11y query 'role=button name=Sign in'. Quote the whole pattern for the shell; a name with spaces or colons goes last ('name=E-mail address:') or in inner quotes ('name=\"Role: admin\" role=textbox')";
  if (!similar) return { message: `Unknown query field: "${field}"`, suggestion: usage };
  const [key = '', ...text] = (value ?? '').split('=');
  return {
    message: `Unknown query field: "${field}" (did you mean "${similar}"?)`,
    suggestion: `Fix the field name, e.g. ${similar}=…; if the ${key} really contains "${field}:", put it in inner quotes: '${key}="${text.join('=')}"'`,
  };
}

/**
 * No a11y nodes matching pattern.
 */
export function noA11yNodesFoundError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'No nodes found matching pattern',
    suggestion: `Pattern: ${pattern}. Try a broader query or use "bdg dom a11y tree" to see all elements`,
  };
}

/**
 * An element that exists but has no node in the accessibility tree.
 *
 * @param target - Selector or index the user gave
 * @param reasons - Why Chrome leaves it out
 */
export function notInAccessibilityTreeError(
  target: string,
  reasons: string[]
): ErrorWithSuggestion {
  return {
    message: `${target} exists but is not in the accessibility tree${reasons.length ? ` (${reasons.join('; ')})` : ''}`,
    suggestion: `Screen readers skip it. Inspect its HTML instead: bdg dom get ${/^\d+$/.test(target) ? target : `'${target}'`}`,
  };
}

/**
 * Fillable element not found.
 */
export function fillableElementNotFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element not found: ${selector}`,
    suggestion: 'Verify the selector matches a fillable element (input, textarea, select)',
  };
}

/** Appended to the element type when an action went to a label's control. */
export const VIA_LABEL_SUFFIX = ' (via label)';

/** Placeholder for the shell-quoted `name=…` field in {@link LABEL_WITHOUT_CONTROL}. */
export const NAME_QUERY_PLACEHOLDER = '{nameQuery}';

/**
 * Filling a `<label>` that has no form control (used by the page script,
 * which puts the label's quoted `name=<text>` in place of
 * {@link NAME_QUERY_PLACEHOLDER}).
 */
export const LABEL_WITHOUT_CONTROL: ErrorWithSuggestion = {
  message: 'Element is not fillable (a <label> not associated with a form control)',
  suggestion: `Find the field by its accessible name: bdg dom a11y query ${NAME_QUERY_PLACEHOLDER}, or list the form fields: bdg dom form`,
};

/**
 * Why `dom fill` refused an element (used by the page script, which adds the
 * cause in parentheses, e.g. `The element is read-only (contenteditable="false")`).
 * All are invalid targets (exit 81), like any element that is not fillable.
 */
export const FILL_REFUSALS = {
  disabled: {
    message: 'The element is disabled',
    suggestion: 'Enable the field first (it may depend on another input)',
  },
  readOnly: {
    message: 'The element is read-only',
    suggestion: 'A user cannot change it either; the page has to make it editable first',
  },
  inert: {
    message: 'The element is inert',
    suggestion:
      'The page made it non-interactive (often behind a dialog); close what covers it first',
  },
  notFillable: {
    message: 'Element is not fillable',
    suggestion: 'Only input, textarea, select, and contenteditable elements can be filled',
  },
} as const satisfies Record<string, ErrorWithSuggestion>;

/**
 * Clickable element not found.
 */
export function clickableElementNotFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element not found: ${selector}`,
    suggestion: 'Verify the selector matches a clickable element',
  };
}

/**
 * Click target disappeared between locating and clicking it.
 */
export function clickTargetDetachedError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element was removed before it could be clicked: ${selector}`,
    suggestion: 'The page changed during the click; wait for it to settle and retry',
  };
}

/**
 * Key press failed.
 */
export function keyPressFailedError(details: string): ErrorWithSuggestion {
  return {
    message: 'Failed to press key',
    suggestion: details,
  };
}

/**
 * A `bdg dom eval` script ran too long and was terminated.
 *
 * @param timeoutMs - Time limit in ms
 * @returns Error with suggestion
 */
export function scriptTimeoutError(timeoutMs: number): ErrorWithSuggestion {
  return {
    message: `Script did not finish within ${Math.round(timeoutMs / 1000)}s and was terminated`,
    suggestion: 'Check for endless loops or long-running work; the page is usable again',
  };
}

/**
 * The page (or an iframe) was kept busy by a script (e.g. a loop started
 * from a timer) and bdg terminated it.
 *
 * @param timeoutMs - Time waited
 * @param scope - What was busy: the page, or the iframe a command ran in
 */
export function pageBusyError(
  timeoutMs: number,
  scope: 'page' | 'frame' = 'page',
  recovered = true
): ErrorWithSuggestion {
  const busy = `The ${scope} was busy for ${Math.round(timeoutMs / 1000)}s (a script kept it running)`;
  if (!recovered) {
    return {
      message: `${busy} and its scripts could not be stopped`,
      suggestion: 'Retry in a moment; if it stays busy, reload the page: bdg page reload',
    };
  }
  return {
    message: `${busy}, so its scripts were terminated`,
    suggestion: `The ${scope} is usable again; re-run the command`,
  };
}

/**
 * The page did not answer because a navigation is still waiting for the
 * server (Chrome holds commands for the page until the new document arrives).
 *
 * @param url - URL being loaded
 */
export function navigationPendingError(url: string): ErrorWithSuggestion {
  return {
    message: `The page is not answering: it is still waiting for the server to respond to ${url}`,
    suggestion: 'Wait for the page to load, or load another one: bdg page navigate <url>',
  };
}

/**
 * `dom eval` given an empty script (often a shell variable that was not set).
 */
export function emptyScriptError(): ErrorWithSuggestion {
  return {
    message: 'The script is empty',
    suggestion: `Pass an expression, e.g. bdg dom eval 'document.title'`,
  };
}

/**
 * A promise returned by `dom eval` that did not settle in time.
 *
 * @param timeoutMs - Time waited
 */
export function promiseTimeoutError(timeoutMs: number): ErrorWithSuggestion {
  return {
    message: `The awaited promise did not settle within ${Math.round(timeoutMs / 1000)}s`,
    suggestion:
      'Nothing was busy; check that the promise resolves or rejects, or race it with a timeout in the script',
  };
}

/** How to see the frames `--frame` accepts */
const LIST_FRAMES_HINT = 'List frames: bdg dom frames';

/**
 * `dom eval --frame` given an empty frame.
 */
export function emptyFrameError(): ErrorWithSuggestion {
  return {
    message: 'The frame is empty',
    suggestion: `Pass an index, a name/id attribute, or part of the name, id or URL. ${LIST_FRAMES_HINT}`,
  };
}

/**
 * `dom eval --frame` matching no iframe.
 *
 * @param query - Requested frame
 * @param frames - Frames of the page
 */
export function frameNotFoundError(query: string, frames: DomFrame[]): ErrorWithSuggestion {
  if (frames.length === 0) {
    return { message: `Frame not found: ${query}`, suggestion: 'The page has no iframes' };
  }
  return {
    message: `Frame not found: ${query}`,
    suggestion: joinLines('Available frames:', ...frames.map((frame) => `  ${frameLabel(frame)}`)),
  };
}

/**
 * A `dom eval --frame` index that names another frame (or none) than when
 * `bdg dom frames` listed it.
 *
 * @param index - Requested index
 */
export function staleFrameIndexError(index: number): ErrorWithSuggestion {
  return {
    message: `Frame index ${index} is stale: the page's iframes changed since bdg dom frames listed them`,
    suggestion:
      'Re-run bdg dom frames to refresh the indices, or pick the frame by name, id or URL (--frame <name>)',
  };
}

/**
 * `dom eval --frame` matching more than one iframe.
 *
 * @param query - Requested frame
 * @param candidates - Matching frames
 */
export function ambiguousFrameError(query: string, candidates: DomFrame[]): ErrorWithSuggestion {
  return {
    message: `Frame "${query}" matches ${candidates.length} frames`,
    suggestion: joinLines(
      'Pick one by index, or a longer part of the name, id or URL:',
      ...candidates.map((frame) => `  ${frameLabel(frame)}`)
    ),
  };
}

/**
 * An iframe without a JavaScript context (still loading, or gone).
 *
 * @param url - Frame URL
 */
export function frameNotReadyError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame has no JavaScript context: ${frameUrlLabel(url)}`,
    suggestion: `Wait for it to load and retry, or re-run bdg dom frames: the frame may no longer exist`,
  };
}

/**
 * The iframe a `dom eval --frame` script ran in navigated before it finished.
 *
 * @param url - Frame URL when the script started
 */
export function frameNavigatedDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame navigated while the script ran: ${frameUrlLabel(url)}`,
    suggestion:
      'The result was lost with the old document; re-run the script once the frame has loaded. List frames: bdg dom frames',
  };
}

/**
 * The iframe a `dom eval --frame` script ran in was removed (or vanished
 * before it started).
 *
 * @param url - Frame URL when the script started
 */
export function frameRemovedDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame was removed before the script finished: ${frameUrlLabel(url)}`,
    suggestion: 'The frame no longer exists; re-run bdg dom frames to see the current ones',
  };
}

/**
 * The page (its tab) was closed while a `dom eval` script ran.
 */
export function pageClosedDuringEvalError(): ErrorWithSuggestion {
  return {
    message: 'The page was closed while the script ran',
    suggestion: 'Its tab is gone; start a new session with: bdg <url>',
  };
}

/**
 * The iframe a `dom eval --frame` script ran in went away, and bdg could not
 * tell whether it navigated or was removed.
 *
 * @param url - Frame URL when the script started
 */
export function frameLostDuringEvalError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame navigated or was removed while the script ran: ${frameUrlLabel(url)}`,
    suggestion: 'Re-run bdg dom frames to see the current frames, then the script',
  };
}

/**
 * The page navigated while a `dom eval` script ran (e.g. it set
 * `location.href` and then awaited).
 */
export function pageNavigatedDuringEvalError(): ErrorWithSuggestion {
  return {
    message: 'The page navigated while the script ran',
    suggestion:
      'The result was lost with the old document; re-run the script on the new page (navigate with: bdg page navigate <url>)',
  };
}

/** `Identifier 'x' has already been declared` */
const REDECLARED_PATTERN = /^SyntaxError: Identifier '([\w$]+)' has already been declared/;

/**
 * Tip for a top-level `const`/`let` whose name the page or the script itself
 * already declares (`dom eval` runs like the console: names persist between
 * calls, and a page's own top-level `let`/`const`/`class` cannot be declared again).
 *
 * @param name - The redeclared identifier
 * @returns Tip
 */
function redeclarationTip(name: string): string {
  return [
    `'${name}' is already declared at the top level, by the page or earlier in this script.`,
    `Rename it, or wrap the script in a block so its names stay local: ${sessionCommand(`bdg dom eval '{ const ${name} = ...; ${name} }'`)}`,
  ].join('\n');
}

/**
 * Script execution error with shell quote detection.
 *
 * Shows the script as received to help diagnose shell quote stripping issues.
 * Detects common patterns like `querySelector(input)` that indicate shell damage.
 *
 * @param errorMessage - The JavaScript error message
 * @param receivedScript - The script as received by the command (optional for backwards compat)
 * @returns Error with context-aware suggestions
 */
export function scriptExecutionError(
  errorMessage: string,
  receivedScript?: string
): ErrorWithSuggestion {
  if (!receivedScript) {
    return {
      message: errorMessage,
      suggestion: 'Check JavaScript syntax and ensure the expression is valid',
    };
  }

  const quoteCheck = detectScriptQuoteDamage(receivedScript, errorMessage);
  const redeclared = REDECLARED_PATTERN.exec(errorMessage)?.[1];
  const truncatedScript =
    receivedScript.length > 100 ? receivedScript.slice(0, 100) + '...' : receivedScript;

  const lines: string[] = [];
  lines.push(`Script received: ${truncatedScript}`);

  if (quoteCheck.damaged) {
    lines.push('');
    lines.push('Shell quote damage detected:');
    if (quoteCheck.details) {
      lines.push(`  ${quoteCheck.details}`);
    }
    if (quoteCheck.suggestion) {
      lines.push('');
      lines.push(quoteCheck.suggestion);
    }
  } else if (redeclared) {
    lines.push('');
    lines.push(redeclarationTip(redeclared));
  } else if (/^SyntaxError\b/.test(errorMessage)) {
    lines.push('');
    lines.push('Tips:');
    lines.push("  - Use single quotes around script: bdg dom eval '...'");
    lines.push('  - For complex scripts, read them from a file: bdg dom eval "$(cat script.js)"');
    lines.push('  - Escape inner quotes: \\" or use opposite quote style');
  }

  return {
    message: errorMessage,
    suggestion: lines.join('\n'),
  };
}

/**
 * Unexpected CDP response format.
 */
export function unexpectedResponseFormatError(context: string): ErrorWithSuggestion {
  return {
    message: 'Unexpected response format',
    suggestion: `CDP response missing result.value or invalid ${context} structure`,
  };
}

/**
 * Generic operation failure with dynamic error message.
 */
export function operationFailedError(operation: string, errorMessage: string): ErrorWithSuggestion {
  return {
    message: `Failed to ${operation}`,
    suggestion: errorMessage,
  };
}

/**
 * The browser does not offer `DOMDebugger.getEventListeners` (non-Chrome
 * targets, or browsers that disable the DOMDebugger domain).
 *
 * @param detail - Chrome's error
 * @returns Message and suggestion
 */
export function eventListenersUnavailableError(detail: string): ErrorWithSuggestion {
  return {
    message: `This browser cannot list event listeners (DOMDebugger.getEventListeners: ${detail})`,
    suggestion: 'Use a Chromium-based browser (Chrome, Edge) that supports the DOMDebugger domain',
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
 * No forms found on page.
 */
export function noFormsFoundError(readyState?: string): ErrorWithSuggestion {
  const check =
    'Check if forms exist with: bdg dom query "form, input, [role=textbox]" or inspect the page manually';
  if (readyState === undefined || readyState === 'complete') {
    return { message: 'No forms discovered on the page', suggestion: check };
  }
  return {
    message: 'No forms discovered on the page yet; it is still loading',
    suggestion: joinLines(pageStillLoadingHint(readyState), check),
  };
}

/**
 * The form discovery script threw.
 *
 * @param detail - What it threw, e.g. `TypeError: Cannot read properties of null`
 * @param readyState - The page's `document.readyState`, when known
 * @returns Message and suggestion (the still-loading hint while the page loads)
 */
export function formDiscoveryFailedError(detail: string, readyState?: string): ErrorWithSuggestion {
  if (readyState !== undefined && readyState !== 'complete') {
    return {
      message: `Form discovery failed while the page is still loading (${detail})`,
      suggestion: pageStillLoadingHint(readyState),
    };
  }
  return {
    message: `Form discovery failed: ${detail}`,
    suggestion: `The page changed or threw while it was read; retry, or look at the fields with ${sessionCommand('bdg dom query "form, input, select, textarea"')}`,
  };
}

/**
 * Form in iframe (cross-origin or same-origin).
 */
export function formInIframeError(iframeUrl: string, crossOrigin: boolean): ErrorWithSuggestion {
  return {
    message: `${crossOrigin ? 'The form may be' : 'The form is'} inside an iframe: ${iframeUrl}`,
    suggestion: crossOrigin
      ? 'Cross-origin iframes cannot be read or controlled; open the iframe URL directly: bdg <iframe url>'
      : 'dom form lists forms of the main document only; its fields are reachable directly: bdg dom query "input, select, textarea", then bdg dom fill <index> <value>',
  };
}
