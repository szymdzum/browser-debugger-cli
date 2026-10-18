/**
 * Page and tab messages.
 */

import type { DialogAnswer, DialogInfo } from '@/ipc/protocol/domTypes.js';
import type { DocumentRequestState } from '@/types.js';
import { formatDuration, truncateUrl } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Log line for a dialog Chrome did not take bdg's answer for.
 *
 * @param dialog - Dialog and the answer bdg sent
 * @param reason - Chrome's error
 * @returns e.g. 'Could not answer confirm() dialog "Sure?" (dismiss): No dialog is showing'
 */
export function dialogNotAnsweredText(dialog: DialogInfo, reason: string): string {
  const kind = dialog.type === 'beforeunload' ? 'beforeunload' : `${dialog.type}()`;
  const answer = dialog.answer === 'accepted' ? 'accept' : 'dismiss';
  return `Could not answer ${kind} dialog "${dialog.message}" (${answer}): ${reason}`;
}

/**
 * The session's `--dialog` default, as `bdg status` shows it.
 *
 * @param answer - Session default
 * @returns e.g. 'dismiss (session default)'
 */
export function dialogDefaultText(answer: DialogAnswer): string {
  return `${answer} (session default)`;
}

/**
 * A dialog answered while a command ran, as its result lists it (actions,
 * `bdg <url>`, `page navigate|reload|back|forward`).
 *
 * @param dialog - Dialog type, text and answer
 * @returns e.g. 'Dialog: confirm() dismissed: "Sure?"'
 */
export function dialogResultText(dialog: DialogInfo): string {
  return `Dialog: ${dialogConsoleText(dialog, { labelled: true })}`;
}

/**
 * A JavaScript dialog bdg answered, as one line.
 *
 * @param dialog - Dialog type, text and answer
 * @param options - Leave out the word "dialog" after the type (where the line is labelled "Dialog:")
 * @returns e.g. 'alert() dialog accepted: "Saved"', 'confirm() dismissed: "Sure?"',
 *   'prompt() dialog accepted: "Name?" (answered "Ada")'
 */
export function dialogConsoleText(
  dialog: DialogInfo,
  options: { labelled?: boolean } = {}
): string {
  const kind = dialog.type === 'beforeunload' ? 'beforeunload' : `${dialog.type}()`;
  const noun = options.labelled ? '' : ' dialog';
  const message = dialog.message ? `: "${dialog.message}"` : '';
  const answered = dialog.promptText ? ` (answered "${dialog.promptText}")` : '';
  return `${kind}${noun} ${dialog.answer}${message}${answered}`;
}

/**
 * How far a pointer action scrolled the page to reach its element.
 *
 * @param scrolledBy - Page scroll (CSS px)
 * @returns e.g. `page down 1240px to reach it`, `page right 300px, up 80px to reach it`
 */
export function pointerScrollText(scrolledBy: { x: number; y: number }): string {
  const parts = [
    scrolledBy.y !== 0 && `${scrolledBy.y > 0 ? 'down' : 'up'} ${Math.abs(scrolledBy.y)}px`,
    scrolledBy.x !== 0 && `${scrolledBy.x > 0 ? 'right' : 'left'} ${Math.abs(scrolledBy.x)}px`,
  ].filter(Boolean);
  return `page ${parts.join(', ')} to reach it`;
}

/** Headline of each pointer action, e.g. "Element Double-clicked" */
export const POINTER_ACTION_DONE = {
  click: 'Clicked',
  double: 'Double-clicked',
  right: 'Right-clicked',
  hover: 'Hovered',
} as const;

/** What each pointer action is called in notes ("when the click returned") */
export const POINTER_ACTION_NOUN = {
  click: 'click',
  double: 'double-click',
  right: 'right-click',
  hover: 'hover',
} as const;

/** Headline of each `bdg page` action */
export const PAGE_ACTION_DONE = {
  navigate: 'Navigated',
  reload: 'Reloaded',
  back: 'Went back',
  forward: 'Went forward',
} as const;

/** Description of `bdg page info` */
export const PAGE_INFO_DESCRIPTION = 'Show the URL and title of the session page';

/** Description of `bdg page emulate` */
export const PAGE_EMULATE_DESCRIPTION =
  'Change the viewport or color scheme mid-session (like --viewport and --color-scheme at start), or --reset both';

/** Description of `bdg page tabs` */
export const PAGE_TABS_DESCRIPTION =
  'List the tabs and windows (index, title, URL, which one opened it); * marks the session tab';

/** Description of `bdg page switch` */
export const PAGE_SWITCH_DESCRIPTION =
  'Make another tab the session tab: DOM, actions, eval, screenshots, network and console follow it';

/** Description of `bdg page close` */
export const PAGE_CLOSE_DESCRIPTION =
  'Close a tab (the session tab by default; the session then moves to its opener)';

/** Help text of the `bdg page` history commands */
export const PAGE_ACTION_DESCRIPTIONS = {
  reload: 'Reload the page',
  back: 'Go back one page (like the browser button)',
  forward: 'Go forward one page (like the browser button)',
} as const;

/**
 * `bdg page navigate|reload|back|forward` when the document answered with an
 * error status, or the page then loaded another document that answered
 * differently (a 404 page whose script loads the app).
 *
 * @param status - HTTP status of the navigation's document
 * @param later - The last document the page loaded afterwards, if any
 * @returns Warning, or undefined when there is nothing to report
 */
export function documentStatusWarning(
  status: number,
  later?: { status: number; url: string }
): string | undefined {
  const failed = status >= 400;
  const laterFailed = later !== undefined && later.status >= 400;
  if (later && (failed || laterFailed)) {
    return `The page responded with HTTP ${status}, then loaded ${later.url} (HTTP ${later.status})`;
  }
  return failed ? `The page responded with HTTP ${status}` : undefined;
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
  return `The new page has not answered within ${Math.round(ms / 1000)}s; it is still loading (check with ${sessionCommand('bdg status')})`;
}

/**
 * How far a page request got, in words.
 *
 * @param request - The page request
 * @returns e.g. `POST …/authenticate pending for 30s`, `POST …/authenticate returned 503 Service Unavailable`,
 *   `POST …/authenticate failed (net::ERR_CONNECTION_REFUSED)`
 */
export function documentRequestText(request: DocumentRequestState): string {
  const target = `${request.method} ${truncateUrl(request.url)}`;
  if (request.errorText !== undefined) return `${target} failed (${request.errorText})`;
  if (request.status !== undefined) {
    return `${target} returned ${request.status}${request.statusText ? ` ${request.statusText}` : ''}`;
  }
  return `${target} pending for ${formatDuration(request.pendingMs ?? 0)}`;
}

/**
 * `bdg page emulate` without anything to change.
 *
 * @returns Message and suggestion
 */
export function pageEmulateNothingError(): { message: string; suggestion: string } {
  return {
    message: 'Nothing to emulate',
    suggestion:
      'Give --viewport <WxH>, --mobile, --color-scheme light|dark, or --reset, e.g. bdg page emulate --viewport 900x700',
  };
}

/**
 * Lines of `bdg page emulate`: what is emulated and what the page now has.
 *
 * @param result - Emulation and page appearance
 * @returns Label/value pairs
 */
export function pageEmulationLines(result: {
  emulated: {
    viewport?: { width: number; height: number; mobile?: boolean };
    colorScheme?: string;
  };
  viewport?: { width: number; height: number };
  colorScheme?: string;
}): Array<[string, string]> {
  const size = (v: { width: number; height: number }): string => `${v.width}x${v.height}`;
  const { emulated } = result;
  const phone = emulated.viewport?.mobile
    ? ' (phone: mobile layout, touch, mobile user agent)'
    : '';
  return [
    ['Viewport', emulated.viewport ? `${size(emulated.viewport)}${phone}` : 'the browser window'],
    ...(result.viewport
      ? [['Layout', `${size(result.viewport)} (without scrollbars)`] as [string, string]]
      : []),
    [
      'Scheme',
      emulated.colorScheme ??
        `system setting${result.colorScheme ? ` (${result.colorScheme})` : ''}`,
    ],
  ];
}
