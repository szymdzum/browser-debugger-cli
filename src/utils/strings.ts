/**
 * String manipulation utilities.
 */

/**
 * Default maximum text length for truncation.
 */
const DEFAULT_MAX_LENGTH = 500;

/**
 * Truncate text to a maximum character length.
 *
 * Adds an ellipsis character when text is truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum character length (default: 500)
 * @returns Truncated text with ellipsis if needed
 */
export function truncateByLength(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * A text cut to a maximum length, with its original length when it was cut.
 */
export interface CappedText {
  /** The text, or its first `maxLength` characters */
  text: string;
  /** Original length, set only when the text was cut */
  truncatedFrom?: number;
}

/**
 * Cut a text to its first `maxLength` characters, keeping the original
 * length (the `truncatedFrom` of JSON output).
 *
 * @param text - Text to cut
 * @param maxLength - Characters kept
 * @returns The text, with `truncatedFrom` when it was cut
 */
export function capLength(text: string, maxLength: number): CappedText {
  return text.length > maxLength
    ? { text: text.slice(0, maxLength), truncatedFrom: text.length }
    : { text };
}
