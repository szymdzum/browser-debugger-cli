/**
 * Console command messages (bdg console)
 *
 * User-facing messages for the console command output and formatting.
 * */

import { joinLines } from '@/ui/formatting.js';

/**
 * Generate "no console messages found" message.
 *
 * @param filter - Optional filter type that was applied
 * @returns Formatted message with optional filter context
 *
 * @example
 * ```typescript
 * console.log(noConsoleMessagesMessage());
 * // "No console messages found"
 *
 * console.log(noConsoleMessagesMessage('error'));
 * // "No console messages found\n(filtered by type: error)"
 * ```
 */
export function noConsoleMessagesMessage(filter?: string): string {
  const base = 'No console messages found';
  return filter ? `${base}\n(filtered by type: ${filter})` : base;
}

/**
 * Generate console messages header.
 *
 * @param count - Total number of console messages
 * @param filter - Optional filter type that was applied
 * @returns Formatted header with count and optional filter info
 *
 * @example
 * ```typescript
 * console.log(consoleMessagesHeader(42));
 * // "Console messages (42 total):"
 *
 * console.log(consoleMessagesHeader(10, 'error'));
 * // "Console messages (10 total):\nFiltered by type: error"
 * ```
 */
export function consoleMessagesHeader(count: number, filter?: string): string {
  return joinLines(`Console messages (${count} total):`, filter && `Filtered by type: ${filter}`);
}
