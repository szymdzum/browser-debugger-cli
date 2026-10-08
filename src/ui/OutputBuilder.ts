/**
 * Structured output building for CLI commands.
 */

import type { BdgResponse } from '@/types.js';
import { VERSION } from '@/utils/version.js';

/**
 * Build a success response envelope.
 *
 * @param data - Response payload
 * @param warning - Warning about how the command ran, if any
 * @returns `{ version, success: true, data }`, plus `warning` when given
 */
export function buildSuccessResponse<T>(data: T, warning?: string): BdgResponse<T> {
  return { version: VERSION, success: true, data, ...(warning && { warning }) };
}

/**
 * Serialize a `--json` response envelope for stdout.
 *
 * Indented by two spaces when stdout is a terminal, so a person can read it;
 * on one line otherwise, since agents and pipes only pay for the whitespace.
 *
 * @param envelope - Response envelope (or other `--json` payload)
 * @returns JSON text
 */
export function stringifyEnvelope(envelope: unknown): string {
  return process.stdout.isTTY ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope);
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
