/**
 * IPC response validation utilities.
 *
 * Provides standardized error handling for IPC/CDP calls with type narrowing.
 */

import { IPCError } from '@/ipc/transport/IPCError.js';

/**
 * Base response interface for validation.
 * Both IPCResponse and ClientResponse follow this structure.
 */
interface BaseResponse {
  status: 'ok' | 'error';
  error?: string;
  data?: object;
}

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
 * @throws IPCError if response.status === 'error'
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

/**
 * Result of extracting data from an IPC response.
 * Used for type-safe extraction with error context.
 */
export type IPCDataResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Validate IPC response and extract a required field from response.data.
 *
 * Combines validation and data extraction into a single operation,
 * reducing boilerplate in command handlers.
 *
 * @param response - IPC response to validate
 * @param field - Field name to extract from response.data
 * @param fieldDescription - Human-readable description for error messages
 * @returns Extracted data or error result
 *
 * @example
 * ```typescript
 * const response = await getPeek();
 * const result = extractIPCData(response, 'preview', 'preview data');
 * if (!result.success) {
 *   return { success: false, error: result.error, exitCode: EXIT_CODES.SESSION_FILE_ERROR };
 * }
 * const output = result.data as BdgOutput;
 * ```
 */
export function extractIPCData<T extends BaseResponse>(
  response: T,
  field: string,
  fieldDescription: string
): IPCDataResult<unknown> {
  if (response.status === 'error') {
    return { success: false, error: response.error ?? 'Unknown IPC error' };
  }

  const dataObj = response.data as Record<string, unknown> | undefined;
  const data = dataObj?.[field];
  if (data === undefined || data === null) {
    return { success: false, error: `No ${fieldDescription} in response` };
  }

  return { success: true, data };
}

/**
 * Validate IPC response and extract data, throwing on any failure.
 *
 * Use this when you want exceptions rather than result objects.
 * Combines validateIPCResponse + null check into one call.
 *
 * @param response - IPC response to validate
 * @param field - Field name to extract from response.data
 * @param fieldDescription - Human-readable description for error messages
 * @returns Extracted data (never undefined)
 * @throws IPCError if response is error or field is missing
 *
 * @example
 * ```typescript
 * const response = await getDetails(type, id);
 * const item = requireIPCData(response, 'item', 'item details');
 * // item is guaranteed to exist here
 * ```
 */
export function requireIPCData<T extends BaseResponse>(
  response: T,
  field: string,
  fieldDescription: string
): unknown {
  validateIPCResponse(response);

  const dataObj = response.data as Record<string, unknown> | undefined;
  const data = dataObj?.[field];
  if (data === undefined || data === null) {
    throw new IPCError(`No ${fieldDescription} in response`);
  }

  return data;
}
