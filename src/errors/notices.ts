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
  | 'EXTERNAL_CHROME_NO_PID';

export type NoticeCode = ChromeNoticeCode;

export interface NoticeDetails<C extends NoticeCode = NoticeCode> {
  code: C;
  context?: Record<string, unknown>;
}

/**
 * Function that accepts a structured notice and routes it to a log sink
 * (typically `log.info(formatChromeNotice(notice))` at the boundary).
 */
export type NoticeSink<C extends NoticeCode = NoticeCode> = (notice: NoticeDetails<C>) => void;
