/**
 * Typed notice contract for structured informational logging.
 *
 * Parallel to {@link IssueDetails} but for happy-path events: core modules
 * emit `NoticeDetails`, the UI boundary formats them into user-facing text.
 * A `NoticeSink` lets core stay free of `@/ui/messages` imports.
 *
 * Add new codes here as slices migrate away from raw string log messages.
 */

export type ChromeNoticeCode =
  | 'EXTERNAL_CHROME_CONNECTING'
  | 'EXTERNAL_CHROME_WS_URL'
  | 'EXTERNAL_CHROME_NO_PID'
  | 'EXTERNAL_CHROME_SKIP_TERMINATION';

/**
 * Hint codes: soft suggestions surfaced to the caller alongside a result.
 * Distinct from notices conceptually but share the same transport shape.
 */
export type HintCode = 'PATTERN_HINT';

export type NoticeCode = ChromeNoticeCode;

export interface HintDetails<C extends HintCode = HintCode> {
  code: C;
  context?: Record<string, unknown>;
}

export interface NoticeDetails<C extends NoticeCode = NoticeCode> {
  code: C;
  context?: Record<string, unknown>;
}

/**
 * Function that accepts a structured notice and routes it to a log sink
 * (typically `log.info(formatChromeNotice(notice))` at the boundary).
 */
export type NoticeSink<C extends NoticeCode = NoticeCode> = (notice: NoticeDetails<C>) => void;
