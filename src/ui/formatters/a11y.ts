import type { DomContext } from '@/types.js';
import type { A11yTree, A11yQueryResult, A11yNode } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Data structure for a11y node with DOM context.
 */
interface A11yNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

/**
 * Maximum number of nodes to display in tree output before truncating.
 * Prevents overwhelming terminal output for large accessibility trees.
 */
const MAX_TREE_NODES_DISPLAY = 50;

/**
 * Separator width for section dividers in formatted output.
 */
const SEPARATOR_WIDTH = 50;

/**
 * Format accessibility tree for human-readable output.
 *
 * Displays the tree structure with role, name, and key properties.
 * Shows up to 50 nodes by default for manageable output.
 *
 * @param tree - Accessibility tree data
 * @returns Formatted output string
 */
export function formatA11yTree(tree: A11yTree): string {
  const fmt = new OutputFormatter();

  fmt.text(`Accessibility Tree (${tree.count} nodes)`).separator('─', SEPARATOR_WIDTH).blank();

  const { lines, truncated } = treeLines(tree);
  lines.forEach((line) => fmt.text(line));

  if (truncated) {
    fmt
      .blank()
      .text(
        `Showing the first ${MAX_TREE_NODES_DISPLAY} nodes (text boxes and repeated text left out)`
      )
      .text('Use --json flag for complete output, or bdg dom a11y query "role:<role>" to search');
  }

  return fmt.build();
}

/** Roles that only lay out their children and say nothing themselves */
const LAYOUT_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
]);

/**
 * The tree as indented lines, depth-first from the root. Text boxes, blank
 * text, text that repeats its parent's name, and nameless layout wrappers are left out
 * (their children move up a level), so the budget goes to meaningful nodes.
 *
 * @param tree - Accessibility tree
 * @returns Up to {@link MAX_TREE_NODES_DISPLAY} lines, and whether nodes were left
 */
function treeLines(tree: A11yTree): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  const visited = new Set<string>();
  let truncated = false;
  const visit = (node: A11yNode, depth: number, parentName: string | undefined): void => {
    if (visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    if (lines.length >= MAX_TREE_NODES_DISPLAY) {
      truncated = true;
      return;
    }
    const skip =
      node.role === 'InlineTextBox' ||
      (node.role === 'StaticText' && (node.name === parentName || !node.name?.trim())) ||
      (LAYOUT_ROLES.has(node.role) && !node.name);
    if (!skip) lines.push('  '.repeat(depth) + formatA11yNodeOneLine(node));
    for (const childId of node.childIds ?? []) {
      const child = tree.nodes.get(childId);
      if (child) visit(child, skip ? depth : depth + 1, node.name ?? parentName);
    }
  };
  visit(tree.root, 0, undefined);
  return { lines, truncated };
}

/** Roles whose elements take a value (the next step is fill, not click) */
const FILLABLE_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'slider',
  'listbox',
]);

/**
 * Format query result for human-readable output.
 *
 * Shows matching nodes with their role, name, and properties.
 *
 * @param result - Query result with matching nodes
 * @returns Formatted output string
 */
export function formatA11yQueryResult(result: A11yQueryResult): string {
  const fmt = new OutputFormatter();

  const patternParts: string[] = [];
  if (result.pattern.role) {
    patternParts.push(`role:${result.pattern.role}`);
  }
  if (result.pattern.name) {
    patternParts.push(`name:${result.pattern.name}`);
  }
  if (result.pattern.description) {
    patternParts.push(`description:${result.pattern.description}`);
  }
  const patternStr = patternParts.join(' ');

  fmt
    .text(`Found ${result.count} element${result.count === 1 ? '' : 's'} matching "${patternStr}"`)
    .separator('─', SEPARATOR_WIDTH)
    .blank();

  for (const node of result.nodes) {
    const index = node.index !== undefined ? `[${node.index}] ` : '';
    fmt.text(index + formatA11yNodeOneLine(node)).blank();
  }

  const first = result.nodes[0];
  if (first?.index !== undefined) {
    const fillable = FILLABLE_ROLES.has(first.role.toLowerCase());
    fmt.section('Next steps:', [
      'Inspect:  bdg dom a11y describe 0',
      fillable ? 'Fill:     bdg dom fill 0 "<value>"' : 'Click:    bdg dom click 0',
    ]);
  }

  return fmt.build();
}

/**
 * Format single accessibility node with DOM context fallback.
 *
 * Shows detailed properties including role, name, description, value, and states.
 * When a11y data is sparse, includes DOM context (tag, classes, text preview).
 *
 * @param data - Accessibility node with DOM context
 * @returns Formatted output string
 */
export function formatA11yNodeWithContext(data: A11yNodeWithContext): string {
  const { node, domContext } = data;
  const fmt = new OutputFormatter();

  fmt.text(`Accessibility Node: ${node.role}`).separator('─', SEPARATOR_WIDTH).blank();

  const props: [string, string][] = [];

  // A11y properties
  if (node.name) {
    props.push(['Name', node.name]);
  }
  if (node.description) {
    props.push(['Description', node.description]);
  }
  if (node.value !== undefined) {
    props.push(['Value', node.value]);
  }

  // DOM context fallback when a11y data is sparse
  if (domContext) {
    props.push(['Tag', `<${domContext.tag}>`]);
    if (domContext.classes && domContext.classes.length > 0) {
      props.push(['Classes', domContext.classes.join(' ')]);
    }
    if (domContext.preview && !node.name && !node.description) {
      // Only show text preview if no a11y name/description
      props.push(['Text Preview', domContext.preview]);
    }
  }

  // State properties
  if (node.focusable) {
    props.push(['Focusable', 'yes']);
  }
  if (node.focused) {
    props.push(['Focused', 'yes']);
  }
  if (node.disabled) {
    props.push(['Disabled', 'yes']);
  }
  if (node.required) {
    props.push(['Required', 'yes']);
  }

  props.push(['Node ID', node.nodeId]);
  if (node.backendDOMNodeId) {
    props.push(['DOM Node ID', String(node.backendDOMNodeId)]);
  }

  fmt.keyValueList(props, 16);

  if (node.properties && Object.keys(node.properties).length > 0) {
    fmt.blank().text('Additional Properties:').blank();
    const additionalProps = Object.entries(node.properties).map(
      ([key, value]) => [key, String(value)] as [string, string]
    );
    fmt.keyValueList(additionalProps, 20);
  }

  return fmt.build();
}

/**
 * Format accessibility node as single line (for tree/query output).
 *
 * Compact format: [Role] "Name" (states)
 *
 * @param node - Accessibility node
 * @returns Single-line formatted string
 *
 * @example
 * ```typescript
 * formatA11yNodeOneLine({
 *   role: 'button',
 *   name: 'Submit',
 *   focusable: true,
 *   disabled: false
 * });
 * // => '[Button] "Submit" (focusable)'
 * ```
 */
function formatA11yNodeOneLine(node: A11yNode): string {
  const parts: string[] = [];

  parts.push(`[${capitalize(node.role)}]`);

  if (node.name) {
    parts.push(`"${node.name}"`);
  }

  const states: string[] = [];
  if (node.value !== undefined && node.value !== '') {
    states.push(`value: ${truncate(node.value, 30)}`);
  }
  const checked = node.properties?.['checked'];
  if (checked !== undefined) {
    states.push(checked === 'mixed' ? 'partly checked' : checked ? 'checked' : 'unchecked');
  }
  if (node.focused) {
    states.push('focused');
  }
  if (node.disabled) {
    states.push('disabled');
  }
  if (node.required) {
    states.push('required');
  }
  if (node.focusable && states.length === 0) {
    states.push('focusable');
  }

  if (states.length > 0) {
    parts.push(`(${states.join(', ')})`);
  }

  return parts.join(' ');
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

/**
 * Truncate string to max length with ellipsis.
 *
 * @param str - Input string
 * @param maxLen - Maximum length
 * @returns Truncated string
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.substring(0, maxLen - 3) + '...';
}
