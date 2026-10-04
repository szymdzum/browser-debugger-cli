/**
 * Shared formatting utilities for UI output.
 *
 * This module provides low-level formatting helpers used across all UI components.
 * Includes: sections, lists, key-value pairs, text utilities, time formatting,
 * and the OutputFormatter class for building complex formatted output.
 */

import { safeParseUrl } from '@/utils/url.js';

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
 * (C0, DEL, C1).
 *
 * @param code - UTF-16 code unit
 * @returns True for characters that must not reach the terminal raw
 */
function isControlChar(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
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

export function truncateUrl(url: string, maxLength: number = 60): string {
  const parsed = safeParseUrl(url);
  if (!parsed || !WEB_PROTOCOLS.has(parsed.protocol)) {
    return truncateEnd(url, maxLength);
  }
  const host = parsed.host.replace(/^www\./, '');
  const path = parsed.pathname.substring(1);
  const full = `${host}${path ? `/${path}` : ''}`;
  if (`${full}${parsed.search}`.length <= maxLength) return `${full}${parsed.search}`;
  const queryMark = parsed.search ? '?…' : '';
  const withoutQuery = `${full}${queryMark}`;
  if (withoutQuery.length <= maxLength) return withoutQuery;
  return `${shortenPath(host, path, maxLength - queryMark.length)}${queryMark}`;
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

/**
 * Shorten a long host/path by eliding its middle segments.
 *
 * @param host - Host (with port)
 * @param path - Path without the leading slash
 * @param maxLength - Maximum length
 * @returns e.g. "example.com/docs/.../page"
 */
function shortenPath(host: string, path: string, maxLength: number): string {
  const parts = path.split('/');
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length <= 2 || !first || !last) return truncateEnd(`${host}/${path}`, maxLength);
  const elided = `${host}/${first}/.../${last}`;
  return elided.length <= maxLength ? elided : `${host}/${first}/.../${last.substring(0, 8)}`;
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
