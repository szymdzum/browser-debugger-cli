/**
 * Structured output building for CLI commands.
 */

import type { BdgResponse } from '@/types.js';
import { VERSION } from '@/utils/version.js';

/**
 * Build a success response envelope.
 *
 * @param data - Response payload
 * @returns `{ version, success: true, data }`
 */
export function buildSuccessResponse<T>(data: T): BdgResponse<T> {
  return { version: VERSION, success: true, data };
}

/** Builders for JSON error envelopes. */
export class OutputBuilder {
  /**
   * Build an error response envelope.
   *
   * Envelope fields in `options` cannot override `version`, `success` or `error`.
   *
   * @param error - Error or message
   * @param options - Exit code, suggestion and extra context fields
   * @returns `{ version, success: false, error, ...options }`
   */
  static buildJsonError(
    error: string | Error,
    options?: { exitCode?: number; suggestion?: string; context?: Record<string, string> }
  ): Record<string, unknown> {
    const {
      version: _version,
      success: _success,
      error: _error,
      ...rest
    } = (options ?? {}) as Record<string, unknown>;
    return {
      version: VERSION,
      success: false,
      error: error instanceof Error ? error.message : error,
      ...rest,
    };
  }
}
