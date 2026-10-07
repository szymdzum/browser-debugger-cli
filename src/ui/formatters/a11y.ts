import type { DomContext } from '@/types.js';
import type { A11yQueryResult, A11yNode, ListedA11yNode, ListedA11yTree } from '@/types.js';
import { OutputFormatter, areHintsHidden } from '@/ui/formatting.js';
import {
  a11yMoreMatchesNote,
  a11yTreeMoreNote,
  a11yTreeShownNote,
} from '@/ui/messages/commands.js';

/**
 * Data structure for a11y node with DOM context.
 */
interface A11yNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

/**
 * Separator width for section dividers in formatted output.
 */
const SEPARATOR_WIDTH = 50;

/**
 * Format the listed part of an accessibility tree for human-readable output:
 * one indented line per node, and when nodes were cut, how to see more.
 *
 * @param tree - Listed accessibility tree
 * @returns Formatted output string
 */
export function formatA11yTree(tree: ListedA11yTree): string {
  const fmt = new OutputFormatter();

  fmt.text(`Accessibility Tree (${tree.count} nodes)`).separator('─', SEPARATOR_WIDTH).blank();

  tree.nodes.forEach((node) => fmt.text('  '.repeat(node.depth) + formatA11yNodeOneLine(node)));

  if (tree.omitted) {
    fmt.blank().text(a11yTreeShownNote(tree.nodes.length)).text(a11yTreeMoreNote(tree.omitted));
  }

  return fmt.build();
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
  if (result.omitted) fmt.text(a11yMoreMatchesNote(result.omitted)).blank();

  const first = result.nodes[0];
  if (first?.index !== undefined && !areHintsHidden()) {
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
function formatA11yNodeOneLine(node: A11yNode | ListedA11yNode): string {
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
