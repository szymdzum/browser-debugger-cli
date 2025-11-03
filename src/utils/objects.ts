/**
 * Filter out undefined values from an object, returning only defined properties.
 *
 * This utility removes properties with undefined values from an object, which is
 * useful for building configuration objects where undefined values should be
 * completely omitted rather than passed as undefined. Common use cases include
 * API payloads, configuration merging, and type-safe object construction.
 *
 * @param obj - Object with potentially undefined values
 * @returns New object with only defined values, no undefined properties
 *
 * @example
 * ```typescript
 * const config = filterDefined({
 *   name: 'test',
 *   value: undefined,
 *   count: 0
 * });
 * // Result: { name: 'test', count: 0 }
 * ```
 */
export function filterDefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
