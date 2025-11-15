import type { Protocol } from '@/connection/typed-cdp.js';

/**
 * Re-export connection types for backward compatibility.
 *
 * These types are now defined in connection/connectionTypes.ts for better cohesion.
 * This re-export maintains backward compatibility with existing code.
 */
export type {
  CDPMessage,
  CDPTarget,
  ConnectionOptions,
  LaunchedChrome,
  Logger,
  CleanupFunction,
} from '@/connection/types.js';

export interface DOMData {
  url: string;
  title: string;
  outerHTML: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  navigationId?: number; // Navigation counter when request was made
}

export interface ConsoleMessage {
  type: Protocol.Runtime.ConsoleAPICalledEvent['type'] | 'error';
  text: string;
  timestamp: number;
  args?: unknown[];
  navigationId?: number;
}

/**
 * Screenshot capture data returned by dom screenshot command
 */
export interface ScreenshotData {
  /** Absolute path where screenshot was saved */
  path: string;
  /** Image format */
  format: 'png' | 'jpeg';
  /** JPEG quality (0-100), only present for JPEG format */
  quality?: number;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** File size in bytes */
  size: number;
  /** Viewport dimensions when fullPage is false */
  viewport?: {
    width: number;
    height: number;
  };
  /** Whether screenshot captured full page or just viewport */
  fullPage: boolean;
}

export interface BdgOutput {
  version: string; // Package version for schema tracking
  success: boolean;
  timestamp: string;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  data: {
    dom?: DOMData;
    network?: NetworkRequest[];
    console?: ConsoleMessage[];
  };
  error?: string;
  partial?: boolean; // Flag to indicate this is partial/incomplete data (live preview)
}

export type TelemetryType = 'dom' | 'network' | 'console';
