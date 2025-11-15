/**
 * Session Utilities
 *
 * Helper functions for session ID generation and message enrichment.
 */

import { randomUUID } from 'crypto';

/**
 * Generate a unique session ID.
 *
 * @returns Random UUID v4
 *
 * @example
 * ```typescript
 * const sessionId = generateSessionId();
 * // '550e8400-e29b-41d4-a716-446655440000'
 * ```
 */
export function generateSessionId(): string {
  return randomUUID();
}

/**
 * Add session ID to a payload.
 * Creates a new object with sessionId field.
 *
 * @param payload - Payload object to enrich
 * @returns Payload with sessionId added
 *
 * @example
 * ```typescript
 * const request = withSession({ type: 'status_request' });
 * // { type: 'status_request', sessionId: '550e8400-...' }
 * ```
 */
export function withSession<T extends { type: string }>(payload: T): T & { sessionId: string } {
  return { ...payload, sessionId: generateSessionId() } as T & { sessionId: string };
}
