/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

export * from './messages/session.js';
export * from './messages/selectors.js';
export * from './messages/usage.js';
export * from './messages/cdp.js';
export * from './messages/screenshot.js';
export * from './messages/sessionStart.js';
export * from './messages/attach.js';
export * from './messages/domActions.js';
export * from './messages/wait.js';
export * from './messages/domRead.js';
export * from './messages/network.js';
export * from './messages/eval.js';
export * from './messages/tabs.js';
export {
  NO_MATCH_PREFIX,
  NO_MATCH_SUFFIX,
  noMatchMessage,
  A11Y_NAME_QUERY_EXAMPLE,
  pageStillLoadingHint,
  withLoadingHint,
} from './messages/shared.js';
export type { ErrorWithSuggestion } from './messages/shared.js';
