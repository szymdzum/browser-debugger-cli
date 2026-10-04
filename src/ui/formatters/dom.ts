import { CROSS_ORIGIN_FRAMES_NOTE } from '@/errors/messages.js';
import type { DomQueryResult, DomGetResult, ScreenshotResult } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * A selector as a JS single-quoted string inside a shell double-quoted
 * argument, for copy-pastable `bdg dom eval "..."` hints.
 *
 * @param selector - CSS selector
 * @returns Escaped selector
 */
function safeQuerySelectorArgument(selector: string): string {
  return selector
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/(["$`])/g, '\\$1');
}

/**
 * Format DOM query results for human-readable output.
 *
 * Displays found nodes with their index, tag, classes, and preview text.
 * Shows helpful message when no nodes are found.
 *
 * @param data - DOM query result containing selector, count, and matching nodes
 * @returns Formatted output string
 *
 * @example
 * ```typescript
 * formatDomQuery({
 *   selector: '.error',
 *   count: 2,
 *   nodes: [
 *     { index: 0, nodeId: 123, tag: 'div', classes: ['error'], preview: 'Invalid input' },
 *     { index: 1, nodeId: 456, tag: 'span', classes: ['error'], preview: 'Required field' }
 *   ]
 * });
 * // Output:
 * // Found 2 nodes matching ".error":
 * //   [0] <div class="error"> Invalid input
 * //   [1] <span class="error"> Required field
 * ```
 */
export function formatDomQuery(data: DomQueryResult): string {
  const { count, nodes, selector } = data;
  const fmt = new OutputFormatter();

  if (count === 0) {
    return fmt
      .text(`No nodes found matching "${selector}"`)
      .blank()
      .section('Suggestions:', [
        `Verify selector: bdg dom eval "document.querySelector('${safeQuerySelectorArgument(selector)}')"`,
        'List elements:   bdg dom query "*"',
        CROSS_ORIGIN_FRAMES_NOTE,
      ])
      .build();
  }

  const nodeLines = nodes.map((node) => {
    const attributes = [
      node.id && ` id="${node.id}"`,
      node.name && ` name="${node.name}"`,
      node.type && ` type="${node.type}"`,
      node.classes?.length && ` class="${node.classes.join(' ')}"`,
    ]
      .filter(Boolean)
      .join('');
    const context = node.context ? ` (in ${node.context})` : '';
    const preview = node.preview ? ` ${node.preview}` : '';
    return `[${node.index}] <${node.tag}${attributes}>${context}${preview}`;
  });

  const hasMultipleResults = count > 1;
  const exampleIndex = hasMultipleResults ? (nodes[0]?.index ?? 0) : 0;

  return fmt
    .text(`Found ${count} node${count === 1 ? '' : 's'} matching "${selector}":`)
    .list(nodeLines)
    .blank()
    .section('Next steps:', [
      `Get HTML:        bdg dom get ${exampleIndex} --raw`,
      `Accessibility:   bdg dom get ${exampleIndex}`,
      `Extract text:    bdg dom eval "document.querySelector('${safeQuerySelectorArgument(selector)}').textContent"`,
    ])
    .build();
}

/**
 * Format DOM get results for human-readable output.
 *
 * Displays full outerHTML for matched elements. For single elements, shows HTML directly.
 * For multiple elements, shows numbered list with HTML for each.
 *
 * @param data - DOM get result containing array of nodes with outerHTML
 * @returns Formatted output string
 *
 * @example
 * ```typescript
 * // Single element
 * formatDomGet({
 *   nodes: [{ nodeId: 123, outerHTML: '<div class="error">Invalid input</div>' }]
 * });
 * // Output: <div class="error">Invalid input</div>
 *
 * // Multiple elements
 * formatDomGet({
 *   nodes: [
 *     { nodeId: 123, outerHTML: '<div class="error">Error 1</div>' },
 *     { nodeId: 456, outerHTML: '<span class="error">Error 2</span>' }
 *   ]
 * });
 * // Output:
 * // [1] <div class="error">Error 1</div>
 * // [2] <span class="error">Error 2</span>
 * ```
 */
export function formatDomGet(data: DomGetResult): string {
  const { nodes } = data;

  if (nodes.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return nodes[0]!.outerHTML ?? '';
  }

  const fmt = new OutputFormatter();
  nodes.forEach((node, i) => {
    fmt.text(`[${i + 1}] ${node.outerHTML}`);
  });

  return fmt.build();
}

/**
 * Format DOM eval results for human-readable output.
 *
 * Outputs the evaluated JavaScript result as formatted JSON.
 *
 * @param data - DOM eval result containing the evaluated value
 * @returns Formatted JSON string
 *
 * @example
 * ```typescript
 * formatDomEval({ result: 'My Page Title' });
 * // Output: "My Page Title"
 *
 * formatDomEval({ result: { url: 'https://example.com', title: 'Example' } });
 * // Output:
 * // {
 * //   "url": "https://example.com",
 * //   "title": "Example"
 * // }
 * ```
 */
export function formatDomEval(data: { result: unknown; type?: string }): string {
  if (data.type === 'undefined') return 'undefined';
  const isDescription = typeof data.result === 'string' && data.type !== 'string';
  if (isDescription) return data.result as string;
  return JSON.stringify(data.result ?? null, null, 2);
}

/**
 * Format screenshot capture result for human-readable display.
 *
 * Shows concise single-line output. Resize/capture metadata available in --json output.
 *
 * @param data - Screenshot metadata
 * @returns Formatted string with screenshot path and optional viewport message
 *
 * @example
 * ```typescript
 * formatDomScreenshot({ path: './page.png', ... });
 * // Output: Screenshot saved to ./page.png
 *
 * formatDomScreenshot({ path: './page.png', fullPageSkipped: { reason: 'page_too_tall', ... } });
 * // Output: Screenshot saved to ./page.png (viewport only - page too tall)
 * ```
 */
export function formatDomScreenshot(data: ScreenshotResult): string {
  let output = `Screenshot saved to ${data.path}`;

  if (data.fullPageSkipped && !data.scrolledTo) {
    output += ' (viewport only - page too tall)';
  }

  return output;
}
