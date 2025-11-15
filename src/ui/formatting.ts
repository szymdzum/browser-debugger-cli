/**
 * Shared formatting utilities for UI output.
 *
 * This module provides low-level formatting helpers used across all UI components.
 * Includes: sections, lists, key-value pairs, text utilities, time formatting,
 * and the OutputFormatter class for building complex formatted output.
 */

import { safeParseUrl } from '@/utils/url.js';

// ============================================================================
// Output Formatter Class
// ============================================================================

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
    return this.lines.join('\n');
  }
}

// ============================================================================
// Visual/Text Utilities
// ============================================================================

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
  if (!parsed) {
    return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
  }
  const domain = parsed.hostname.replace(/^www\./, '');
  const path = parsed.pathname.substring(1);
  let result = domain + (path ? `/${path}` : '');
  if (result.length > maxLength) {
    const pathParts = path.split('/');
    if (pathParts.length > 2) {
      const first = pathParts[0];
      const last = pathParts[pathParts.length - 1];
      if (first && last) {
        result = `${domain}/${first}/.../${last}`;
        if (result.length > maxLength) {
          const truncatedLast = last.substring(0, 8);
          result = `${domain}/${first}/.../${truncatedLast}`;
        }
      }
    } else {
      result = result.substring(0, maxLength - 3) + '...';
    }
  }
  return result;
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
