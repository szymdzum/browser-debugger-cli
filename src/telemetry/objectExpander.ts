/**
 * Object expansion utilities for CDP RemoteObjects.
 *
 * Fetches nested object properties using Runtime.getProperties to provide
 * rich object representations beyond CDP's default shallow preview.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import {
  OBJECT_EXPANSION_MAX_DEPTH,
  OBJECT_EXPANSION_MAX_PROPERTIES,
  OBJECT_EXPANSION_FAILURE_THRESHOLD,
} from '@/constants.js';
import { createLogger } from '@/ui/logging/index.js';

import {
  isPrimitiveObject,
  hasSpecialDescription,
  getFallbackDescription,
  formatPrimitiveValue,
} from './remoteObjectUtils.js';

type RemoteObject = Protocol.Runtime.RemoteObject;
type PropertyDescriptor = Protocol.Runtime.PropertyDescriptor;

const log = createLogger('object-expander');

let consecutiveFailures = 0;

/**
 * Reset the failure counter (useful for testing).
 */
export function resetFailureCounter(): void {
  consecutiveFailures = 0;
}

/**
 * Record an expansion failure and log warning if threshold exceeded.
 */
function recordFailure(error: unknown): void {
  consecutiveFailures++;
  if (consecutiveFailures === OBJECT_EXPANSION_FAILURE_THRESHOLD) {
    log.info(
      `Object expansion failed ${OBJECT_EXPANSION_FAILURE_THRESHOLD} times consecutively. ` +
        `CDP connection may be unstable. Last error: ${String(error)}`
    );
  } else {
    log.debug(`Failed to expand object: ${String(error)}`);
  }
}

/**
 * Record a successful expansion (resets failure counter).
 */
function recordSuccess(): void {
  consecutiveFailures = 0;
}

/**
 * Format a primitive RemoteObject value for expansion output.
 * Quotes strings to distinguish them from other values in object context.
 */
function formatExpandedPrimitive(arg: RemoteObject): string {
  if (arg.value !== undefined) {
    if (typeof arg.value === 'string') {
      return `"${arg.value}"`;
    }
    return formatPrimitiveValue(arg.value);
  }
  return 'undefined';
}

/**
 * Fetch object properties from CDP.
 */
async function fetchProperties(
  cdp: CDPConnection,
  objectId: string
): Promise<PropertyDescriptor[]> {
  const response = await cdp.send('Runtime.getProperties', {
    objectId,
    ownProperties: true,
    generatePreview: true,
  });
  const result = response as { result: PropertyDescriptor[] };
  return result.result ?? [];
}

/**
 * Filter properties to enumerable ones with values.
 */
function getEnumerableProperties(properties: PropertyDescriptor[]): PropertyDescriptor[] {
  return properties
    .filter((p) => p.enumerable && p.value)
    .slice(0, OBJECT_EXPANSION_MAX_PROPERTIES);
}

/**
 * Check if property count exceeds limit.
 */
function hasOverflow(
  properties: PropertyDescriptor[],
  filterFn: (p: PropertyDescriptor) => boolean
): boolean {
  return properties.filter(filterFn).length > OBJECT_EXPANSION_MAX_PROPERTIES;
}

/**
 * Format array items from properties.
 */
async function formatArrayItems(
  cdp: CDPConnection,
  properties: PropertyDescriptor[],
  depth: number
): Promise<string[]> {
  const items: string[] = [];
  const ownProps = getEnumerableProperties(properties);

  for (const prop of ownProps) {
    if (!isNaN(Number(prop.name)) && prop.value) {
      const formatted = await expandRemoteObject(cdp, prop.value, depth + 1);
      items.push(formatted);
    }
  }
  return items;
}

/**
 * Format object pairs from properties.
 */
async function formatObjectPairs(
  cdp: CDPConnection,
  properties: PropertyDescriptor[],
  depth: number
): Promise<string[]> {
  const pairs: string[] = [];
  const ownProps = getEnumerableProperties(properties);

  for (const prop of ownProps) {
    if (prop.value) {
      const formatted = await expandRemoteObject(cdp, prop.value, depth + 1);
      pairs.push(`${prop.name}: ${formatted}`);
    }
  }
  return pairs;
}

/**
 * Format an array RemoteObject.
 */
async function formatArray(
  cdp: CDPConnection,
  properties: PropertyDescriptor[],
  depth: number
): Promise<string> {
  const items = await formatArrayItems(cdp, properties, depth);
  const overflow = hasOverflow(properties, (p) => !isNaN(Number(p.name)));
  return `[${items.join(', ')}${overflow ? ', …' : ''}]`;
}

/**
 * Format a regular object RemoteObject.
 */
async function formatObject(
  cdp: CDPConnection,
  properties: PropertyDescriptor[],
  depth: number
): Promise<string> {
  const pairs = await formatObjectPairs(cdp, properties, depth);
  const overflow = hasOverflow(properties, (p) => p.enumerable === true);
  return `{${pairs.join(', ')}${overflow ? ', …' : ''}}`;
}

/**
 * Expand a RemoteObject to get nested property values.
 *
 * Recursively fetches properties up to MAX_DEPTH levels deep,
 * providing rich object representation for console output.
 *
 * @param cdp - CDP connection for property fetching
 * @param arg - RemoteObject to expand
 * @param depth - Current recursion depth
 * @returns Formatted string representation with expanded properties
 */
export async function expandRemoteObject(
  cdp: CDPConnection,
  arg: RemoteObject,
  depth: number = 0
): Promise<string> {
  if (isPrimitiveObject(arg)) {
    return formatExpandedPrimitive(arg);
  }

  if (hasSpecialDescription(arg)) {
    return arg.description ?? getFallbackDescription(arg);
  }

  if (!arg.objectId || depth >= OBJECT_EXPANSION_MAX_DEPTH) {
    return getFallbackDescription(arg);
  }

  try {
    const properties = await fetchProperties(cdp, arg.objectId);
    recordSuccess();

    if (arg.subtype === 'array') {
      return await formatArray(cdp, properties, depth);
    }

    return await formatObject(cdp, properties, depth);
  } catch (error) {
    recordFailure(error);
    return getFallbackDescription(arg);
  }
}

/**
 * Expand multiple RemoteObjects and format as console message text.
 *
 * @param cdp - CDP connection for property fetching
 * @param args - Array of RemoteObjects to expand
 * @returns Formatted string with expanded objects
 */
export async function expandConsoleArgs(cdp: CDPConnection, args: RemoteObject[]): Promise<string> {
  const expanded = await Promise.all(args.map((arg) => expandRemoteObject(cdp, arg)));
  return expanded.join(' ');
}
