import type { CDPConnection } from '@/connection/cdp.js';

/**
 * DOM node information from CDP
 */
export interface DomNodeInfo {
  nodeId: number;
  tag?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  outerHTML?: string;
  textContent?: string;
}

/**
 * Get document root node ID
 *
 * @param cdp - CDP connection instance
 * @returns Root node ID
 * @throws \{Error\} When CDP command fails or connection is lost
 */
export async function getDocumentRoot(cdp: CDPConnection): Promise<number> {
  const result = (await cdp.send('DOM.getDocument', { depth: -1 })) as {
    root: { nodeId: number };
  };
  return result.root.nodeId;
}

/**
 * Query DOM by CSS selector
 *
 * @param cdp - CDP connection instance
 * @param selector - CSS selector to query
 * @param rootNodeId - Optional root node ID (defaults to document root)
 * @returns Array of node IDs matching the selector
 * @throws \{Error\} When CDP command fails or selector is invalid
 */
export async function queryBySelector(
  cdp: CDPConnection,
  selector: string,
  rootNodeId?: number
): Promise<number[]> {
  // Get root node if not provided
  const nodeId = rootNodeId ?? (await getDocumentRoot(cdp));

  const result = (await cdp.send('DOM.querySelectorAll', {
    nodeId,
    selector,
  })) as { nodeIds: number[] };

  return result.nodeIds;
}

/**
 * Get node information
 *
 * @param cdp - CDP connection instance
 * @param nodeId - Node ID to query
 * @returns Node information including tag, classes, attributes
 * @throws \{Error\} When CDP command fails or nodeId is invalid
 */
export async function getNodeInfo(cdp: CDPConnection, nodeId: number): Promise<DomNodeInfo> {
  // Get node description
  const describeResult = (await cdp.send('DOM.describeNode', {
    nodeId,
  })) as {
    node: {
      nodeId: number;
      nodeName: string;
      attributes?: string[];
    };
  };

  const node = describeResult.node;

  // Parse attributes array into object
  const attributes: Record<string, string> = {};
  if (node.attributes) {
    for (let i = 0; i < node.attributes.length; i += 2) {
      const key = node.attributes[i];
      const value = node.attributes[i + 1];
      if (key !== undefined && value !== undefined) {
        attributes[key] = value;
      }
    }
  }

  // Extract classes from class attribute
  const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0) ?? [];

  // Get outer HTML
  const htmlResult = (await cdp.send('DOM.getOuterHTML', {
    nodeId,
  })) as { outerHTML: string };

  // Extract text content by removing HTML tags
  // Uses simple regex to strip tags while preserving text content including < and > in text
  const textContent = htmlResult.outerHTML
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();

  return {
    nodeId,
    tag: node.nodeName.toLowerCase(),
    classes,
    attributes,
    outerHTML: htmlResult.outerHTML,
    textContent,
  };
}

/**
 * Create preview text for a node
 *
 * @param nodeInfo - Node information
 * @param maxLength - Maximum preview length (default: 50)
 * @returns Preview text
 */
export function createNodePreview(nodeInfo: DomNodeInfo, maxLength = 50): string {
  // If we have text content, use that
  if (nodeInfo.textContent && nodeInfo.textContent.length > 0) {
    const text = nodeInfo.textContent;
    if (text.length > maxLength) {
      return text.slice(0, maxLength) + '...';
    }
    return text;
  }

  // Otherwise show the opening tag
  const tag = nodeInfo.tag ?? 'unknown';
  const classAttr =
    nodeInfo.classes && nodeInfo.classes.length > 0 ? ` class="${nodeInfo.classes.join(' ')}"` : '';
  const preview = `<${tag}${classAttr}>`;

  if (preview.length > maxLength) {
    return preview.slice(0, maxLength) + '...';
  }
  return preview;
}
