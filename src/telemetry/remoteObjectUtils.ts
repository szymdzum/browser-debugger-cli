/**
 * Shared utilities for RemoteObject type checking and formatting.
 *
 * Provides common predicates and formatters used by both synchronous
 * preview-based formatting and asynchronous CDP-based expansion.
 */

import type { Protocol } from '@/connection/typed-cdp.js';

type RemoteObject = Protocol.Runtime.RemoteObject;

/**
 * Subtypes that have meaningful description strings from CDP.
 */
export const SPECIAL_DESCRIPTION_SUBTYPES = new Set(['date', 'regexp', 'error', 'promise']);

/**
 * Check if a RemoteObject is a primitive that can be formatted directly.
 */
export function isPrimitiveObject(arg: RemoteObject): boolean {
  return arg.value !== undefined || arg.type === 'undefined';
}

/**
 * Check if a RemoteObject has a special subtype with meaningful description.
 */
export function hasSpecialDescription(arg: RemoteObject): boolean {
  return SPECIAL_DESCRIPTION_SUBTYPES.has(arg.subtype ?? '') && arg.description !== undefined;
}

/**
 * Get fallback string representation for a RemoteObject.
 */
export function getFallbackDescription(arg: RemoteObject): string {
  return arg.description ?? `[${arg.type}]`;
}

/**
 * Format a primitive value consistently across sync and async paths.
 * Note: String primitives in console output are NOT quoted (matches Chrome DevTools behavior).
 */
export function formatPrimitiveValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return JSON.stringify(value);
}

/**
 * Check if a preview property has unexpanded nested objects.
 * CDP shows nested objects as just "Object" without valuePreview.
 */
function hasUnexpandedNestedObjects(preview: Protocol.Runtime.ObjectPreview): boolean {
  const props = preview.properties ?? [];
  return props.some((p) => p.type === 'object' && !p.valuePreview && p.value === 'Object');
}

/**
 * Check if preview data is fully expanded (not truncated and no shallow nested objects).
 */
export function isPreviewFullyExpanded(arg: RemoteObject): boolean {
  if (!arg.preview) {
    return false;
  }
  if (arg.preview.overflow) {
    return false;
  }
  return !hasUnexpandedNestedObjects(arg.preview);
}

/**
 * Check if an object needs async expansion.
 * Expand if: has objectId, is not null, and preview is missing, truncated, or has unexpanded nested objects.
 */
export function needsAsyncExpansion(arg: RemoteObject): boolean {
  if (arg.type !== 'object' || !arg.objectId || arg.subtype === 'null') {
    return false;
  }
  return !isPreviewFullyExpanded(arg);
}
