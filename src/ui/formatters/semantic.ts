/**
 * Semantic output formatter for accessibility trees.
 *
 * Converts accessibility tree to token-optimized Markdown-style format.
 * Used by dom get, peek --dom, and session.json output.
 */

import type { A11yTree, A11yNode } from '@/types.js';

/**
 * Format accessibility tree as semantic output.
 *
 * Presents page structure using ARIA roles and accessible names.
 * Optimized for token efficiency (70% reduction vs raw HTML).
 *
 * Output format:
 * - Indented tree structure (2 spaces per level)
 * - [Role] "Name" format for each node
 * - Key properties: (focusable), (disabled), (required)
 * - Heading levels: [Heading L1]
 *
 * @param tree - Accessibility tree from collectA11yTree()
 * @returns Markdown-style semantic structure
 *
 * @example
 * ```typescript
 * const tree = await collectA11yTree();
 * const output = semantic(tree);
 * console.log(output);
 * // [RootWebArea] "GitHub"
 * //   [Banner]
 * //     [Link] "Skip to content" (focusable)
 * //   [Main]
 * //     [Heading L1] "Trending"
 * ```
 */
export function semantic(tree: A11yTree): string {
  const lines: string[] = [];

  function traverse(nodeId: string, depth: number): void {
    const node = tree.nodes.get(nodeId);
    if (!node) return;

    const indent = '  '.repeat(depth);
    const roleText = formatRole(node);
    const nameText = node.name ? ` "${node.name}"` : '';
    const propsText = formatProps(node);

    lines.push(`${indent}${roleText}${nameText}${propsText}`);

    if (node.childIds) {
      for (const childId of node.childIds) {
        traverse(childId, depth + 1);
      }
    }
  }

  traverse(tree.root.nodeId, 0);
  return lines.join('\n');
}

/**
 * Format role with special handling for headings.
 *
 * @param node - Accessibility node
 * @returns Formatted role string
 */
function formatRole(node: A11yNode): string {
  const role = capitalize(node.role);

  if (node.role.toLowerCase() === 'heading' && node.properties?.['level'] !== undefined) {
    const level = node.properties['level'];
    const levelNum = typeof level === 'number' ? level : Number(level);
    if (!isNaN(levelNum)) {
      return `[Heading L${levelNum}]`;
    }
  }

  return `[${role}]`;
}

/**
 * Format node properties as parenthesized list.
 *
 * @param node - Accessibility node
 * @returns Formatted properties string
 */
function formatProps(node: A11yNode): string {
  const props: string[] = [];

  if (node.focusable) props.push('focusable');
  if (node.focused) props.push('focused');
  if (node.disabled) props.push('disabled');
  if (node.required) props.push('required');

  return props.length > 0 ? ` (${props.join(', ')})` : '';
}

/**
 * Capitalize first letter of string.
 *
 * @param str - Input string
 * @returns Capitalized string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
