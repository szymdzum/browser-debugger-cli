/**
 * Error handling for bdg CLI.
 *
 * Provides structured error classes for CLI commands.
 */

export { CommandError, type ErrorMetadata } from './CommandError.js';

export type { IssueCode, IssueDetails } from './issues.js';

export type {
  ChromeNoticeCode,
  HintCode,
  HintDetails,
  NoticeCode,
  NoticeDetails,
  NoticeSink,
} from './notices.js';

export { isDaemonConnectionError } from './utils.js';
