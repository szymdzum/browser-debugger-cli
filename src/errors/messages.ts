/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

import * as path from 'path';

import { escapeControlChars, formatDuration, joinLines } from '@/ui/formatting.js';
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

/**
 * CSS selector rejected by the browser.
 *
 * @param selector - Selector as given
 * @param detail - Browser error, if any
 * @returns Message and suggestion
 */
export function invalidSelectorError(selector: string, detail?: string): ErrorWithSuggestion {
  return {
    message: `Invalid CSS selector: ${selector}${detail ? ` (${detail})` : ''}`,
    suggestion: 'Check the selector syntax, e.g. bdg dom query "button.primary"',
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
 */
export function outputFileError(filePath: string, reason: string): ErrorWithSuggestion {
  const example = `output${path.extname(filePath) || '.png'}`;
  return {
    message: `Cannot write ${filePath}: ${reason}`,
    suggestion: `Choose a writable file path, e.g. ./${example} or /tmp/${example}`,
  };
}

/**
 * An empty output path.
 */
export function emptyOutputPathError(): ErrorWithSuggestion {
  return {
    message: 'The output path is empty',
    suggestion: 'Give a file name, e.g. output.png or capture.har',
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
 * Element not accessible (a11y).
 */
export function elementNotAccessibleError(index: number): ErrorWithSuggestion {
  return {
    message: `Element at index ${index} not accessible`,
    suggestion: 'Re-run query to refresh cache',
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
  } else {
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
  const originNote = crossOrigin
    ? 'Cross-origin iframe - cannot inspect directly'
    : 'Same-origin iframe - use frame commands to access';
  return {
    message: `Form is inside an iframe: ${iframeUrl}`,
    suggestion: crossOrigin
      ? `${originNote}. Manual interaction required for cross-origin frames.`
      : `${originNote}. Try: bdg dom frame list, then bdg dom frame attach <id>`,
  };
}
