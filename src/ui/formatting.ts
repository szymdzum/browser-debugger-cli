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
    const label = key === '' ? '' : `${key}:`;
    const formatted = keyWidth ? label.padEnd(keyWidth) + value : `${key}: ${value}`;
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
  return text
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Control characters other than tab and newline (C0, DEL, C1), and the
 * bidirectional overrides and isolates that can make output read differently
 * than it is (e.g. U+202E right-to-left override). Replacing
 * matches builds the result in one pass: appending the characters one by
 * one left a rope node per character, 32 bytes each (a 250 MB `bdg cdp`
 * reply took over 4 GB).
 */
const CONTROL_CHARS = /(?![\t\n])\p{Cc}|[\u202a-\u202e\u2066-\u2069]/gu;

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
  const rest = rawPathAndQuery(url, parsed);
  const shown = rest.startsWith('?') || rest === '' ? `${host}${rest}` : `${host}/${rest}`;
  if (shown.length <= maxLength) return shown;
  const room = maxLength - host.length - 2;
  if (room < MIN_URL_END_SHOWN) return cutMiddle(shown, maxLength);
  const start = Math.floor(room / 3);
  return `${host}/${rest.substring(0, start)}…${rest.substring(rest.length - (room - start))}`;
}

/** Characters of path and query a shortened URL keeps at least besides its host */
const MIN_URL_END_SHOWN = 12;

/** Scheme and authority of an absolute URL, and `#fragment` */
const URL_AUTHORITY = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*\/?/i;

/**
 * The path and query of a URL as written (not re-encoded by `URL`, so a
 * masked token stays `••••`), without the leading slash and the fragment.
 * A URL written without a scheme (`localhost:3000/x`) gives the parsed form.
 *
 * @param url - URL as written
 * @param parsed - The URL parsed
 * @returns Path and query, e.g. `search?q=1`, `?q=1` for the root, or empty
 */
function rawPathAndQuery(url: string, parsed: URL): string {
  if (!URL_AUTHORITY.test(url)) return `${parsed.pathname.substring(1)}${parsed.search}`;
  return url.replace(URL_AUTHORITY, '').replace(/#.*$/s, '');
}

/**
 * Cut text in the middle, marking the cut with "…" (text that fits is
 * returned as is).
 *
 * @param text - Text
 * @param maxLength - Maximum length
 * @returns Text, or its start and end around "…"
 */
export function cutMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
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

/**
 * Format a byte count for humans.
 *
 * @param bytes - Byte count
 * @returns e.g. "512 B", "12.3 KB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Format a byte count in mebibytes (1024 x 1024 bytes).
 *
 * @param bytes - Byte count
 * @param fractionDigits - Digits after the point
 * @returns e.g. "50 MiB", "12.3 MiB"
 */
export function formatMiB(bytes: number, fractionDigits = 1): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${fractionDigits === 0 ? Math.round(mebibytes) : mebibytes.toFixed(fractionDigits)} MiB`;
}
