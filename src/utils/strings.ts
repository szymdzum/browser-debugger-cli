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
