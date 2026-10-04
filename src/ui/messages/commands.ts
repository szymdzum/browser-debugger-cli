/**
 * Command operation messages (stop, cleanup, etc.)
 *
 * User-facing messages for command-specific operations like stopping sessions,
 * cleaning up stale files, and validating command arguments.
 */

import {
  buildAgentDiscoveryHelp,
  buildCommonTaskExamples,
  buildUrlExamples,
  buildSessionManagementReminder,
} from '@/ui/formatters/helpFormatters.js';
import { joinLines } from '@/ui/formatting.js';

/**
 * Chrome closed by `bdg stop` (gracefully, so the profile is saved).
 *
 * @param pid - Chrome process ID
 * @returns Formatted success message
 */
export function chromeClosedMessage(pid?: number): string {
  return pid ? `Closed Chrome (PID ${pid})` : 'Closed Chrome';
}

/**
 * Generate orphaned daemons cleaned message.
 *
 * @param count - Number of orphaned daemons cleaned up
 * @returns Formatted success message
 */
export function orphanedDaemonsCleanedMessage(count: number): string {
  return `Cleaned up ${count} orphaned daemon process${count === 1 ? '' : 'es'}`;
}

/**
 * Warning shown when a click falls back from mouse events to `el.click()`.
 *
 * @param reason - Why the mouse could not reach the element (e.g. "covered by another element")
 * @returns Warning text
 */
export function domClickFallbackWarning(reason: string | null | undefined): string {
  return `Element is ${reason ?? 'not reachable by the mouse'}; dispatched DOM events instead of mouse events (a user could not reach it like this)`;
}

/**
 * Note under a shortened list of matches.
 *
 * @param hidden - Matches not listed
 * @returns e.g. "... and 1174 more (use --json for all)"
 */
export function moreMatchesNote(hidden: number): string {
  return `... and ${hidden} more (use --json for all)`;
}

/**
 * Warning when a selector matched several elements and no --index was given.
 *
 * @param count - Number of matching elements
 * @param action - What was done, e.g. "clicked the first visible one"
 * @returns Warning text
 */
export function multipleMatchesWarning(count: number, action: string): string {
  return `${count} elements match; ${action} (use --index or a more specific selector)`;
}

/**
 * Headline of `bdg dom listeners`.
 *
 * @param element - Inspected element, e.g. "button#save"
 * @param count - Listeners found
 * @returns e.g. "Event listeners for button#save (3)"
 */
export function listenersHeadline(element: string, count: number): string {
  return `Event listeners for ${element} (${count})`;
}

/**
 * `bdg dom listeners` found nothing.
 *
 * @param element - Inspected element
 * @param types - Event types asked for with --type, if any
 * @returns e.g. "No click listeners on button#save, its ancestors, document or window"
 */
export function noListenersMessage(element: string, types?: string[]): string {
  const kind = types?.length ? `${types.join('/')} listeners` : 'event listeners';
  return `No ${kind} on ${element}, its ancestors, document or window`;
}

/** What `bdg dom listeners` covers, shown when it found nothing */
export const NO_LISTENERS_HINT =
  'Inline on… attributes and on… properties are included, and so are handlers frameworks delegate to ancestors (React, jQuery)';

/**
 * Note for event types handled only by ancestors, document or window.
 *
 * @param types - Event types without a listener on the element itself
 * @returns One-line note
 */
export function delegatedListenersNote(types: string[]): string {
  return `Note: ${types.join(', ')} ${types.length === 1 ? 'has' : 'have'} no listener on the element itself; frameworks like React and jQuery delegate events to a root container, document or window, so these still run for it`;
}

/**
 * A JavaScript dialog bdg accepted, as one line.
 *
 * @param dialog - Dialog type and text
 * @returns e.g. 'alert() dialog accepted: "Saved"'
 */
export function dialogConsoleText(dialog: { type: string; message: string }): string {
  const kind = dialog.type === 'beforeunload' ? 'beforeunload' : `${dialog.type}()`;
  return `${kind} dialog accepted${dialog.message ? `: "${dialog.message}"` : ''}`;
}

/** Headline of each pointer action, e.g. "Element Double-clicked" */
export const POINTER_ACTION_DONE = {
  click: 'Clicked',
  double: 'Double-clicked',
  right: 'Right-clicked',
  hover: 'Hovered',
} as const;

/** Headline of each `bdg page` action */
export const PAGE_ACTION_DONE = {
  navigate: 'Navigated',
  reload: 'Reloaded',
  back: 'Went back',
  forward: 'Went forward',
} as const;

/** Help text of the `bdg page` history commands */
export const PAGE_ACTION_DESCRIPTIONS = {
  reload: 'Reload the page',
  back: 'Go back one page (like the browser button)',
  forward: 'Go forward one page (like the browser button)',
} as const;

/**
 * `bdg page navigate` to a page that answered with an HTTP error.
 *
 * @param status - HTTP status
 * @returns Warning
 */
export function httpErrorWarning(status: number): string {
  return `The page responded with HTTP ${status}`;
}

/**
 * `bdg page navigate` to a URL that loaded no page.
 *
 * @returns Warning
 */
export function notAPageWarning(): string {
  return 'The URL did not load a page (it may be a file download); the page did not change';
}

/**
 * `bdg page` when the server did not answer in time.
 *
 * @param ms - Time waited
 * @returns Warning
 */
export function stillLoadingWarning(ms: number): string {
  return `The new page has not answered within ${Math.round(ms / 1000)}s; it is still loading (check with bdg status)`;
}

/**
 * Generate warning message.
 *
 * @param message - Warning text
 * @returns Formatted warning message
 */
export function warningMessage(message: string): string {
  return `Warning: ${message}`;
}

/**
 * Generate session files cleaned up message.
 *
 * @returns Formatted success message
 */
export function sessionFilesCleanedMessage(): string {
  return 'Session files cleaned up';
}

/**
 * Generate session output file removed message.
 *
 * @returns Formatted success message
 */
export function sessionOutputRemovedMessage(): string {
  return 'Session output file removed';
}

/**
 * Generate session directory clean message.
 *
 * @returns Formatted success message
 */
export function sessionDirectoryCleanMessage(): string {
  return 'Session directory is now clean';
}

/**
 * Generate no session files found message.
 *
 * @returns Formatted success message
 */
export function noSessionFilesMessage(): string {
  return 'No session files found. Session directory is already clean';
}

/**
 * Generate session still active error.
 *
 * @param pid - Active process ID
 * @returns Formatted error message
 */
export function sessionStillActiveError(pid: number): string {
  return `Session is still active (PID ${pid})`;
}

/**
 * Generate help message when no URL is provided to start command.
 *
 * Displays comprehensive guidance optimized for agent discovery:
 * - Agent-specific resources (machine-readable schema, CDP discovery)
 * - Complete task workflow examples
 * - URL format guidance
 * - Session management commands
 *
 * Organized to prioritize agent needs (discovery first) while maintaining
 * human readability with clear task-oriented examples.
 *
 * @returns Multi-line help message with examples
 * */
export function startCommandHelpMessage(): string {
  return joinLines(
    '',
    buildAgentDiscoveryHelp(),
    '',
    buildCommonTaskExamples(),
    '',
    buildUrlExamples(),
    '',
    buildSessionManagementReminder(),
    '',
    'Not sure which command? Start a session to see all available commands:',
    '  bdg <url>',
    ''
  );
}
