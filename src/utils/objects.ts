/**
 * Filter out undefined values from an object, returning only defined properties.
 *
 * This utility removes properties with undefined values from an object, which is
 * useful for building configuration objects where undefined values should be
 * completely omitted rather than passed as undefined. Common use cases include
 * API payloads, configuration merging, and type-safe object construction.
 *
 * Type safety: Returns Record\<string, unknown\> to maintain soundness. Since the
 * function cannot statically determine which properties will be undefined at runtime,
 * using a more precise type would be unsound and could lead to runtime errors.
 *
 * @param obj - Object with potentially undefined values
 * @returns New object with only defined values (Record\<string, unknown\> type for soundness)
 *
 * @example
 * ```typescript
 * const config = filterDefined({
 *   name: 'test',
 *   value: undefined,
 *   count: 0
 * });
 * // Result: { name: 'test', count: 0 }
 * // Type: Record<string, unknown>
 *
 * // Callers should type-assert when they know the structure
 * const typed = config as { name: string; count: number };
 * ```
 *
 * @remarks
 * The return type is intentionally imprecise (Record\<string, unknown\>) because
 * TypeScript cannot statically determine which properties will be undefined at
 * runtime. This prevents type system lies where a property appears required but
 * is actually missing at runtime. Callers should use type assertions when they
 * have runtime knowledge of the structure.
 */
export function filterDefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
