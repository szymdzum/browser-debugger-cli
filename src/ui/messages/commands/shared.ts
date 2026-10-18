/**
 * Shared messages.
 */

import type { PageLoadingState, PendingRequestInfo } from '@/ipc/protocol/commands.js';
import { formatDuration, truncateUrl } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { truncateByLength } from '@/utils/strings.js';

/**
 * Field labels as a list (without a trailing colon), the first five and how
 * many more.
 *
 * @param labels - Field labels
 * @returns e.g. "Last Name, Zip"
 */
export function fieldLabelList(labels: string[]): string {
  const shown = labels
    .slice(0, 5)
    .map((label) => label.replace(/\s*:\s*$/, ''))
    .join(', ');
  return labels.length > 5 ? `${shown} and ${labels.length - 5} more` : shown;
}

/**
 * The descendant showing a `visibility: hidden` element's content, for
 * `bdg dom layout` and `bdg dom inspect`.
 *
 * @param element - Description of the descendant
 * @returns e.g. "shown by span#label (visibility: visible)"
 */
export function shownByText(element: string): string {
  return `shown by ${element} (visibility: visible)`;
}

/**
 * A mask over an element, for `dom layout` and `dom inspect`.
 *
 * @param masked - The mask, e.g. `mask-image on div.hero`
 * @returns e.g. `masked by mask-image on div.hero`
 */
export function maskedText(masked: string): string {
  return `masked by ${masked}`;
}

/**
 * Warning that the session's page crashed, for `bdg status`, `bdg peek`,
 * `bdg console` and `bdg network list`.
 *
 * @param crashedAt - When it crashed (epoch ms)
 * @returns e.g. `⚠ The page crashed at 18:42:10 (renderer gone); bdg page reload brings it back`
 */
export function pageCrashedNote(crashedAt: number): string {
  return `⚠ The page crashed at ${new Date(crashedAt).toLocaleTimeString()} (renderer gone); ${sessionCommand('bdg page reload')} brings it back`;
}

/**
 * A request the page is still waiting for.
 *
 * @param request - Pending request
 * @returns e.g. `GET code.jquery.com/ui/.../jquery-ui.js (pending 30s)`
 */
export function pendingRequestLabel(request: PendingRequestInfo): string {
  return `${request.method} ${truncateUrl(request.url)} (pending ${formatDuration(request.pendingMs)})`;
}

/**
 * Requests still running, the longest-running first, in words.
 *
 * @param pending - The requests to name
 * @param count - All requests still running
 * @returns e.g. `GET …/app.js (pending 30s) and 2 more`
 */
export function pendingRequestsText(pending: PendingRequestInfo[], count: number): string {
  const more = count - pending.length;
  return `${pending.map(pendingRequestLabel).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * Start and `bdg page` when the document has not finished loading within
 * the readiness wait: its readyState and the requests it is waiting on.
 *
 * @param state - Loading state of the page
 * @returns Warning, e.g. `The page is still loading (document.readyState: loading); waiting on: GET …/jquery-ui.js (pending 30s)`
 */
export function pageLoadingWarning(state: PageLoadingState): string {
  const waitingOn =
    state.pending.length > 0
      ? `; waiting on: ${pendingRequestsText(state.pending, state.pendingCount)}`
      : '';
  return `The page is still loading (document.readyState: ${state.readyState})${waitingOn}. Elements may be missing until it finishes: ${sessionCommand('bdg dom wait <selector>')} waits for one`;
}

/** Longest frame URL shown in human output (JSON has the full URL) */
export const FRAME_URL_MAX_LENGTH = 100;

/**
 * A frame URL for human output: shortened, and named when empty.
 *
 * @param url - Frame URL
 * @returns e.g. `https://pay.example/checkout?…`, or `(no URL)`
 */
export function frameUrlLabel(url: string): string {
  return url ? truncateByLength(url, FRAME_URL_MAX_LENGTH) : '(no URL)';
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
 * `details` field of `bdg --help --json`: where the full help is.
 *
 * @returns Note
 */
export function helpJsonDetailsNote(): string {
  return 'Option behaviors, defaults, choices and examples: bdg <command> --help --json (e.g. bdg dom query --help --json). Everything at once: bdg --help --json --full';
}
