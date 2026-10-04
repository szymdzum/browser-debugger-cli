import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { unknownQueryFieldError } from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import type { A11yNode, A11yTree, A11yQueryPattern, A11yQueryResult, NodeRef } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
    throw new CommandError(
      'No root node found in accessibility tree',
      { suggestion: 'The page may not be fully loaded. Wait and retry.' },
      EXIT_CODES.SOFTWARE_ERROR
    );
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
 * Uses the session's persistent CDP connection through callCDP for consistency
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
      Protocol.Accessibility.GetFullAXTreeResponse | undefined;
    if (!result?.nodes) {
      throw new CommandError(
        'Failed to get accessibility tree',
        { suggestion: 'CDP returned no nodes. The page may not be fully loaded.' },
        EXIT_CODES.SOFTWARE_ERROR
      );
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
 * Match a value against a query term.
 *
 * Without `*` the term matches as a case-insensitive substring (or exactly,
 * for `exact`); `*` matches any run of characters.
 *
 * @param value - Node value (role, name, description)
 * @param term - Query term
 * @param exact - Whole-value match instead of substring
 * @returns True on match
 */
function matchesTerm(value: string | undefined, term: string, exact = false): boolean {
  if (value === undefined) return false;
  if (!term.includes('*')) {
    const [v, t] = [value.toLowerCase(), term.toLowerCase()];
    return exact ? v === t : v.includes(t);
  }
  const source = term
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*');
  return new RegExp(exact ? `^${source}$` : source, 'i').test(value);
}

/**
 * Checks if a node matches the query pattern.
 *
 * All specified fields must match (AND logic), case-insensitively: role
 * exactly, name and description as substrings; `*` is a wildcard.
 *
 * @param node - A11y node to test
 * @param pattern - Query pattern
 * @returns True if node matches all pattern criteria
 */
function matchesPattern(node: A11yNode, pattern: A11yQueryPattern): boolean {
  if (pattern.role && !matchesTerm(node.role, pattern.role, true)) return false;
  if (pattern.name && !matchesTerm(node.name, pattern.name)) return false;
  if (pattern.description && !matchesTerm(node.description, pattern.description)) return false;
  return true;
}

/** Query fields and their aliases. */
const QUERY_FIELDS: Record<string, keyof A11yQueryPattern> = {
  role: 'role',
  name: 'name',
  description: 'description',
  desc: 'description',
};

/**
 * One `key:value` (or `key=value`) field: the value is quoted, or runs until
 * the next `key:`/`key=` after a space or comma.
 */
const QUERY_FIELD = /([a-z]+)\s*[:=](?:\s*("[^"]*"|'[^']*')|((?:(?![\s,]+[a-z]+\s*[:=]).)*))/gis;

/**
 * Parses query pattern string into A11yQueryPattern object.
 *
 * Fields are `key:value` or `key=value`, separated by spaces or commas.
 * Values may contain spaces (quote them if they contain `key:`-like text).
 * Keys: role, name, description (desc). Case-insensitive.
 *
 * @param patternString - Query pattern string
 * @returns Parsed query pattern
 * @throws CommandError (81) for unknown keys
 *
 * @example
 * ```typescript
 * parseQueryPattern('role:button name:Submit')     // { role: 'button', name: 'Submit' }
 * parseQueryPattern('role=link,name=Google Chrome') // { role: 'link', name: 'Google Chrome' }
 * parseQueryPattern('name:"Sign in" role:button')  // { name: 'Sign in', role: 'button' }
 * ```
 */
export function parseQueryPattern(patternString: string): A11yQueryPattern {
  const pattern: A11yQueryPattern = {};
  for (const [, rawKey = '', quoted, plain = ''] of patternString.matchAll(QUERY_FIELD)) {
    const rawValue = quoted ?? plain;
    const field = QUERY_FIELDS[rawKey.toLowerCase()];
    if (!field) {
      const err = unknownQueryFieldError(rawKey);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    const value = rawValue
      .trim()
      .replace(/,+$/, '')
      .replace(/^(["'])(.*)\1$/s, '$2');
    if (value) pattern[field] = value;
  }
  return pattern;
}

/**
 * Resolve accessibility properties for a DOM node via IPC.
 *
 * Uses the session's persistent CDP connection through callCDP for consistency.
 * Selectors are resolved by the caller (see `resolveBackendNodeIds`), so they
 * reach shadow roots and same-origin iframes like every other DOM command.
 *
 * @param target - Node reference
 * @returns A11y node or null if not found
 */
export async function resolveA11yNode(target: NodeRef): Promise<A11yNode | null> {
  await callCDP('Accessibility.enable', {});

  try {
    const a11yResponse = await callCDP('Accessibility.getPartialAXTree', {
      ...target,
      fetchRelatives: false,
    });
    const a11yResult = a11yResponse.data?.result as
      Protocol.Accessibility.GetPartialAXTreeResponse | undefined;

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
