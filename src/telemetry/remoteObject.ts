/**
 * RemoteObject formatting utilities.
 *
 * Provides functions to serialize CDP RemoteObject values into human-readable
 * strings, properly handling objects, arrays, and their preview data with
 * recursive nested object expansion.
 */

import type { Protocol } from '@/connection/typed-cdp.js';

import {
  SPECIAL_DESCRIPTION_SUBTYPES,
  formatPrimitiveValue,
  getFallbackDescription,
} from './remoteObjectUtils.js';

type PropertyPreview = Protocol.Runtime.PropertyPreview;
type ObjectPreview = Protocol.Runtime.ObjectPreview;
type RemoteObject = Protocol.Runtime.RemoteObject;

/**
 * Check if a property represents a null value.
 */
function isNullProperty(prop: PropertyPreview): boolean {
  return prop.subtype === 'null' || prop.value === 'null';
}

/**
 * Check if a property has a special subtype with meaningful string representation.
 */
function hasSpecialSubtype(prop: PropertyPreview): boolean {
  return prop.subtype === 'date' || prop.subtype === 'regexp';
}

/**
 * Format a primitive property value.
 */
function formatPrimitiveProperty(prop: PropertyPreview): string {
  if (prop.type === 'string') {
    return `"${prop.value}"`;
  }
  if (prop.type === 'undefined') {
    return 'undefined';
  }
  if (prop.type === 'symbol') {
    return prop.value ?? 'Symbol()';
  }
  if (prop.type === 'function') {
    return prop.value ?? '[Function]';
  }
  return prop.value ?? prop.type;
}

/**
 * Format a preview property value, recursively handling nested objects.
 *
 * @param prop - Preview property from CDP
 * @returns Formatted value string
 */
function formatPreviewProperty(prop: PropertyPreview): string {
  if (prop.valuePreview) {
    return formatObjectPreview(prop.valuePreview);
  }

  if (isNullProperty(prop)) {
    return 'null';
  }

  if (hasSpecialSubtype(prop)) {
    return prop.value ?? `[${prop.subtype}]`;
  }

  return formatPrimitiveProperty(prop);
}

/**
 * Format an entry value from Map/Set preview.
 *
 * @param value - Entry preview value
 * @returns Formatted value string
 */
function formatEntryValue(value: ObjectPreview): string {
  if (value.type === 'string') {
    return `"${value.description ?? ''}"`;
  }
  if (value.type === 'object' && value.properties) {
    return formatObjectPreview(value);
  }
  return value.description ?? value.type;
}

/**
 * Extract size from description string like "Map(3)" or "Set(5)".
 */
function extractSizeFromDescription(description: string | undefined): string {
  return description?.match(/\d+/)?.[0] ?? '0';
}

/**
 * Format a Map preview.
 */
function formatMapPreview(preview: ObjectPreview, suffix: string): string {
  const entries = preview.entries ?? [];
  if (entries.length === 0) {
    return `Map(${extractSizeFromDescription(preview.description)})`;
  }
  const formattedEntries = entries.map((e) => {
    const key = e.key ? formatEntryValue(e.key) : '?';
    const value = formatEntryValue(e.value);
    return `${key} => ${value}`;
  });
  return `Map(${entries.length}) {${formattedEntries.join(', ')}${suffix}}`;
}

/**
 * Format a Set preview.
 */
function formatSetPreview(preview: ObjectPreview, suffix: string): string {
  const entries = preview.entries ?? [];
  if (entries.length === 0) {
    return `Set(${extractSizeFromDescription(preview.description)})`;
  }
  const formattedEntries = entries.map((e) => formatEntryValue(e.value));
  return `Set(${entries.length}) {${formattedEntries.join(', ')}${suffix}}`;
}

/**
 * Format an array preview.
 */
function formatArrayPreview(props: PropertyPreview[], suffix: string): string {
  const values = props
    .filter((p) => !isNaN(Number(p.name)))
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map(formatPreviewProperty);
  return `[${values.join(', ')}${suffix}]`;
}

/**
 * Format a regular object preview.
 */
function formatRegularObjectPreview(props: PropertyPreview[], suffix: string): string {
  const pairs = props.map((p) => `${p.name}: ${formatPreviewProperty(p)}`);
  return `{${pairs.join(', ')}${suffix}}`;
}

/**
 * Format object preview as a string representation.
 *
 * Recursively formats nested objects using their valuePreview data,
 * matching Chrome DevTools console output format.
 *
 * @param preview - Object preview from CDP RemoteObject
 * @returns Formatted object string like `{foo: "bar", num: 123}`
 */
function formatObjectPreview(preview: ObjectPreview): string {
  const props = preview.properties ?? [];
  const suffix = preview.overflow ? ', …' : '';

  if (SPECIAL_DESCRIPTION_SUBTYPES.has(preview.subtype ?? '')) {
    return preview.description ?? `[${preview.subtype}]`;
  }

  if (preview.subtype === 'map') {
    return formatMapPreview(preview, suffix);
  }
  if (preview.subtype === 'set') {
    return formatSetPreview(preview, suffix);
  }
  if (preview.subtype === 'array') {
    return formatArrayPreview(props, suffix);
  }

  return formatRegularObjectPreview(props, suffix);
}

/**
 * Format a CDP RemoteObject as a human-readable string.
 *
 * Handles all CDP value types including primitives, objects, arrays,
 * errors, null, and undefined. Uses preview data when available for
 * rich object representation with recursive nested object expansion.
 *
 * @param arg - CDP RemoteObject from console arguments
 * @returns Formatted string representation
 *
 * @example
 * ```typescript
 * formatRemoteObject({ type: 'string', value: 'hello' }) // 'hello'
 * formatRemoteObject({
 *   type: 'object',
 *   preview: { properties: [{ name: 'foo', value: 'bar' }] }
 * }) // '{foo: "bar"}'
 * ```
 */
export function formatRemoteObject(arg: RemoteObject): string {
  if (arg.value !== undefined) {
    return formatPrimitiveValue(arg.value);
  }

  if (arg.type === 'undefined') {
    return 'undefined';
  }

  if (arg.subtype === 'error' && arg.description) {
    return arg.description;
  }

  if (arg.type === 'object' && arg.preview) {
    return formatObjectPreview(arg.preview);
  }

  return getFallbackDescription(arg);
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
export function formatConsoleArgs(args: RemoteObject[]): string {
  return args.map(formatRemoteObject).join(' ');
}
