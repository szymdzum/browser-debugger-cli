/**
 * Shared formatting utilities for UI output.
 *
 * This module provides low-level formatting helpers used across all UI components.
 * Includes: separators, sections, lists, key-value pairs, text utilities, and time formatting.
 */

import { safeParseUrl } from '@/utils/url.js';

// ============================================================================
// Visual Elements
// ============================================================================

/**
 * Create a horizontal separator line.
 *
 * @param char - Character to use for separator (default: '━')
 * @param width - Width of separator in characters (default: 50)
 * @returns Separator string
 *
 * @example
 * ```typescript
 * separator()        // → '━━━━━━...' (50 chars)
 * separator('-', 20) // → '--------------------'
 * ```
 */
export function separator(char: string = '━', width: number = 50): string {
  return char.repeat(width);
}

// ============================================================================
// Section Builders
// ============================================================================

/**
 * Create a titled section with content lines.
 *
 * @param title - Section title
 * @param content - Array of content lines (will be indented)
 * @param indent - Number of spaces to indent content (default: 2)
 * @returns Formatted section string
 *
 * @example
 * ```typescript
 * section('Process Info:', [
 *   'Daemon PID: 12345',
 *   'Chrome PID: 67890'
 * ])
 * // →
 * // Process Info:
 * //   Daemon PID: 12345
 * //   Chrome PID: 67890
 * ```
 */
export function section(title: string, content: string[], indent: number = 2): string {
  const lines = [title, ...content.map((line) => ' '.repeat(indent) + line)];
  return lines.join('\n');
}

/**
 * Create a bullet list with optional indentation.
 *
 * @param items - Array of list items
 * @param indent - Number of spaces to indent (default: 2)
 * @param bullet - Bullet character (default: '-')
 * @returns Formatted bullet list
 *
 * @example
 * ```typescript
 * bulletList(['Item 1', 'Item 2'], 2, '•')
 * // →
 * //   • Item 1
 * //   • Item 2
 * ```
 */
export function bulletList(items: string[], indent: number = 2, bullet: string = '-'): string {
  const prefix = ' '.repeat(indent) + bullet + ' ';
  return items.map((item) => prefix + item).join('\n');
}

/**
 * Create a key-value pair with alignment.
 *
 * @param key - Key string
 * @param value - Value string
 * @param keyWidth - Width to pad key to (default: auto)
 * @returns Formatted key-value pair
 *
 * @example
 * ```typescript
 * keyValue('Status', 'Active', 15)
 * // → 'Status:         Active'
 * ```
 */
export function keyValue(key: string, value: string, keyWidth?: number): string {
  if (keyWidth) {
    return `${key}:`.padEnd(keyWidth) + value;
  }
  return `${key}: ${value}`;
}

// ============================================================================
// Text Utilities
// ============================================================================

/**
 * Indent text by a number of spaces.
 *
 * @param text - Text to indent (can be multiline)
 * @param spaces - Number of spaces to indent
 * @returns Indented text
 *
 * @example
 * ```typescript
 * indent('Line 1\nLine 2', 4)
 * // →
 * //     Line 1
 * //     Line 2
 * ```
 */
export function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/**
 * Truncate text to maximum length with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 *
 * @example
 * ```typescript
 * truncate('Very long text here', 10)
 * // → 'Very lo...'
 * ```
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Truncate console message text (especially stack traces).
 *
 * @param text - The console message text
 * @param maxLines - Maximum number of lines to show (default: 3)
 * @returns Truncated text with line count
 *
 * @example
 * ```typescript
 * truncateText('Line 1\nLine 2\nLine 3\nLine 4\nLine 5', 3)
 * // →
 * // Line 1
 * // Line 2
 * // Line 3
 * //   ... (2 more lines)
 * ```
 */
export function truncateText(text: string, maxLines: number = 3): string {
  const lines = text.split('\n');

  if (lines.length <= maxLines) {
    return text;
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  const hiddenCount = lines.length - maxLines;

  return `${truncated}\n  ... (${hiddenCount} more lines)`;
}

/**
 * Truncate a URL for compact display.
 *
 * Removes www. prefix, shortens long paths with ellipsis, and truncates to maxLength.
 *
 * @param url - URL string to truncate
 * @param maxLength - Maximum length of output (default: 60)
 * @returns Truncated URL for display
 *
 * @example
 * ```typescript
 * truncateUrl('https://i.clarity.ms/collect')
 *   // → 'clarity.ms/collect'
 * truncateUrl('https://aswpapius.com/api/web-channels/47d7def8-d602-49ec-bfdb-c959b1346774')
 *   // → 'aswpapius.com/.../47d7def8'
 * ```
 */
export function truncateUrl(url: string, maxLength: number = 60): string {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    // Fallback: simple string truncation if URL parsing fails
    return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
  }

  // Remove www. prefix
  const domain = parsed.hostname.replace(/^www\./, '');

  // Get path without leading slash
  const path = parsed.pathname.substring(1);

  // Start with domain + path
  let result = domain + (path ? `/${path}` : '');

  // If still too long, truncate the path
  if (result.length > maxLength) {
    const pathParts = path.split('/');
    if (pathParts.length > 2) {
      // Show first part, ellipsis, and last part
      const first = pathParts[0];
      const last = pathParts[pathParts.length - 1];
      if (first && last) {
        result = `${domain}/${first}/.../${last}`;

        // If still too long, truncate the last part
        if (result.length > maxLength) {
          const truncatedLast = last.substring(0, 8);
          result = `${domain}/${first}/.../${truncatedLast}`;
        }
      }
    } else {
      // Simple truncation
      result = result.substring(0, maxLength - 3) + '...';
    }
  }

  return result;
}

/**
 * Pluralize a word based on count.
 *
 * @param count - Number of items
 * @param singular - Singular form of word
 * @param plural - Plural form of word (optional, defaults to singular + 's')
 * @returns Formatted count with correct word form
 *
 * @example
 * ```typescript
 * pluralize(1, 'request')       // → '1 request'
 * pluralize(5, 'request')       // → '5 requests'
 * pluralize(0, 'entry', 'entries') // → '0 entries'
 * ```
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? singular + 's');
  return `${count} ${word}`;
}

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format duration in milliseconds to human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(1500)      // → '1.5s'
 * formatDuration(65000)     // → '1m 5s'
 * formatDuration(3661000)   // → '1h 1m'
 * ```
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  if (seconds > 0) {
    const remainingMs = ms % 1000;
    if (remainingMs >= 100) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${seconds}s`;
  }

  return `${ms}ms`;
}

/**
 * Format timestamp to ISO string.
 *
 * @param date - Date object or timestamp
 * @returns ISO 8601 formatted string
 *
 * @example
 * ```typescript
 * formatTimestamp(new Date())
 * // → '2025-11-05T12:34:56.789Z'
 * ```
 */
export function formatTimestamp(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toISOString();
}

/**
 * Format relative time ("time ago").
 *
 * @param date - Date object or timestamp
 * @returns Human-readable relative time
 *
 * @example
 * ```typescript
 * formatTimeAgo(Date.now() - 5000)     // → '5 seconds ago'
 * formatTimeAgo(Date.now() - 65000)    // → '1 minute ago'
 * formatTimeAgo(Date.now() - 3661000)  // → '1 hour ago'
 * ```
 */
export function formatTimeAgo(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) {
    return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
