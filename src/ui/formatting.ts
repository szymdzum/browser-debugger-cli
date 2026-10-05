/**
 * Shared formatting utilities for UI output.
 *
 * This module provides low-level formatting helpers used across all UI components.
 * Includes: sections, lists, key-value pairs, text utilities, time formatting,
 * and the OutputFormatter class for building complex formatted output.
 */

import { safeParseUrl } from '@/utils/url.js';

let hintsHidden = false;

/**
 * Leave tips and next-step hints out of human output (`-q`).
 */
export function hideHints(): void {
  hintsHidden = true;
}

/**
 * Whether tips and hints are left out (`-q`).
 *
 * @returns True in quiet mode
 */
export function areHintsHidden(): boolean {
  return hintsHidden;
}

/**
 * Fluent builder for constructing formatted console output.
 *
 * Provides a chainable API for building complex multi-line output with consistent
 * spacing, indentation, and structure. All methods return `this` for chaining.
 */
export class OutputFormatter {
  private lines: string[] = [];

  text(content: string): this {
    this.lines.push(content);
    return this;
  }

  blank(): this {
    this.lines.push('');
    return this;
  }

  list(items: string[], indent: number = 2): this {
    const prefix = ' '.repeat(indent);
    items.forEach((item) => this.lines.push(prefix + item));
    return this;
  }

  section(title: string, items: string[], indent: number = 2): this {
    this.lines.push(title);
    return this.list(items, indent);
  }

  /**
   * A block of tips or next steps after a blank line; left out with `-q`.
   *
   * @param title - Block title, e.g. "Next steps:"
   * @param items - Lines of the block
   * @param indent - Indentation of the lines
   */
  hints(title: string, items: string[], indent: number = 2): this {
    if (hintsHidden) return this;
    return this.blank().section(title, items, indent);
  }

  /**
   * A one-line tip; left out with `-q`.
   *
   * @param content - Tip text
   */
  tip(content: string): this {
    return hintsHidden ? this : this.text(content);
  }

  separator(char: string = '━', width: number = 50): this {
    this.lines.push(char.repeat(width));
    return this;
  }

  keyValue(key: string, value: string, keyWidth?: number): this {
    const formatted = keyWidth ? `${key}:`.padEnd(keyWidth) + value : `${key}: ${value}`;
    this.lines.push(formatted);
    return this;
  }

  keyValueList(pairs: Array<[string, string]>, keyWidth?: number): this {
    const width = keyWidth ?? Math.max(...pairs.map(([k]) => k.length)) + 2;
    pairs.forEach(([key, value]) => this.keyValue(key, value, width));
    return this;
  }

  indent(content: string, spaces: number = 2): this {
    const prefix = ' '.repeat(spaces);
    content.split('\n').forEach((line) => this.lines.push(prefix + line));
    return this;
  }

  build(): string {
    return escapeControlChars(this.lines.join('\n'));
  }
}

/**
 * Whether a character code is a control character other than tab/newline
 * (C0, DEL, C1), or a bidirectional override/isolate that can make output
 * read differently than it is (e.g. U+202E right-to-left override).
 *
 * @param code - UTF-16 code unit
 * @returns True for characters that must not reach the terminal raw
 */
function isControlChar(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Make page-provided text safe to print to a terminal.
 *
 * Console messages, titles and URLs come from the page; escape sequences in
 * them could otherwise retitle, clear or recolor the user's terminal. Control
 * characters are shown as `\uXXXX`; newlines and tabs are kept.
 *
 * @param text - Text to print
 * @returns Text with control characters escaped
 */
export function escapeControlChars(text: string): string {
  let result = '';
  for (const char of text.replace(/\r\n/g, '\n')) {
    const code = char.charCodeAt(0);
    result += isControlChar(code) ? `\\u${code.toString(16).padStart(4, '0')}` : char;
  }
  return result;
}

export function joinLines(...lines: Array<string | null | undefined | false>): string {
  return lines
    .filter((line): line is string => line !== undefined && line !== null && line !== false)
    .join('\n');
}

export function section(title: string, content: string[], indent: number = 2): string {
  const lines = [title, ...content.map((line) => ' '.repeat(indent) + line)];
  return lines.join('\n');
}

export function truncateText(text: string, maxLines: number = 3): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const truncated = lines.slice(0, maxLines).join('\n');
  const hiddenCount = lines.length - maxLines;
  return `${truncated}\n  ... (${hiddenCount} more lines)`;
}

/**
 * A URL for one line: host and path without the scheme (`www.example.com`
 * for the root), cut in the middle when too long, keeping the host, the
 * start of the path and the end of the path and query, where requests to
 * one API differ (`api.example.com/v1/users/…/orders?page=2`).
 *
 * @param url - URL
 * @param maxLength - Maximum length
 * @returns Shortened URL; non-web URLs (data:, blob:) cut at the end
 */
export function truncateUrl(url: string, maxLength: number = 60): string {
  const parsed = safeParseUrl(url);
  if (!parsed || !WEB_PROTOCOLS.has(parsed.protocol)) {
    return truncateEnd(url, maxLength);
  }
  const host = parsed.host;
  const rest = `${parsed.pathname.substring(1)}${parsed.search}`;
  const shown = parsed.pathname.length > 1 ? `${host}/${rest}` : `${host}${parsed.search}`;
  if (shown.length <= maxLength) return shown;
  const room = maxLength - host.length - 2;
  if (room < MIN_URL_END_SHOWN) return cutMiddle(shown, maxLength);
  const start = Math.floor(room / 3);
  return `${host}/${rest.substring(0, start)}…${rest.substring(rest.length - (room - start))}`;
}

/** Characters of path and query a shortened URL keeps at least besides its host */
const MIN_URL_END_SHOWN = 12;

/**
 * Cut text in the middle, marking the cut with "…".
 *
 * @param text - Text
 * @param maxLength - Maximum length
 * @returns Start and end of the text around "…"
 */
function cutMiddle(text: string, maxLength: number): string {
  const head = Math.ceil((maxLength - 1) / 2);
  return `${text.substring(0, head)}…${text.substring(text.length - (maxLength - 1 - head))}`;
}

/** Protocols whose URLs are shown as host/path (others, like data: or blob:, verbatim) */
const WEB_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * Cut text to a length, marking the cut.
 *
 * @param text - Text to cut
 * @param maxLength - Maximum length
 * @returns Text, or its start followed by "..."
 */
function truncateEnd(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? singular + 's');
  return `${count} ${word}`;
}

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
    if (remainingMs >= 100) return `${(ms / 1000).toFixed(1)}s`;
    return `${seconds}s`;
  }
  return `${ms}ms`;
}
