/**
 * Structured output building for CLI commands.
 *
 * Provides helpers for building consistent JSON output across all commands.
 * Moved from commands/shared to ui layer as it's presentation logic, not command logic.
 */

import type {
  BdgOutput,
  CDPTarget,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  TelemetryType,
} from '@/types';
import { getErrorMessage } from '@/utils/errors.js';
import { VERSION } from '@/utils/version.js';

/**
 * Output mode determines what data is included and how partial flag is set
 */
export type OutputMode = 'preview' | 'full' | 'final';

/**
 * Options for building output payloads
 */
export interface OutputBuilderOptions {
  mode: OutputMode;
  target: CDPTarget;
  startTime: number;
  networkRequests: NetworkRequest[];
  consoleLogs: ConsoleMessage[];
  domData?: DOMData;
  activeTelemetry: TelemetryType[];
}

/**
 * Helper: build output payloads for different modes with consistent metadata.
 * Modes: preview (metadata only), full (with bodies), final (complete with DOM).
 */
export class OutputBuilder {
  /**
   * Build session output with consistent metadata.
   *
   * @param options - Configuration for output construction
   * @returns BdgOutput payload
   */
  static build(options: OutputBuilderOptions): BdgOutput {
    const { mode, target, startTime, networkRequests, consoleLogs, domData, activeTelemetry } =
      options;

    const baseOutput = {
      version: VERSION,
      success: true,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      target: {
        url: target.url,
        title: target.title,
      },
      // Only final outputs are complete (partial=false)
      partial: mode !== 'final',
    };

    if (mode === 'preview') {
      // Lightweight preview: metadata only, last 1000 items
      const previewData: Record<string, unknown> = {};

      if (activeTelemetry.includes('network')) {
        previewData['network'] = networkRequests.slice(-1000).map((req) => ({
          requestId: req.requestId,
          url: req.url,
          method: req.method,
          timestamp: req.timestamp,
          status: req.status,
          mimeType: req.mimeType,
          // Exclude requestBody, responseBody, headers for lightweight preview
        }));
      }

      if (activeTelemetry.includes('console')) {
        previewData['console'] = consoleLogs.slice(-1000).map((msg) => ({
          type: msg.type,
          text: msg.text,
          timestamp: msg.timestamp,
          // Exclude args for lightweight preview
        }));
      }

      // DOM omitted in preview (only captured on stop)

      return {
        ...baseOutput,
        data: previewData,
      };
    }

    if (mode === 'full') {
      // Full mode: complete data with bodies
      const fullData: Record<string, unknown> = {};

      if (activeTelemetry.includes('network')) {
        fullData['network'] = networkRequests; // All data with bodies
      }

      if (activeTelemetry.includes('console')) {
        fullData['console'] = consoleLogs; // All data with args
      }

      // DOM omitted (only captured on stop)

      return {
        ...baseOutput,
        data: fullData,
      };
    }

    // Final mode - includes DOM, partial=false
    const finalData: Record<string, unknown> = {};

    if (activeTelemetry.includes('network')) {
      finalData['network'] = networkRequests;
    }

    if (activeTelemetry.includes('console')) {
      finalData['console'] = consoleLogs;
    }

    if (activeTelemetry.includes('dom') && domData) {
      finalData['dom'] = domData;
    }

    return {
      ...baseOutput,
      partial: false,
      data: finalData,
    };
  }

  /**
   * Build error output with consistent structure.
   *
   * @param error - Error object or string
   * @param startTime - Session start timestamp
   * @param target - Optional target information
   * @returns BdgOutput payload with error
   */
  static buildError(error: unknown, startTime: number, target?: CDPTarget): BdgOutput {
    return {
      version: VERSION,
      success: false,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      target: target ? { url: target.url, title: target.title } : { url: '', title: '' },
      data: {},
      error: getErrorMessage(error),
    };
  }

  /**
   * Build a simple JSON error response for commands.
   * Used by commands that don't follow the full BdgOutput structure (stop, cleanup, query).
   *
   * @param error - Error message or Error object
   * @param options - Optional fields (exitCode, additional data)
   * @returns JSON-serializable error object
   */
  static buildJsonError(
    error: string | Error,
    options?: { exitCode?: number; [key: string]: unknown }
  ): Record<string, unknown> {
    return {
      version: VERSION,
      success: false,
      error: error instanceof Error ? error.message : error,
      ...options,
    };
  }

  /**
   * Build a simple JSON success response for commands.
   * Used by commands that don't follow the full BdgOutput structure (stop, cleanup, query).
   *
   * @param data - Response data
   * @returns JSON-serializable success object
   */
  static buildJsonSuccess(data: Record<string, unknown>): Record<string, unknown> {
    return {
      version: VERSION,
      success: true,
      ...data,
    };
  }
}
