/**
 * Base response interface for validation.
 * Both IPCResponse and ClientResponse follow this structure.
 */
interface BaseResponse {
  status: 'ok' | 'error';
  error?: string;
}

import { IPCError } from '@/ipc/transport/IPCError.js';

/**
 * Response type with success status.
 * Used for type narrowing after validation.
 */
type SuccessResponse<T extends BaseResponse> = T & { status: 'ok' };

/**
 * Validate IPC response and throw on error.
 * Standardizes error handling for all IPC/CDP calls.
 *
 * This function:
 * - Checks if response.status === 'error'
 * - Throws Error with response.error message if present
 * - Narrows TypeScript type to exclude error status after validation
 *
 * Works with both IPCResponse (legacy) and ClientResponse (new) types.
 *
 * @param response - IPC or CDP response from daemon
 * @throws Error if response.status === 'error'
 *
 * @example
 * ```typescript
 * const response = await callCDP('Network.getCookies', params);
 * validateIPCResponse(response); // Throws if error
 * // TypeScript now knows response.status === 'ok'
 * const cookies = response.data?.result.cookies;
 * ```
 */
export function validateIPCResponse<T extends BaseResponse>(
  response: T
): asserts response is SuccessResponse<T> {
  if (response.status === 'error') {
    throw new IPCError(response.error ?? 'Unknown IPC error');
  }
}
