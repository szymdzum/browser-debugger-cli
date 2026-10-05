import type { DomFrame } from '@/ipc/protocol/commands.js';
import type { DomQueryResult, DomGetResult, ScreenshotResult } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  frameLabel,
  moreMatchesNote,
  noFramesMessage,
  viewportPositionHint,
} from '@/ui/messages/commands.js';
import { parseSelectorFilters } from '@/utils/selectorFilters.js';

/** Matches listed in human output (JSON has all of them) */
const QUERY_DISPLAY_LIMIT = 50;

/**
 * A shell-quoted `dom eval` script reading the text (or a field's value) of
 * the n-th match in the main document, as rendered (null for matches inside iframes or
 * shadow roots, which `document.querySelectorAll` does not reach).
 *
 * @param selector - CSS selector
 * @param index - Match to read
 * @returns Single-quoted script, safe to paste into a shell
 */
function textExtractionScript(selector: string, index: number): string {
  const script = `(el => el && (el.value ?? el.innerText))(document.querySelectorAll(${JSON.stringify(selector)})[${index}])`;
  return `'${script.replace(/'/g, `'\\''`)}'`;
}

/**
 * Format DOM query results for human-readable output.
 *
 * Displays found nodes with their index, tag, classes, and preview text
 * (plus where they are when outside the viewport or hidden, e.g.
 * `(below fold)`), up to {@link QUERY_DISPLAY_LIMIT} of them (no match is an error, exit 83).
 * The text extraction hint is left out for selectors with text or visibility
 * filters, which `document.querySelectorAll` does not understand.
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

  const nodeLines = nodes.slice(0, QUERY_DISPLAY_LIMIT).map((node) => {
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
    const position = node.inViewport && viewportPositionHint(node.inViewport, node.clippedBy);
    const location = position ? ` (${position})` : '';
    return `[${node.index}] <${node.tag}${attributes}>${context}${preview}${location}`;
  });

  const hasMultipleResults = count > 1;
  const exampleIndex = hasMultipleResults ? (nodes[0]?.index ?? 0) : 0;

  return fmt
    .text(`Found ${count} node${count === 1 ? '' : 's'} matching "${selector}":`)
    .list(nodeLines)
    .list(count > QUERY_DISPLAY_LIMIT ? [moreMatchesNote(count - QUERY_DISPLAY_LIMIT)] : [])
    .hints('Next steps:', [
      `Get HTML:        bdg dom get ${exampleIndex} --raw`,
      `Accessibility:   bdg dom get ${exampleIndex}`,
      ...(parseSelectorFilters(selector)
        ? []
        : [`Extract text:    bdg dom eval ${textExtractionScript(selector, exampleIndex)}`]),
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
 * // [0] <div class="error">Error 1</div>
 * // [1] <span class="error">Error 2</span>
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
    fmt.text(`[${i}] ${node.outerHTML}`);
  });

  return fmt.build();
}

/**
 * Format DOM eval results for human-readable output.
 *
 * Outputs the evaluated JavaScript result as formatted JSON. The iframe it
 * ran in (`--frame`) is reported on stderr, so stdout stays the bare value.
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
 * Format the page's iframes, one per line, nested frames indented below
 * their parent.
 *
 * @param data - Frames from `bdg dom frames`
 * @returns Formatted list
 *
 * @example
 * ```
 * [0] http://localhost:3000/widget  name=widget  same-origin
 * [1] https://pay.example/  #checkout  cross-origin, out-of-process
 *   [2] about:blank  same-origin
 * ```
 */
export function formatDomFrames(data: { frames: DomFrame[] }): string {
  if (data.frames.length === 0) return noFramesMessage();
  const depthOf = new Map<number, number>();
  return data.frames
    .map((frame) => {
      const depth = frame.parentIndex === undefined ? 0 : (depthOf.get(frame.parentIndex) ?? 0) + 1;
      depthOf.set(frame.index, depth);
      return '  '.repeat(depth) + frameLabel(frame);
    })
    .join('\n');
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
