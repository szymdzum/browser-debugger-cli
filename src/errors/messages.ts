/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

import * as path from 'path';

import type { DomFrame } from '@/ipc/protocol/commands.js';
import { escapeControlChars, formatDuration, joinLines } from '@/ui/formatting.js';
import { frameLabel } from '@/ui/messages/commands.js';
import {
  detectSelectorQuoteDamage,
  detectScriptQuoteDamage,
  hasAttributeSelector,
} from '@/utils/shellDetection.js';

/**
 * Generate "session already running" error message.
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
    'Error: Session already running',
    '',
    `  PID:      ${pid}`,
    targetUrl && `  Target:   ${targetUrl}`,
    `  Duration: ${formatDuration(duration)}`,
    '',
    'Suggestions:',
    '  View session:     bdg status',
    '  Stop and restart: bdg stop && bdg <url>',
    ''
  );
}

/** What to do when `bdg <url>` finds a session already running */
export const ALREADY_RUNNING_SUGGESTION =
  'Use the running session (bdg status), or stop it first: bdg stop && bdg <url>';

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
    "Run 'bdg stop' before attaching to a different target.",
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
    suggestion:
      'Retry in a moment; if it stays unresponsive, end it with: bdg cleanup --force (stops the daemon and its Chrome)',
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
    suggestion:
      'Check the session with: bdg status; if the page stays frozen, end it with: bdg cleanup --force',
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
    ? 'Wait until "bdg <url>" returns, then retry'
    : 'Start a session with: bdg <url>';
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
    'Error: No active session',
    context?.staleCleanedUp && '(Stale daemon files were cleaned up)',
    context?.lastError && `Last error: ${context.lastError}`,
    'Start a session with: bdg <url>',
    context?.suggestStatus && '',
    context?.suggestStatus && 'Or check daemon status:',
    context?.suggestStatus && '  bdg status',
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
    `  1. Query first:  bdg dom query '${selector}'`,
    '  2. Then inspect: bdg dom a11y describe 0',
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
      'Check the selector syntax, or wait for the element to load (bdg peek shows the page state)',
      CROSS_ORIGIN_FRAMES_NOTE
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

/** Playwright selector syntax bdg does not support (`:text()`, `>>` chains, `text=` engines, layout pseudo-classes). */
const PLAYWRIGHT_ONLY_SYNTAX =
  /:(?:text|text-matches|nth-match|left-of|right-of|above|below|near)\(|>>|^\s*(?:text|css|xpath|role|id|data-testid|internal:\w+)=/i;

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
      ? 'Playwright-only syntax is not CSS. bdg supports :has-text("…"), :text-is("…") and :visible at the end of a selector, e.g. button:has-text("Save"), or find elements by accessible name: bdg dom a11y query name="…"'
      : 'Check the selector syntax, e.g. bdg dom query "button.primary"',
  };
}

/**
 * A text or visibility filter (`:has-text()`, `:text-is()`, `:visible`) that
 * is not at the end of a selector.
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
    message: `${filter} must come last in a selector (after the CSS of the element to match): ${selector}`,
    suggestion: `Move it to the end, e.g. form button:has-text("Save"); to match an element by what it contains use CSS :has(), e.g. div:has(> button), or find elements by accessible name: bdg dom a11y query name="…"`,
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
    suggestion: `Use 1-${maxLength} letters, digits, "-" or "_", e.g. --session agent-1`,
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
    message: `Session directory path is too long for the daemon socket (${socketPath.length} characters, at most ${max})`,
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
    suggestion: `Use its current URL: bdg <url> --chrome-ws-url ${actual}`,
  };
}

/**
 * Options that only apply when bdg launches Chrome, given with `--chrome-ws-url`.
 *
 * @param options - The conflicting options, e.g. ["--port", "-u"]
 */
export function chromeWsUrlConflictError(options: string[]): ErrorWithSuggestion {
  return {
    message: `${options.join(' and ')} cannot be used with --chrome-ws-url (the running Chrome already has its port and profile)`,
    suggestion: 'Drop them, or let bdg launch Chrome without --chrome-ws-url',
  };
}

/**
 * A numeric index given together with `--index`.
 *
 * @param index - The index argument
 */
export function indexWithIndexOptionError(index: string): ErrorWithSuggestion {
  return {
    message: `--index applies to a selector, but "${index}" is already an index from the last query`,
    suggestion: `Use one: bdg dom click ${index}, or bdg dom click "<selector>" --index <n>`,
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

/** Where selectors cannot look, for "not found" errors */
export const UNREACHABLE_ELEMENTS_HINT =
  'elements in closed shadow roots and cross-origin iframes cannot be reached';

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
    suggestion: 'Start a new session with: bdg <url>',
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

/**
 * The form was submitted but the wait for its result timed out.
 *
 * @param timeout - Timeout in ms
 * @param waitNavigation - Whether a navigation was awaited
 */
export function submitTimeoutError(timeout: number, waitNavigation: boolean): ErrorWithSuggestion {
  return {
    message: `Form submitted, but timed out after ${timeout}ms waiting for ${waitNavigation ? 'navigation' : 'network idle'}`,
    suggestion: waitNavigation
      ? 'The form may not navigate (e.g. it submits via fetch); retry without --wait-navigation or with a larger --timeout'
      : 'Increase --timeout, or use --wait-network 0 to return right after submitting',
  };
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
 * A cached node is gone (page navigated or the element was removed).
 *
 * @param index - Index the user gave (query or form results), if any
 */
export function staleNodeError(index?: number): ErrorWithSuggestion {
  const element = index === undefined ? 'The element' : `The element at index ${index}`;
  return {
    message: `${element} is no longer in the page (it was removed or the page navigated)`,
    suggestion: 'Re-run "bdg dom query <selector>" (or "bdg dom form") to get fresh indices',
  };
}

/**
 * Element at index not found (stale cache).
 */
export function elementAtIndexNotFoundError(index: number, selector: string): ErrorWithSuggestion {
  return {
    message: `Element at index ${index} not found`,
    suggestion: `Re-run "bdg dom query ${selector}" to refresh the cache`,
  };
}

/** Where selectors do not reach (open shadow roots and same-origin iframes are searched) */
export const CROSS_ORIGIN_FRAMES_NOTE =
  'Elements inside cross-origin iframes and closed shadow roots are not searched';

/**
 * No nodes found for selector.
 */
export function noNodesFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `No nodes found matching "${selector}"`,
    suggestion: `Verify the CSS selector is correct. ${CROSS_ORIGIN_FRAMES_NOTE}`,
  };
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
    suggestion: `Received: "${pattern}". Try: bdg dom a11y query "role:button" or "name:Submit"`,
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
 */
export function unknownQueryFieldError(field: string): ErrorWithSuggestion {
  return {
    message: `Unknown query field: "${field}"`,
    suggestion: 'Use role, name or description, e.g.: bdg dom a11y query "role:button name:Submit"',
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
 * The page was kept busy by a script (e.g. a loop started from a timer) and
 * bdg terminated it.
 *
 * @param timeoutMs - Time waited
 */
export function pageBusyError(timeoutMs: number): ErrorWithSuggestion {
  return {
    message: `The page was busy for ${Math.round(timeoutMs / 1000)}s (a script kept it running), so its scripts were terminated`,
    suggestion: 'The page is usable again; re-run the command',
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
    message: `The returned promise did not settle within ${Math.round(timeoutMs / 1000)}s`,
    suggestion: 'Check that it resolves or rejects, or race it with a timeout in the script',
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
    suggestion: `Pass an index, a name/id attribute, or part of the URL. ${LIST_FRAMES_HINT}`,
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
 * `dom eval --frame` matching more than one iframe.
 *
 * @param query - Requested frame
 * @param candidates - Matching frames
 */
export function ambiguousFrameError(query: string, candidates: DomFrame[]): ErrorWithSuggestion {
  return {
    message: `Frame "${query}" matches ${candidates.length} frames`,
    suggestion: joinLines(
      'Pick one by index or a longer part of the URL:',
      ...candidates.map((frame) => `  ${frameLabel(frame)}`)
    ),
  };
}

/**
 * An iframe without a JavaScript context (still loading, or sandboxed without scripts).
 *
 * @param url - Frame URL
 */
export function frameNotReadyError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame has no JavaScript context: ${url}`,
    suggestion: `Wait for it to load and retry (sandboxed frames without allow-scripts never get one). ${LIST_FRAMES_HINT}`,
  };
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

  const quoteCheck = detectScriptQuoteDamage(receivedScript);
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
export function noFormsFoundError(): ErrorWithSuggestion {
  return {
    message: 'No forms discovered on the page',
    suggestion:
      'Check if forms exist with: bdg dom query "form, input, [role=textbox]" or inspect the page manually',
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
