/**
 * DOM operation types.
 *
 * Shared type definitions for DOM query, get, and screenshot operations.
 * Used by both commands and formatters to avoid circular dependencies.
 */

/**
 * Result of a DOM query operation
 */
export interface DomQueryResult {
  selector: string;
  count: number;
  nodes: Array<{
    index: number;
    nodeId: number;
    tag?: string;
    classes?: string[];
    preview?: string;
  }>;
}

/**
 * Result of a DOM get operation
 */
export interface DomGetResult {
  nodes: Array<{
    nodeId: number;
    tag?: string;
    attributes?: Record<string, unknown>;
    classes?: string[];
    outerHTML?: string;
  }>;
}

/**
 * Result of a screenshot operation
 */
export interface ScreenshotResult {
  path: string;
  format: 'png' | 'jpeg';
  quality?: number;
  width: number;
  height: number;
  size: number;
  viewport?: {
    width: number;
    height: number;
  };
  fullPage: boolean;
}

/**
 * Options for DOM get operation
 */
export interface DomGetOptions {
  selector?: string;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}

/**
 * Options for screenshot operation
 */
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
}
