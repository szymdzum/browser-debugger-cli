import type { DomQueryResult, DomGetResult } from '@/commands/dom/helpers.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Format DOM query results for human-readable output.
 *
 * Displays found elements with their index, tag, classes, and preview text.
 * Shows helpful message when no elements are found.
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
 * // Found 2 elements matching ".error":
 * //   [0] <div class="error"> Invalid input
 * //   [1] <span class="error"> Required field
 * ```
 */
export function formatDomQuery(data: DomQueryResult): string {
  const { count, nodes, selector } = data;
  const fmt = new OutputFormatter();

  if (count === 0) {
    return fmt
      .text(`No elements found matching "${selector}"`)
      .blank()
      .section('Suggestions:', [
        `Verify selector: bdg dom eval "document.querySelector('${selector}')"`,
        'List elements:   bdg dom query "*"',
      ])
      .build();
  }

  const nodeLines = nodes.map((node) => {
    const classInfo = node.classes?.length ? ` class="${node.classes.join(' ')}"` : '';
    return `[${node.index}] <${node.tag}${classInfo}> ${node.preview}`;
  });

  return fmt
    .text(`Found ${count} element${count === 1 ? '' : 's'} matching "${selector}":`)
    .list(nodeLines)
    .blank()
    .section('Next steps:', [
      'Get HTML:   bdg dom get <index>',
      'Inspect:    bdg details dom <index>',
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
export function formatDomEval(data: { result: unknown }): string {
  return JSON.stringify(data.result, null, 2);
}

/**
 * Format screenshot capture result for human-readable display.
 *
 * @param data - Screenshot metadata
 * @returns Formatted string with screenshot details
 *
 * @example
 * ```typescript
 * formatDomScreenshot({
 *   path: '/path/to/screenshot.png',
 *   format: 'png',
 *   width: 1920,
 *   height: 1080,
 *   size: 245632,
 *   fullPage: true
 * });
 * // Output:
 * // Screenshot captured
 * // Path: /path/to/screenshot.png
 * // Format: png
 * // Dimensions: 1920x1080
 * // Size: 240.0 KB
 * // Full page: yes
 * ```
 */
export function formatDomScreenshot(data: {
  path: string;
  format: 'png' | 'jpeg';
  quality?: number;
  width: number;
  height: number;
  size: number;
  viewport?: { width: number; height: number };
  fullPage: boolean;
}): string {
  const fmt = new OutputFormatter();

  // Format file size
  const sizeKB = data.size / 1024;
  const sizeStr = sizeKB < 1024 ? `${sizeKB.toFixed(1)} KB` : `${(sizeKB / 1024).toFixed(1)} MB`;

  fmt
    .text('Screenshot captured')
    .blank()
    .keyValueList([
      ['Path', data.path],
      ['Format', data.format.toUpperCase()],
      ...(data.format === 'jpeg' && data.quality !== undefined
        ? [['Quality', `${data.quality}%`] as [string, string]]
        : []),
      ['Dimensions', `${data.width}x${data.height}`],
      ['Size', sizeStr],
      ['Full page', data.fullPage ? 'yes' : 'no'],
      ...(data.viewport
        ? [['Viewport', `${data.viewport.width}x${data.viewport.height}`] as [string, string]]
        : []),
    ]);

  return fmt.build();
}
