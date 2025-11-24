/**
 * RemoteObject formatting utilities.
 *
 * Provides functions to serialize CDP RemoteObject values into human-readable
 * strings, properly handling objects, arrays, and their preview data.
 */

import type { Protocol } from '@/connection/typed-cdp.js';

/**
 * Format a preview property value.
 *
 * @param prop - Preview property from CDP
 * @returns Formatted value string
 */
function formatPreviewProperty(prop: Protocol.Runtime.PropertyPreview): string {
  if (prop.type === 'string') {
    return `"${prop.value}"`;
  }
  if (prop.type === 'undefined') {
    return 'undefined';
  }
  if (prop.value === 'null') {
    return 'null';
  }
  // For objects, functions, symbols - use the value as-is (e.g., "Object", "[Function]")
  return prop.value ?? prop.type;
}

/**
 * Format object preview as a string representation.
 *
 * @param preview - Object preview from CDP RemoteObject
 * @returns Formatted object string like `{foo: "bar", num: 123}`
 */
function formatObjectPreview(preview: Protocol.Runtime.ObjectPreview): string {
  const props = preview.properties ?? [];

  // Handle arrays
  if (preview.subtype === 'array') {
    const values = props
      .filter((p) => !isNaN(Number(p.name))) // Only numeric indices
      .sort((a, b) => Number(a.name) - Number(b.name))
      .map((p) => formatPreviewProperty(p));

    const suffix = preview.overflow ? ', …' : '';
    return `[${values.join(', ')}${suffix}]`;
  }

  // Handle regular objects
  const pairs = props.map((p) => `${p.name}: ${formatPreviewProperty(p)}`);
  const suffix = preview.overflow ? ', …' : '';
  return `{${pairs.join(', ')}${suffix}}`;
}

/**
 * Format a CDP RemoteObject as a human-readable string.
 *
 * Handles all CDP value types including primitives, objects, arrays,
 * errors, null, and undefined. Uses preview data when available for
 * rich object representation.
 *
 * @param arg - CDP RemoteObject from console arguments
 * @returns Formatted string representation
 *
 * @example
 * ```typescript
 * // Primitive
 * formatRemoteObject({ type: 'string', value: 'hello' }) // 'hello'
 *
 * // Object with preview
 * formatRemoteObject({
 *   type: 'object',
 *   preview: { properties: [{ name: 'foo', value: 'bar' }] }
 * }) // '{foo: "bar"}'
 *
 * // Array with preview
 * formatRemoteObject({
 *   type: 'object',
 *   subtype: 'array',
 *   preview: { properties: [{ name: '0', value: '1' }] }
 * }) // '[1]'
 * ```
 */
export function formatRemoteObject(arg: Protocol.Runtime.RemoteObject): string {
  // Handle primitives with direct value
  if (arg.value !== undefined) {
    if (typeof arg.value === 'string') {
      return arg.value;
    }
    if (typeof arg.value === 'number' || typeof arg.value === 'boolean') {
      return String(arg.value);
    }
    if (arg.value === null) {
      return 'null';
    }
    // For other values (shouldn't happen often), stringify
    return JSON.stringify(arg.value);
  }

  // Handle undefined
  if (arg.type === 'undefined') {
    return 'undefined';
  }

  // Handle errors - use full description which includes stack trace
  if (arg.subtype === 'error' && arg.description) {
    return arg.description;
  }

  // Handle objects/arrays with preview
  if (arg.type === 'object' && arg.preview) {
    return formatObjectPreview(arg.preview);
  }

  // Fallback to description or type
  return arg.description ?? `[${arg.type}]`;
}

/**
 * Format multiple RemoteObjects as console message text.
 *
 * Joins formatted arguments with spaces, similar to how console.log
 * displays multiple arguments.
 *
 * @param args - Array of CDP RemoteObjects
 * @returns Joined formatted string
 */
export function formatConsoleArgs(args: Protocol.Runtime.RemoteObject[]): string {
  return args.map(formatRemoteObject).join(' ');
}
