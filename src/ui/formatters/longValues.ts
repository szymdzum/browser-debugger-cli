/**
 * Long values in human output: cut, with a pointer naming `--full`.
 */

import { moreCharsNote } from '@/ui/messages/commands.js';
import { capLength } from '@/utils/strings.js';

/**
 * A value for human output: its first `maxLength` characters followed by
 * how many more there are, or all of it with `--full`.
 *
 * @param text - Value
 * @param maxLength - Characters printed
 * @param full - `--full`: print it whole
 * @returns Text to print
 */
export function capForDisplay(text: string, maxLength: number, full?: boolean): string {
  if (full) return text;
  const capped = capLength(text, maxLength);
  return capped.truncatedFrom === undefined
    ? text
    : `${capped.text}${moreCharsNote(capped.truncatedFrom - maxLength)}`;
}
