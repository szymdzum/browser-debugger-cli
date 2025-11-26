/**
 * Structured output building for CLI commands.
 */

import type {
  BdgOutput,
  BdgResponse,
  CDPTarget,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  TelemetryType,
} from '@/types';
import { getErrorMessage } from '@/utils/errors.js';
import { VERSION } from '@/utils/version.js';

export type OutputMode = 'preview' | 'full' | 'final';

export interface OutputBuilderOptions {
  mode: OutputMode;
  target: CDPTarget;
  startTime: number;
  networkRequests: NetworkRequest[];
  consoleLogs: ConsoleMessage[];
  domData?: DOMData;
  activeTelemetry: TelemetryType[];
}

export function buildSuccessResponse<T>(data: T): BdgResponse<T> {
  return { version: VERSION, success: true, data };
}

interface BaseOutput {
  version: string;
  success: true;
  timestamp: string;
  duration: number;
  target: { url: string; title: string };
  partial: boolean;
}

function buildBaseOutput(target: CDPTarget, startTime: number, partial: boolean): BaseOutput {
  return {
    version: VERSION,
    success: true,
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    target: { url: target.url, title: target.title },
    partial,
  };
}

function buildPreviewData(
  networkRequests: NetworkRequest[],
  consoleLogs: ConsoleMessage[],
  activeTelemetry: TelemetryType[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (activeTelemetry.includes('network')) {
    data['network'] = networkRequests.slice(-1000).map((req) => ({
      requestId: req.requestId,
      url: req.url,
      method: req.method,
      timestamp: req.timestamp,
      status: req.status,
      mimeType: req.mimeType,
    }));
  }

  if (activeTelemetry.includes('console')) {
    data['console'] = consoleLogs.slice(-1000).map((msg) => ({
      type: msg.type,
      text: msg.text,
      timestamp: msg.timestamp,
    }));
  }

  return data;
}

function buildFullData(
  networkRequests: NetworkRequest[],
  consoleLogs: ConsoleMessage[],
  activeTelemetry: TelemetryType[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (activeTelemetry.includes('network')) data['network'] = networkRequests;
  if (activeTelemetry.includes('console')) data['console'] = consoleLogs;
  return data;
}

function buildFinalData(
  networkRequests: NetworkRequest[],
  consoleLogs: ConsoleMessage[],
  domData: DOMData | undefined,
  activeTelemetry: TelemetryType[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (activeTelemetry.includes('network')) data['network'] = networkRequests;
  if (activeTelemetry.includes('console')) data['console'] = consoleLogs;
  if (activeTelemetry.includes('dom') && domData) data['dom'] = domData;
  return data;
}

export class OutputBuilder {
  static build(options: OutputBuilderOptions): BdgOutput {
    const { mode, target, startTime, networkRequests, consoleLogs, domData, activeTelemetry } =
      options;

    const baseOutput = buildBaseOutput(target, startTime, mode !== 'final');

    switch (mode) {
      case 'preview':
        return {
          ...baseOutput,
          data: buildPreviewData(networkRequests, consoleLogs, activeTelemetry),
        };
      case 'full':
        return {
          ...baseOutput,
          data: buildFullData(networkRequests, consoleLogs, activeTelemetry),
        };
      case 'final':
        return {
          ...baseOutput,
          partial: false,
          data: buildFinalData(networkRequests, consoleLogs, domData, activeTelemetry),
        };
    }
  }

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

  static buildJsonError(
    error: string | Error,
    options?: { exitCode?: number; suggestion?: string; context?: Record<string, string> }
  ): Record<string, unknown> {
    return {
      version: VERSION,
      success: false,
      error: error instanceof Error ? error.message : error,
      ...options,
    };
  }

  static buildJsonSuccess(data: Record<string, unknown>): Record<string, unknown> {
    return { version: VERSION, success: true, ...data };
  }
}
