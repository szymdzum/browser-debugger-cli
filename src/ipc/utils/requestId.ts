/**
 * Request ID Generation
 *
 * Utilities for generating unique request IDs for worker commands.
 */

/**
 * Generate unique request ID for worker commands.
 * Format: {prefix}_{timestamp}_{random}
 *
 * @param prefix - Command name prefix (e.g., 'worker_status', 'cdp_call')
 * @returns Unique request ID string
 *
 * @example
 * ```typescript
 * generateRequestId('worker_peek')
 * // → 'worker_peek_1699564800123_k3j2h5g9'
 *
 * generateRequestId('cdp_call')
 * // → 'cdp_call_1699564801456_m8n4p2q7'
 * ```
 */
export function generateRequestId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${timestamp}_${random}`;
}
