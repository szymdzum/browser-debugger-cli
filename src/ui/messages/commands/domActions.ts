/**
 * DOM action messages.
 */

import type {
  ActionError,
  AlsoChanging,
  ControlChange,
  DownloadInfo,
  FillValueMismatch,
  FormSubmit,
  NewMessage,
  PageNavigation,
  ShownElement,
} from '@/ipc/protocol/domTypes.js';
import { shortUrlName } from '@/ui/formatters/console/shared.js';
import { formatBytes } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Warning shown when a click falls back from mouse events to `el.click()`.
 *
 * @param reason - Why the mouse could not reach the element (e.g. "covered by div#shield")
 * @returns Warning text
 */
export function domClickFallbackWarning(reason: string | null | undefined): string {
  return `Element is ${reason ?? 'not reachable by the mouse'}; dispatched DOM events instead of mouse events (a user could not reach it like this)`;
}

/**
 * Why the mouse cannot reach a `display: contents` element (a `<slot>`): it
 * has no box to aim at, completing "Element is …" in
 * {@link domClickFallbackWarning} and the `--strict` refusal.
 */
export const NO_BOX_CLICK_REASON =
  'not a mouse target itself (display: contents, no box of its own)';

/** Reason of a `bdg dom form` blocker for a required field left empty */
export const REQUIRED_FIELD_EMPTY_REASON = 'Required field is empty';

/**
 * An element an action showed, for its `Shown:` rows.
 *
 * @param element - Shown element
 * @returns e.g. `div.figcaption "name: user2 View profile"`
 */
export function shownElementText(element: ShownElement): string {
  return `${element.element} "${element.text}"`;
}

/**
 * How an action changed the page's location, for its `Page:` row.
 *
 * @param navigation - Navigation the action caused
 * @returns e.g. "navigated to https://example.com/secure (200)" or
 *   "URL changed to https://example.com/#/active (same document)"
 */
export function pageNavigationText(navigation: PageNavigation): string {
  if (navigation.sameDocument) return `URL changed to ${navigation.url} (same document)`;
  const status = navigation.status === undefined ? '' : ` (${navigation.status})`;
  return `navigated to ${navigation.url}${status}`;
}

/**
 * A download an action started, as its output line reads.
 *
 * @param download - Download
 * @returns e.g. `Download: report.txt → /Users/me/.bdg/downloads/report.txt (completed, 15 B)`,
 *   `Download: big.zip → … (inProgress, 9.8 KB so far)` (no size before the first
 *   bytes), `Download: report.txt (canceled)`
 */
export function downloadText(download: DownloadInfo): string {
  const where = download.path === undefined ? '' : ` → ${download.path}`;
  const running = download.state === 'inProgress';
  const bytes =
    download.bytes === undefined || (running && download.bytes === 0)
      ? ''
      : `, ${formatBytes(download.bytes)}${running ? ' so far' : ''}`;
  const reason = download.reason === undefined ? '' : `: ${download.reason}`;
  return `Download: ${download.suggestedFilename}${where} (${download.state}${bytes}${reason})`;
}

/**
 * The session's downloads in one line: how many, and the last one.
 *
 * @param downloads - Downloads, oldest first (at least one)
 * @returns e.g. `2 (last: report.txt → /Users/me/.bdg/downloads/report.txt, completed)`
 */
export function downloadsSummary(downloads: DownloadInfo[]): string {
  const last = downloads[downloads.length - 1];
  if (!last) return '0';
  const where = last.path === undefined ? '' : ` → ${last.path}`;
  return `${downloads.length} (last: ${last.suggestedFilename}${where}, ${last.state})`;
}

/**
 * Warning while Chrome did not take bdg's download behavior, so downloads
 * are not saved in the session directory.
 *
 * @param detail - Chrome's error
 * @returns Warning shown by `bdg status`
 */
export function downloadsNotRedirectedWarning(detail: string): string {
  return `downloads are not redirected to the session directory (Chrome refused the download behavior: ${detail}); Chrome saves them in its default folder, usually ~/Downloads`;
}

/**
 * Why downloads are refused when the session's downloads directory could not
 * be created.
 *
 * @param detail - What went wrong, e.g. `/home/me/.bdg/downloads is a file`
 * @returns Reason recorded on each refused download
 */
export function downloadsDirUnavailableReason(detail: string): string {
  return `bdg's downloads directory could not be created (${detail}), so downloads are refused`;
}

/**
 * Last `New text:`, `Shown:` or `Also changing:` row when an action made more messages or elements appear (or change) than are listed.
 *
 * @param count - Messages or elements not listed
 * @param partial - The count is a minimum
 * @returns e.g. `(+4 more)`, `(+4 or more)`
 */
export function moreMessagesText(count: number, partial = false): string {
  return `(+${count} ${partial ? 'or ' : ''}more)`;
}

/**
 * Last `Shown:` row when elements are left out or the scan stopped early.
 *
 * @param count - Elements not listed (0 when none were counted)
 * @param partial - The page stopped looking at its time budget
 * @returns e.g. `(+4 more)`, `(+4 or more)`, `(scan cut short: more may be there)`
 */
export function moreShownText(count: number, partial = false): string {
  return count > 0 ? moreMessagesText(count, partial) : '(scan cut short: more may be there)';
}

/**
 * An error's text with its source shortened ({@link shortUrlName}), without
 * its count.
 *
 * @param error - Reported error
 * @param sources - Distinct sources that shorten to the same name (noted when more than one)
 * @returns e.g. `Uncaught Error: handler exploded (app.js:3:142)`
 */
function shortErrorText(error: ActionError, sources = 1): string {
  if (error.source === undefined) return error.text;
  const [, url = error.source, position = ''] = /^(.*?)((?::\d+){2})?$/.exec(error.source) ?? [];
  const more = sources > 1 ? `, ${sources} sources` : '';
  return `${error.text} (${shortUrlName(url)}${position}${more})`;
}

/**
 * An action's `Errors:` rows: errors whose text and shortened source are the
 * same (different URLs with the same last path segment) on one row, their
 * counts added and their sources counted (#653).
 *
 * @param errors - Reported errors
 * @returns e.g. `[2x] Failed to load resource (event, 2 sources)`
 */
export function actionErrorRows(errors: ActionError[]): string[] {
  const rows = new Map<string, { error: ActionError; count: number; sources: number }>();
  for (const error of errors) {
    const key = shortErrorText(error);
    const row = rows.get(key);
    if (row) {
      row.count += error.count;
      row.sources++;
    } else rows.set(key, { error, count: error.count, sources: 1 });
  }
  return [...rows.values()].map(({ error, count, sources }) => {
    const repeats = count > 1 ? `[${count}x] ` : '';
    return `${repeats}${shortErrorText(error, sources)}`;
  });
}

/**
 * Line of the elements an action added or removed when nothing else says what
 * it changed.
 *
 * @param nodes - Elements added or removed
 * @returns e.g. `DOM changed (200 nodes)`
 */
export function domChangedText(nodes: number): string {
  return `DOM changed (${nodes} nodes)`;
}

/**
 * Line of an `aria-expanded` flip.
 *
 * @param expanded - Value after the press
 * @returns e.g. `Expanded: true`
 */
export function expandedText(expanded: boolean): string {
  return `Expanded: ${expanded}`;
}

/**
 * Line of a fill whose `input` handler moved focus away from the field.
 *
 * @param element - Element focus is on now
 * @returns e.g. `Focus moved to: input#other`
 */
export function focusMovedText(element: string): string {
  return `Focus moved to: ${element}`;
}

/**
 * Warning shown when the mouse was released on another element than the one
 * pressed (the page moved or replaced it while the mouse was down).
 *
 * @param releasedOn - Element that received the release, e.g. `button#next`
 * @returns Warning text
 */
export function releasedElsewhereWarning(releasedOn: string): string {
  if (/^(body|html)$/.test(releasedOn)) {
    return `The mouse was released outside any element (on the ${releasedOn}), not on the clicked element: the page changed under the pointer while it was pressed; check what the page did`;
  }
  return `The mouse was released on ${releasedOn}, not on the clicked element: the page changed under the pointer while it was pressed; check what the page did`;
}

/**
 * Last `Errors:` row when console errors from filtered tracker hosts were
 * left out (a session started with `--capture-all` lists them).
 *
 * @param count - Errors left out
 * @returns e.g. `(+2 from filtered trackers)`
 */
export function hiddenTrackerErrorsText(count: number): string {
  return `(+${count} from filtered trackers)`;
}

/**
 * The `Errors:` row of an action whose only errors came from filtered
 * trackers.
 *
 * @param count - Errors left out
 * @returns e.g. `none from the page (2 from filtered trackers hidden; bdg console --level error)`
 */
export function onlyTrackerErrorsText(count: number): string {
  return `none from the page (${count} from filtered trackers hidden; bdg console --level error)`;
}

/**
 * Line of an action that fired a form submit.
 *
 * @param submitted - The submit
 * @returns e.g. `Form submitted (cancelled by the page): form#login`
 */
export function formSubmittedText(submitted: FormSubmit): string {
  const how = submitted.cancelled ? ' (cancelled by the page)' : '';
  return `Form submitted${how}: ${submitted.form}`;
}

/**
 * Line of a pressed button's own change.
 *
 * @param change - The change
 * @returns e.g. `Button changed: disabled, "Sending…"`
 */
export function controlChangeText(change: ControlChange): string {
  const parts = [
    ...(change.disabled !== undefined ? [change.disabled ? 'disabled' : 'enabled'] : []),
    ...(change.text !== undefined ? [JSON.stringify(change.text)] : []),
  ];
  return `Button changed: ${parts.join(', ')}`;
}

/**
 * `Activated:` value of a key press that clicked an element.
 *
 * @param element - Element clicked, e.g. `button#plain`
 * @returns e.g. `button#plain (the key clicked it)`
 */
export function activatedText(element: string): string {
  return `${element} (the key clicked it)`;
}

/**
 * Last `Errors:` row when an action caused more distinct errors than are listed.
 *
 * @param count - Distinct errors not listed
 * @returns e.g. `+2 more (bdg console --level error)`
 */
export function moreErrorsText(count: number): string {
  return `+${count} more (${sessionCommand('bdg console --level error')})`;
}

/** Result line of `bdg dom hover --off` */
export const HOVER_OFF_DONE =
  '✓ Mouse moved off the page (hover styles and menus that close on mouseleave are gone)';

/** How `bdg dom hover` is called */
export const HOVER_USAGE =
  'bdg dom hover <selector|index>, or bdg dom hover --off to move the mouse away';

/**
 * A message an action made appear, for its `New text:` rows.
 *
 * @param message - New message
 * @returns e.g. `"Your password is invalid!" (div#flash.flash.error)`
 */
export function newMessageText(message: NewMessage): string {
  return `"${message.text}" (${message.element})`;
}

/**
 * A region the page was changing right before the action, for its
 * `Also changing:` rows.
 *
 * @param region - The region, with its text when it is a message
 * @returns e.g. `aside#ticker "tick 51" (changing before the action)`, `ul#list (changing before the action)`
 */
export function alsoChangingText(region: AlsoChanging): string {
  const text = region.text === undefined ? '' : ` "${region.text}"`;
  return `${region.element}${text} (changing before the action)`;
}

/**
 * Read-back of a fill whose value the page did not keep, the message of
 * the exit 90 error (`valueMismatchError`): the value read back is not the one given:
 * cut to its maxlength, a secret field (one `dom query` masks) whose value
 * has another length (values never shown), or another value (naming the
 * field the value went to, when one has it).
 *
 * @param mismatch - Value given and value found (masked for secret fields)
 * @returns Warning text
 */
export function valueMismatchWarning(mismatch: FillValueMismatch): string {
  if (mismatch.truncatedTo !== undefined) {
    return `The value was cut to ${mismatch.truncatedTo} characters by maxlength`;
  }
  if (mismatch.masked) {
    return 'The page kept another value than the one filled (secret field, value not shown); it may have rejected or changed the input';
  }
  const outcome =
    mismatch.movedTo === undefined
      ? 'the page may have rejected or moved the input'
      : `the value appeared in ${mismatch.movedTo} instead`;
  return `The field's value is "${mismatch.actual}" after filling (expected "${mismatch.expected}"); ${outcome}`;
}

/**
 * Warning shown when a page cancelled the `beforeinput` event `dom fill`
 * fired (a rich editor rejecting the text); the value is set anyway.
 */
export const FILL_BEFOREINPUT_CANCELLED_WARNING =
  'The page cancelled beforeinput (it may reject typed text); the value was set anyway, so check the page took it';

/**
 * Warning shown when `dom fill` entered a value shorter than the field's
 * `minlength` (the browser applies it to the value, as to typed text).
 *
 * @param minLength - The field's minlength
 * @returns Warning text
 */
export function fillTooShortWarning(minLength: number): string {
  return `The value is shorter than the field's minlength (${minLength}); the form will not submit until it is fixed`;
}

/** Why `dom fill` set a text field's value by script instead of typing it, by key */
const FILL_NOT_TYPED_REASONS = {
  noFocus: 'the field did not take the focus',
  unfocused: 'the field lost the focus before bdg typed',
  failed: 'typing failed',
  lost: 'the typed text did not reach the field',
} as const;

/**
 * Key of a reason `dom fill` set a text field's value by script; `cancelled`
 * (the page cancelled `beforeinput`) has its own warning
 */
export type FillNotTypedReason = 'cancelled' | keyof typeof FILL_NOT_TYPED_REASONS;

/**
 * Warning shown when `dom fill` set a text field's value by script instead
 * of typing it; a cancelled `beforeinput` keeps its own wording
 * ({@link FILL_BEFOREINPUT_CANCELLED_WARNING}).
 *
 * @param reason - Why it was not typed
 * @returns Warning text
 */
export function fillNotTypedWarning(reason: FillNotTypedReason): string {
  if (reason === 'cancelled') return FILL_BEFOREINPUT_CANCELLED_WARNING;
  return `The value was set by script, not typed (${FILL_NOT_TYPED_REASONS[reason]}), so the browser does not apply minlength to it`;
}

/**
 * Warning shown when a mouse press was dispatched but the target never
 * received it (e.g. a browser dialog or bubble captured the input).
 *
 * @param nextStep - Command that shows what is in the way
 * @returns Warning text
 */
export function clickNotReceivedWarning(nextStep: string): string {
  return `The click may not have reached the element: the page saw no mouse press (the browser may be showing a dialog or bubble that captures input); see what is in the way with ${nextStep}`;
}

/**
 * Warning shown when a mouse press was dispatched but landed on another
 * element (e.g. an overlay that appeared as the mouse moved onto the target).
 *
 * @param landedOn - The element the press landed on, e.g. `div#overlay`
 * @param nextStep - Command that shows what is in the way
 * @returns Warning text
 */
export function clickLandedElsewhereWarning(landedOn: string, nextStep: string): string {
  return `The click may not have reached the element: the press landed on ${landedOn}; see what is in the way with ${nextStep}`;
}

/**
 * Warning shown when the page removed the clicked element while the mouse
 * was pressed, so it got no click (a re-render on pointerdown).
 *
 * @returns Warning text
 */
export function clickTargetReplacedWarning(): string {
  return 'The click may not have reached the element: the page replaced it while the mouse was pressed, so it got no click; find it again and check what the page did';
}
