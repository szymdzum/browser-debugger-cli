/**
 * Type Utilities
 *
 * Generic type manipulation helpers.
 */

/**
 * Remove the 'type' field from a type.
 * Useful for constructing request payloads without the type discriminator.
 *
 * @example
 * ```typescript
 * type Request = { type: 'foo_request'; value: number };
 * type Params = NoType<Request>; // { value: number }
 * ```
 */
export type NoType<T> = Omit<T, 'type'>;
