import type { Protocol } from '@/connection/typed-cdp.js';
import { callCDP } from '@/ipc/client.js';
import type { A11yNode, A11yTree, A11yQueryPattern, A11yQueryResult } from '@/types.js';

/**
 * Builds accessibility tree from raw CDP nodes.
 *
 * Pure function that filters out ignored nodes and builds the tree structure.
 * Separated from collectA11yTree for easier unit testing.
 *
 * @param rawNodes - Raw AXNode array from CDP
 * @returns Parsed accessibility tree
 * @throws Error if no root node found
 */
export function buildTreeFromRawNodes(rawNodes: Protocol.Accessibility.AXNode[]): A11yTree {
  const nodes = new Map<string, A11yNode>();
  let root: A11yNode | null = null;

  for (const rawNode of rawNodes) {
    if (rawNode.ignored) {
      continue;
    }

    const node = parseA11yNode(rawNode);
    nodes.set(node.nodeId, node);

    root ??= node;
  }

  if (!root) {
    throw new Error('No root node found in accessibility tree');
  }

  return {
    root,
    nodes,
    count: nodes.size,
  };
}

/**
 * Collects the full accessibility tree from the page via IPC.
 *
 * Uses the worker's persistent CDP connection through callCDP for consistency
 * with other DOM commands and to avoid connection conflicts.
 *
 * @returns Parsed and filtered accessibility tree
 * @throws Error if CDP Accessibility domain fails
 */
export async function collectA11yTree(): Promise<A11yTree> {
  await callCDP('Accessibility.enable', {});

  try {
    const response = await callCDP('Accessibility.getFullAXTree', {});
    const result = response.data?.result as
      | Protocol.Accessibility.GetFullAXTreeResponse
      | undefined;
    if (!result?.nodes) {
      throw new Error('Failed to get accessibility tree');
    }

    return buildTreeFromRawNodes(result.nodes);
  } finally {
    await callCDP('Accessibility.disable', {});
  }
}

/**
 * Parses raw CDP AXNode into simplified A11yNode format.
 *
 * Extracts key properties (role, name, description, value) and common
 * ARIA properties (focusable, focused, disabled, required).
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Simplified A11yNode
 */
function parseA11yNode(rawNode: Protocol.Accessibility.AXNode): A11yNode {
  const node: A11yNode = {
    nodeId: rawNode.nodeId,
    role: extractRole(rawNode),
  };

  if (rawNode.name?.value) {
    node.name = String(rawNode.name.value);
  }

  if (rawNode.description?.value) {
    node.description = String(rawNode.description.value);
  }

  if (rawNode.value?.value) {
    node.value = String(rawNode.value.value);
  }

  if (rawNode.properties) {
    const props: Record<string, unknown> = {};

    for (const prop of rawNode.properties) {
      if (prop.name === 'focusable') {
        node.focusable = prop.value.value === true;
      } else if (prop.name === 'focused') {
        node.focused = prop.value.value === true;
      } else if (prop.name === 'disabled') {
        node.disabled = prop.value.value === true;
      } else if (prop.name === 'required') {
        node.required = prop.value.value === true;
      } else {
        props[prop.name] = prop.value.value;
      }
    }

    if (Object.keys(props).length > 0) {
      node.properties = props;
    }
  }

  if (rawNode.childIds && rawNode.childIds.length > 0) {
    node.childIds = rawNode.childIds;
  }

  if (rawNode.backendDOMNodeId) {
    node.backendDOMNodeId = rawNode.backendDOMNodeId;
  }

  return node;
}

/**
 * Extracts role string from AXNode.
 *
 * Prefers explicit role over Chrome internal role.
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Role string (e.g., 'button', 'textbox', 'heading')
 */
function extractRole(rawNode: Protocol.Accessibility.AXNode): string {
  if (rawNode.role?.value) {
    return String(rawNode.role.value);
  }
  return 'unknown';
}

/**
 * Queries accessibility tree by pattern (role, name, description).
 *
 * Performs case-insensitive matching with AND logic for multiple fields.
 *
 * @param tree - Accessibility tree to search
 * @param pattern - Query pattern with optional role, name, description
 * @returns Query result with matching nodes
 *
 * @example
 * ```typescript
 * // Find submit buttons
 * queryA11yTree(tree, { role: 'button', name: 'Submit' });
 *
 * // Find all textboxes
 * queryA11yTree(tree, { role: 'textbox' });
 *
 * // Find by name only
 * queryA11yTree(tree, { name: 'Email' });
 * ```
 */
export function queryA11yTree(tree: A11yTree, pattern: A11yQueryPattern): A11yQueryResult {
  const matches: A11yNode[] = [];

  for (const node of tree.nodes.values()) {
    if (matchesPattern(node, pattern)) {
      matches.push(node);
    }
  }

  return {
    nodes: matches,
    count: matches.length,
    pattern,
  };
}

/**
 * Checks if a node matches the query pattern.
 *
 * All specified fields must match (AND logic).
 * String matching is case-insensitive.
 *
 * @param node - A11y node to test
 * @param pattern - Query pattern
 * @returns True if node matches all pattern criteria
 */
function matchesPattern(node: A11yNode, pattern: A11yQueryPattern): boolean {
  if (pattern.role) {
    if (node.role.toLowerCase() !== pattern.role.toLowerCase()) {
      return false;
    }
  }

  if (pattern.name) {
    if (!node.name) {
      return false;
    }
    if (!node.name.toLowerCase().includes(pattern.name.toLowerCase())) {
      return false;
    }
  }

  if (pattern.description) {
    if (!node.description) {
      return false;
    }
    if (!node.description.toLowerCase().includes(pattern.description.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Parses query pattern string into A11yQueryPattern object.
 *
 * Supports format: "role:button name:Submit description:Main"
 * Also accepts = as separator: "role=button name=Submit"
 * Fields are separated by spaces, case-insensitive.
 *
 * @param patternString - Query pattern string
 * @returns Parsed query pattern
 *
 * @example
 * ```typescript
 * parseQueryPattern('role:button name:Submit')
 * // => { role: 'button', name: 'Submit' }
 *
 * parseQueryPattern('role=heading')
 * // => { role: 'heading' }
 *
 * parseQueryPattern('name:Email')
 * // => { name: 'Email' }
 * ```
 */
export function parseQueryPattern(patternString: string): A11yQueryPattern {
  const pattern: A11yQueryPattern = {};
  const parts = patternString.trim().split(/\s+/);

  for (const part of parts) {
    const separatorMatch = part.match(/[:=]/);
    if (!separatorMatch) {
      continue;
    }

    const separator = separatorMatch[0];
    const [key, ...valueParts] = part.split(separator);
    const value = valueParts.join(separator);

    if (!value) {
      continue;
    }

    if (!key) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'role') {
      pattern.role = value;
    } else if (normalizedKey === 'name') {
      pattern.name = value;
    } else if (normalizedKey === 'description' || normalizedKey === 'desc') {
      pattern.description = value;
    }
  }

  return pattern;
}

/**
 * Resolve accessibility properties for a DOM node by CSS selector or nodeId via IPC.
 *
 * Uses the worker's persistent CDP connection through callCDP for consistency.
 * Supports direct nodeId lookup (bypassing selector) for index-based access patterns.
 *
 * @param selector - CSS selector (ignored if nodeId provided)
 * @param nodeId - Optional nodeId to use directly instead of querying by selector
 * @returns A11y node or null if not found
 * @throws Error if selector is invalid or element not found
 */
export async function resolveA11yNode(selector: string, nodeId?: number): Promise<A11yNode | null> {
  await callCDP('Accessibility.enable', {});

  try {
    let targetNodeId: number;

    if (nodeId !== undefined) {
      targetNodeId = nodeId;
    } else {
      const docResponse = await callCDP('DOM.getDocument', {});
      const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
      if (!doc?.root?.nodeId) {
        throw new Error('Failed to get document root');
      }

      const nodeResponse = await callCDP('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector,
      });
      const nodeResult = nodeResponse.data?.result as
        | Protocol.DOM.QuerySelectorResponse
        | undefined;

      if (!nodeResult?.nodeId) {
        return null;
      }

      targetNodeId = nodeResult.nodeId;
    }

    const a11yResponse = await callCDP('Accessibility.getPartialAXTree', {
      nodeId: targetNodeId,
      fetchRelatives: false,
    });
    const a11yResult = a11yResponse.data?.result as
      | Protocol.Accessibility.GetPartialAXTreeResponse
      | undefined;

    if (!a11yResult?.nodes) {
      return null;
    }

    const rawNode = a11yResult.nodes.find((n) => !n.ignored);
    if (!rawNode) {
      return null;
    }

    return parseA11yNode(rawNode);
  } finally {
    await callCDP('Accessibility.disable', {});
  }
}
