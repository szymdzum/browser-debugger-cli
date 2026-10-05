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
 * @param snapshot - What the page shows
 * @param condition - What is waited for
 * @returns True when the elements are there (or gone with `gone`) and, with `load`, the page loaded
 */
export function isWaitConditionMet(snapshot: WaitSnapshot, condition: WaitCondition): boolean {
  if (condition.load && snapshot.readyState !== 'complete') return false;
  if (condition.selector === undefined) return true;
  const counted = countedMatches(snapshot, condition);
  return condition.gone ? counted === 0 : counted > 0;
}
