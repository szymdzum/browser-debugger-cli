import type { DomFrame } from '@/ipc/protocol/commands.js';
import type { DomQueryResult, DomGetResult, ScreenshotResult } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  frameLabel,
  moreMatchesNote,
  framesStillLoadingNote,
  noFramesMessage,
  queryNextSteps,
  screenshotGrownNote,
  viewportPositionHint,
} from '@/ui/messages/commands.js';

/** Matches listed in human output (JSON has all of them) */
const QUERY_DISPLAY_LIMIT = 50;

/**
 * Format DOM query results for human-readable output.
 *
 * Displays found nodes with their index, tag, classes, and preview text
 * (plus where they are when outside the viewport or hidden, e.g.
 * `(below fold)`), up to {@link QUERY_DISPLAY_LIMIT} of them (no match is an error, exit 83).
 * One line of next commands follows; they take the match's index, so they
 * work for matches in shadow roots and iframes too.
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
      node.value !== undefined && ` value="${node.value}"`,
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

  const exampleIndex = nodes[0]?.index ?? 0;

  return fmt
    .text(`Found ${count} node${count === 1 ? '' : 's'} matching "${selector}":`)
    .list(nodeLines)
    .list(count > QUERY_DISPLAY_LIMIT ? [moreMatchesNote(count - QUERY_DISPLAY_LIMIT)] : [])
    .tip(queryNextSteps(exampleIndex))
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
 * A string result is printed as is (not JSON-quoted), so text reads and
 * pipes like `echo`, unless that would read as another value (empty,
 * `undefined`, or valid JSON such as `42` or `[1,2]`): then it stays
 * JSON-quoted. Other values are formatted JSON, and values Chrome only
 * describes (functions, DOM nodes) their description. The iframe it ran in
 * (`--frame`) is reported on stderr, so stdout stays the bare value. `--json`
 * output is unchanged (the value in `data.result`).
 *
 * @param data - DOM eval result containing the evaluated value
 * @returns The string, or formatted JSON
 *
 * @example
 * ```typescript
 * formatDomEval({ result: 'My Page Title', type: 'string' });
 * // Output: My Page Title
 *
 * formatDomEval({ result: { url: 'https://example.com', title: 'Example' }, type: 'object' });
 * // Output:
 * // {
 * //   "url": "https://example.com",
 * //   "title": "Example"
 * // }
 * ```
 */
export function formatDomEval(data: { result: unknown; type?: string }): string {
  if (data.type === 'undefined') return 'undefined';
  const { result } = data;
  if (typeof result === 'string' && (data.type !== 'string' || !looksLikeOtherValue(result))) {
    return result;
  }
  return JSON.stringify(result ?? null, null, 2);
}

/**
 * Whether a string printed as is would read as another value: empty,
 * `undefined`, or valid JSON (`42`, `true`, `null`, `[1,2]`, `{"a":1}`).
 *
 * @param text - String result
 * @returns True when it must be JSON-quoted to read as a string
 */
function looksLikeOtherValue(text: string): boolean {
  if (text === '' || text === 'undefined') return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format the page's iframes, one per line, nested frames indented below
 * their parent. While the page is still loading (`readyState` set), the list
 * may be incomplete, and says so.
 *
 * @param data - Frames from `bdg dom frames`, with the readyState of a page still loading
 * @returns Formatted list
 *
 * @example
 * ```
 * [0] http://localhost:3000/widget  name=widget  same-origin
 * [1] https://pay.example/  #checkout  cross-origin, out-of-process
 *   [2] about:blank  same-origin
 * ```
 */
export function formatDomFrames(data: { frames: DomFrame[]; readyState?: string }): string {
  const loading = data.readyState !== undefined && data.readyState !== 'complete';
  if (data.frames.length === 0) return loading ? framesStillLoadingNote(true) : noFramesMessage();
  const depthOf = new Map<number, number>();
  const lines = data.frames.map((frame) => {
    const depth = frame.parentIndex === undefined ? 0 : (depthOf.get(frame.parentIndex) ?? 0) + 1;
    depthOf.set(frame.index, depth);
    return '  '.repeat(depth) + frameLabel(frame);
  });
  return [...lines, ...(loading ? [framesStillLoadingNote(false)] : [])].join('\n');
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
 *
 * // An element whose floated children overflow it
 * // Output: Screenshot saved to ./el.png (grown from 940×37 to 940×285 to include content overflowing the element)
 * ```
 */
export function formatDomScreenshot(data: ScreenshotResult): string {
  let output = `Screenshot saved to ${data.path}`;

  if (data.fullPageSkipped && !data.scrolledTo) {
    output += ' (viewport only - page too tall)';
  }

  if (data.element?.captured) {
    output += ` (${screenshotGrownNote(data.element.bounds, data.element.captured)})`;
  }

  return output;
}
