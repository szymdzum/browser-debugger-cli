/**
 * What `bdg dom wait` waits for, and whether what the page shows meets it.
 *
 * The page reports a {@link WaitSnapshot} whenever it changes; the condition
 * is decided here, in one place.
 */

/** What to wait for */
export interface WaitCondition {
  /** Selector (filters like :has-text and :visible allowed); absent when only waiting for the load */
  selector?: string;
  /** Text one of the matches must contain (case-insensitive, whitespace collapsed) */
  text?: string;
  /** Wait for the (visible, with `visible`) matches to be gone */
  gone?: boolean;
  /** Only count visible matches */
  visible?: boolean;
  /** Also wait for `document.readyState` to be `complete` */
  load?: boolean;
}

/** What the page shows at one moment */
export interface WaitSnapshot {
  /** Elements matching the selector */
  count: number;
  /** Of those, the ones containing the text (all of them without a text) */
  textCount: number;
  /** Of the text matches, the visible ones */
  visibleCount: number;
  /** `document.readyState` */
  readyState: string;
  /** The document's identity (`performance.timeOrigin`): a new document after a navigation has another */
  documentId: number;
}

/**
 * The text as the page compares it: whitespace collapsed, lower case (like `:has-text`).
 *
 * @param text - Text as given
 * @returns Normalized text
 */
export function normalizeWaitText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The matches the condition counts: visible ones with `visible`, else those
 * containing the text (all matches without a text).
 *
 * @param snapshot - What the page shows
 * @param condition - What is waited for
 * @returns Number of counted matches
 */
export function countedMatches(snapshot: WaitSnapshot, condition: WaitCondition): number {
  return condition.visible ? snapshot.visibleCount : snapshot.textCount;
}

/**
 * Whether the page shows what is waited for.
 *
 * Elements are gone only when two consecutive snapshots of the same
 * document, neither of it still `loading`, show none: right after a
 * navigation commits, the new document is empty for a moment.
 *
 * @param snapshot - What the page shows
 * @param condition - What is waited for
 * @param previous - The snapshot before it, if any
 * @returns True when the elements are there (or gone with `gone`) and, with `load`, the page loaded
 */
export function isWaitConditionMet(
  snapshot: WaitSnapshot,
  condition: WaitCondition,
  previous?: WaitSnapshot
): boolean {
  if (condition.load && snapshot.readyState !== 'complete') return false;
  if (condition.selector === undefined) return true;
  if (!condition.gone) return countedMatches(snapshot, condition) > 0;
  if (previous?.documentId !== snapshot.documentId) return false;
  return showsNoneSettled(previous, condition) && showsNoneSettled(snapshot, condition);
}

/**
 * Whether a `--gone` wait should confirm this snapshot with another one: it
 * shows no (counted) matches in a document past `loading`.
 *
 * @param snapshot - What the page shows
 * @param condition - What is waited for
 * @returns True when one more snapshot of the same document may meet the condition
 */
export function needsGoneConfirmation(snapshot: WaitSnapshot, condition: WaitCondition): boolean {
  if (!condition.gone || condition.selector === undefined) return false;
  if (condition.load && snapshot.readyState !== 'complete') return false;
  return showsNoneSettled(snapshot, condition);
}

/**
 * No counted matches, in a document that is no longer `loading`.
 *
 * @param snapshot - What the page shows
 * @param condition - What is waited for
 * @returns True when nothing counted matches in a settled document
 */
function showsNoneSettled(snapshot: WaitSnapshot, condition: WaitCondition): boolean {
  return snapshot.readyState !== 'loading' && countedMatches(snapshot, condition) === 0;
}
