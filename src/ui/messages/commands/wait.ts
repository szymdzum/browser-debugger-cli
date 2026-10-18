/**
 * Wait messages.
 */

import type { WaitCondition, WaitSnapshot } from '@/runtime/dom/waitCondition.js';
import { joinLines, pluralize } from '@/ui/formatting.js';

/**
 * Help of `dom click`/`submit`: they wait for the network only, so results a
 * page shows later (timers, spinners, animations) are waited for with `dom wait`.
 */
export const CLICK_RESULT_WAIT_HELP = joinLines(
  '',
  'Waits only for the requests the action starts (150 ms idle, up to 2 s), not for',
  'results the page shows later (timers, spinners, animations); the result says',
  '"page still changing" when it saw such work pending. Wait for those with:',
  "  bdg dom wait '#result' --visible          # or --text 'Saved', or '.spinner' --gone"
);

/** Help of `bdg dom fill` after its options: how text is entered, and what it shows */
export const FILL_RESULT_HELP = joinLines(
  '',
  'Text fields get the value typed like a user (trusted input events), so the browser',
  'applies minlength: a shorter value is filled with a warning and blocks the submit;',
  'a value over maxlength is refused (exit 81). A value set by script instead (the',
  'field had no focus) says so in a warning. If the page moves the focus and the text',
  'lands in another field, the fill fails (exit 90) naming that field. Secret fields',
  '(passwords, one-time codes, card data, names like api_key, token or pass: the',
  'fields dom query masks) show Value: ••••.'
);

/** Examples in the help of `bdg dom wait` */
export const WAIT_HELP_EXAMPLES = joinLines(
  '',
  'Examples:',
  "  bdg dom wait '#finish' --visible          # timer-based loading (a spinner, then the result)",
  "  bdg dom wait '.toast' --text 'Saved'      # a match containing the text",
  "  bdg dom wait '#loading' --gone            # the spinner went away",
  '  bdg dom wait --load                       # the page finished loading'
);

/**
 * The elements `bdg dom wait` waits for.
 *
 * @param condition - What is waited for
 * @returns e.g. `#finish with text "hello world"`
 */
export function waitTargetLabel(condition: WaitCondition): string {
  const text = condition.text !== undefined ? ` with text "${condition.text}"` : '';
  return `${condition.selector ?? 'the page'}${text}`;
}

/**
 * One-line result of `bdg dom wait`.
 *
 * @param condition - What was waited for
 * @param elapsedMs - How long it took
 * @returns e.g. `✓ div#finish visible after 5.1s`
 */
export function waitMetMessage(condition: WaitCondition, elapsedMs: number): string {
  const after = `after ${(elapsedMs / 1000).toFixed(1)}s`;
  if (condition.selector === undefined) return `✓ Page loaded ${after}`;
  const state = condition.gone
    ? condition.visible
      ? 'hidden'
      : 'gone'
    : condition.visible
      ? 'visible'
      : 'found';
  const loaded = condition.load ? ' and page loaded' : '';
  return `✓ ${waitTargetLabel(condition)} ${state}${loaded} ${after}`;
}

/**
 * What the page showed, for a `bdg dom wait` that timed out.
 *
 * @param snapshot - Last thing the page reported
 * @param condition - What was waited for
 * @returns e.g. `2 matches, none visible` or `document.readyState: loading`
 */
export function waitSnapshotSummary(snapshot: WaitSnapshot, condition: WaitCondition): string {
  const some = (count: number): string => (count === 0 ? 'none' : String(count));
  const parts: string[] = [];
  if (condition.selector !== undefined) {
    parts.push(snapshot.count === 0 ? 'no matches' : pluralize(snapshot.count, 'match', 'matches'));
    if (condition.text !== undefined && snapshot.count > 0) {
      parts.push(`${some(snapshot.textCount)} with text "${condition.text}"`);
    }
    if (condition.visible && snapshot.textCount > 0) {
      parts.push(`${some(snapshot.visibleCount)} visible`);
    }
  }
  if (condition.load || snapshot.readyState !== 'complete') {
    parts.push(`document.readyState: ${snapshot.readyState}`);
  }
  return parts.join(', ');
}
