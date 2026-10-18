/**
 * Where a logpoint goes: `file:line[:col]` as typed, and the pattern that
 * matches the file among the page's script URLs.
 */

/** A parsed `file:line[:col]` */
export interface LogpointLocation {
  /** File as typed: a path suffix (`app.js`, `src/app.js`) or a full URL */
  file: string;
  /** 1-based line */
  line: number;
  /** 1-based column, when given */
  column?: number;
}

/**
 * Parse `file:line[:col]`: the last one or two `:number` parts are the line
 * and column, so `http://host:8080/app.js:5` and `C:\src\app.js:5:12` keep
 * their colons in the file.
 *
 * @param text - Argument as typed
 * @returns Location, or undefined when it has no line or a line or column below 1
 */
export function parseLogpointLocation(text: string): LogpointLocation | undefined {
  const match = /^(.+?):(\d+)(?::(\d+))?$/.exec(text);
  if (!match) return undefined;
  const [, file = '', lineText = '', columnText] = match;
  const line = Number(lineText);
  const column = columnText === undefined ? undefined : Number(columnText);
  if (line < 1 || (column !== undefined && column < 1)) return undefined;
  return { file, line, ...(column !== undefined && { column }) };
}

/**
 * Escape text for a regular expression.
 *
 * @param text - Literal text
 * @returns Source matching the text exactly
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regular expression source matching the script URLs a file argument names:
 * the URL ends with the file (whole path segments only), its `?query` and
 * `#hash` ignored, and a file with characters that URLs encode matches both
 * spellings. For Chrome's `urlRegex` and, as a `RegExp`, for bdg's own match.
 *
 * @param file - File as typed
 * @returns Regular expression source
 */
export function scriptUrlPattern(file: string): string {
  const path = file.replace(/\\/g, '/');
  const spellings = [...new Set([path, encodeURI(path)])].map(escapeRegex);
  return `(^|/)(?:${spellings.join('|')})(?:[?#].*)?$`;
}

/**
 * Where a logpoint is, as typed.
 *
 * @param file - File as typed
 * @param line - Line
 * @param column - Column
 * @returns e.g. `app.js:5` or `app.js:5:12`
 */
export function logpointPlace(file: string, line: number, column?: number): string {
  return `${file}:${line}${column === undefined ? '' : `:${column}`}`;
}
