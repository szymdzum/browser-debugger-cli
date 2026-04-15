/**
 * Typed issue contract for structured error reporting.
 *
 * Core modules attach `IssueDetails` to thrown errors so callers can format
 * them deterministically. The `message` field on the error stays as a
 * fallback for consumers that don't branch on the code.
 *
 * Add new codes here as vertical slices migrate away from raw string messages.
 */

export type IssueCode =
  | 'PORT_IN_USE'
  | 'INVALID_PORT'
  | 'USER_DATA_DIR_CREATE_FAILED'
  | 'CHROME_LAUNCH_FAILED'
  | 'CHROME_DIED_AFTER_LAUNCH'
  | 'NO_PAGE_TARGET_FOUND'
  | 'CHROME_BINARY_NOT_FOUND'
  | 'CHROME_BINARY_NOT_EXECUTABLE'
  | 'CHROME_BINARY_IS_DIRECTORY'
  | 'PREFS_FILE_NOT_FOUND'
  | 'PREFS_INVALID_FORMAT'
  | 'PREFS_LOAD_FAILED'
  | 'PREFS_NOT_JSON_SERIALIZABLE';

export interface IssueDetails {
  code: IssueCode;
  context?: Record<string, unknown>;
  suggestion?: string;
}
