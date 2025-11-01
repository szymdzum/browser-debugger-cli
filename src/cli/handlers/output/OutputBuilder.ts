import type { BdgOutput, CDPTarget, NetworkRequest, ConsoleMessage, DOMData } from '@/types';

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
}

/**
 * Helper: build output payloads for preview/full/final modes with consistent metadata.
 */
export class OutputBuilder {
  /**
   * Build session output with consistent metadata.
   *
   * @param options - Configuration for output construction
   * @returns BdgOutput payload
   */
  static build(options: OutputBuilderOptions): BdgOutput {
    const { mode, target, startTime, networkRequests, consoleLogs, domData } = options;

    const baseOutput = {
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
      return {
        ...baseOutput,
        data: {
          network: networkRequests.slice(-1000).map((req) => ({
            requestId: req.requestId,
            url: req.url,
            method: req.method,
            timestamp: req.timestamp,
            status: req.status,
            mimeType: req.mimeType,
            // Exclude requestBody, responseBody, headers for lightweight preview
          })),
          console: consoleLogs.slice(-1000).map((msg) => ({
            type: msg.type,
            text: msg.text,
            timestamp: msg.timestamp,
            // Exclude args for lightweight preview
          })),
          // DOM omitted in preview (only captured on stop)
        },
      };
    }

    if (mode === 'full') {
      // Full mode: complete data with bodies
      return {
        ...baseOutput,
        data: {
          network: networkRequests, // All data with bodies
          console: consoleLogs, // All data with args
          // DOM omitted (only captured on stop)
        },
      };
    }

    // Final mode - includes DOM, partial=false
    return {
      ...baseOutput,
      partial: false,
      data: {
        network: networkRequests,
        console: consoleLogs,
        ...(domData && { dom: domData }),
      },
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
      success: false,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      target: target ? { url: target.url, title: target.title } : { url: '', title: '' },
      data: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
