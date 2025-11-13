/**
 * DOM helpers for direct CDP operations.
 *
 * Provides query, get, and screenshot functionality using temporary CDP connections.
 * Follows the pattern established by dom eval and form interaction commands.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { queryBySelector, getNodeInfo, createNodePreview } from '@/connection/domOperations.js';
import { CDPConnectionError } from '@/connection/errors.js';

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
  index?: number;
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

/**
 * Query DOM elements by CSS selector.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector to query
 * @returns Query result with matched nodes
 * @throws CDPConnectionError if CDP operation fails
 */
export async function queryDOMElements(
  cdp: CDPConnection,
  selector: string
): Promise<DomQueryResult> {
  await cdp.send('DOM.enable');

  const nodeIds = await queryBySelector(cdp, selector);

  const nodes = await Promise.all(
    nodeIds.map(async (nodeId, index) => {
      const info = await getNodeInfo(cdp, nodeId);
      const preview = createNodePreview(info);

      const node: {
        index: number;
        nodeId: number;
        tag?: string;
        classes?: string[];
        preview?: string;
      } = {
        index,
        nodeId,
      };

      if (info.tag !== undefined) node.tag = info.tag;
      if (info.classes !== undefined) node.classes = info.classes;
      if (preview !== undefined) node.preview = preview;

      return node;
    })
  );

  return {
    selector,
    count: nodes.length,
    nodes,
  };
}

/**
 * Get full HTML and attributes for DOM elements.
 *
 * @param cdp - CDP connection
 * @param options - Get options (selector, index, nodeId, all, nth)
 * @returns Get result with node details
 * @throws CDPConnectionError if CDP operation fails
 */
export async function getDOMElements(
  cdp: CDPConnection,
  options: DomGetOptions
): Promise<DomGetResult> {
  await cdp.send('DOM.enable');

  let nodeIds: number[] = [];

  if (options.nodeId !== undefined) {
    nodeIds = [options.nodeId];
  } else if (options.index !== undefined) {
    // TODO: Implement query cache for index-based lookups
    throw new Error(
      'Index-based lookups not yet supported in direct CDP mode. Use selector instead.'
    );
  } else if (options.selector) {
    nodeIds = await queryBySelector(cdp, options.selector);

    if (nodeIds.length === 0) {
      throw new Error(`No elements found matching "${options.selector}"`);
    }

    // Apply filtering
    if (options.nth !== undefined) {
      if (options.nth < 1 || options.nth > nodeIds.length) {
        throw new Error(`--nth ${options.nth} out of range (found ${nodeIds.length} elements)`);
      }
      const nthNode = nodeIds[options.nth - 1];
      if (nthNode === undefined) {
        throw new Error(`Element at index ${options.nth} not found`);
      }
      nodeIds = [nthNode];
    } else if (!options.all) {
      // Default: return first match only
      const firstNode = nodeIds[0];
      if (firstNode === undefined) {
        throw new Error('No elements found');
      }
      nodeIds = [firstNode];
    }
  } else {
    throw new Error('Either selector, index, or nodeId must be provided');
  }

  const nodes = await Promise.all(
    nodeIds.map(async (nodeId) => {
      const info = await getNodeInfo(cdp, nodeId);

      const node: {
        nodeId: number;
        tag?: string;
        attributes?: Record<string, unknown>;
        classes?: string[];
        outerHTML?: string;
      } = {
        nodeId,
      };

      if (info.tag !== undefined) node.tag = info.tag;
      if (info.attributes !== undefined) node.attributes = info.attributes;
      if (info.classes !== undefined) node.classes = info.classes;
      if (info.outerHTML !== undefined) node.outerHTML = info.outerHTML;

      return node;
    })
  );

  return { nodes };
}

/**
 * Capture a screenshot of the page.
 *
 * @param cdp - CDP connection
 * @param outputPath - Path to save screenshot
 * @param options - Screenshot options (format, quality, fullPage)
 * @returns Screenshot result with path, format, dimensions, and size
 * @throws CDPConnectionError if CDP operation fails
 */
export async function capturePageScreenshot(
  cdp: CDPConnection,
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const format = options.format ?? 'png';
  const quality = format === 'jpeg' ? (options.quality ?? 90) : undefined;
  const fullPage = options.fullPage ?? true;

  // Get viewport dimensions
  const metricsResponse = await cdp.send('Page.getLayoutMetrics', {});
  const cdpMetrics = metricsResponse as {
    contentSize?: { width: number; height: number };
    visualViewport?: { clientWidth: number; clientHeight: number };
  };

  const contentSize = cdpMetrics.contentSize ?? { width: 0, height: 0 };
  const viewport = cdpMetrics.visualViewport ?? { clientWidth: 0, clientHeight: 0 };

  // Capture screenshot
  const response = await cdp.send('Page.captureScreenshot', {
    format,
    quality,
    captureBeyondViewport: fullPage,
  });

  const cdpResponse = response as {
    data?: string;
    exceptionDetails?: { text?: string };
  };

  if (cdpResponse.exceptionDetails) {
    const text = cdpResponse.exceptionDetails.text ?? 'Unknown error';
    throw new CDPConnectionError('Screenshot capture failed', new Error(text));
  }

  if (!cdpResponse.data) {
    throw new CDPConnectionError('No screenshot data returned', new Error('Empty response'));
  }

  // Write to file
  const fs = await import('fs/promises');
  const path = await import('path');
  const buffer = Buffer.from(cdpResponse.data, 'base64');

  const absolutePath = path.resolve(outputPath);
  await fs.writeFile(absolutePath, buffer);

  const result: ScreenshotResult = {
    path: absolutePath,
    format,
    width: fullPage ? contentSize.width : viewport.clientWidth,
    height: fullPage ? contentSize.height : viewport.clientHeight,
    size: buffer.length,
    fullPage,
  };

  if (quality !== undefined) {
    result.quality = quality;
  }

  if (!fullPage) {
    result.viewport = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
  }

  return result;
}
