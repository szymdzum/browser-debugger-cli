/**
 * CDP side of `dom inspect`'s cascade: the stylesheet headers (where a rule
 * comes from), the matched rules of an element with a time budget, and
 * labels for a declaration's source.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { Declaration } from '@/runtime/dom/inspectCascade.js';
import { createLogger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';

const log = createLogger('dom');

/** Stylesheet headers by id, per connection (from `CSS.styleSheetAdded`) */
const headersByConnection = new WeakMap<
  CDPConnection,
  Map<string, Protocol.CSS.CSSStyleSheetHeader>
>();

/**
 * Start collecting stylesheet headers. Call before `CSS.enable`, which
 * reports every existing stylesheet; later ones arrive as they are added,
 * removed ones (navigations) are dropped.
 *
 * @param cdp - CDP connection
 */
export function trackStyleSheets(cdp: CDPConnection): void {
  if (headersByConnection.has(cdp)) return;
  const headers = new Map<string, Protocol.CSS.CSSStyleSheetHeader>();
  headersByConnection.set(cdp, headers);
  cdp.on<Protocol.CSS.StyleSheetAddedEvent>('CSS.styleSheetAdded', ({ header }) => {
    headers.set(header.styleSheetId, header);
  });
  cdp.on<Protocol.CSS.StyleSheetRemovedEvent>('CSS.styleSheetRemoved', ({ styleSheetId }) => {
    headers.delete(styleSheetId);
  });
}

/**
 * The rules that match an element, with its inline style and what its
 * ancestors pass down, or why they are missing.
 *
 * @param cdp - CDP connection
 * @param nodeId - Node id of the element
 * @param budgetMs - Time allowed
 * @returns Matched styles, `timeout` (longer than the budget) or `failed` (CDP error)
 */
export async function matchedStyles(
  cdp: CDPConnection,
  nodeId: number,
  budgetMs: number
): Promise<Protocol.CSS.GetMatchedStylesForNodeResponse | 'timeout' | 'failed'> {
  const request = cdp
    .send('CSS.getMatchedStylesForNode', { nodeId })
    .then((response) => response as Protocol.CSS.GetMatchedStylesForNodeResponse)
    .catch((error: unknown) => {
      log.debug(`CSS.getMatchedStylesForNode failed: ${String(error)}`);
      return 'failed' as const;
    });
  return (await raceTimeout(request, budgetMs)) ?? 'timeout';
}

/**
 * File name of a URL, without query or hash; the host for a site's root.
 *
 * @param url - Stylesheet (or page) URL
 * @returns e.g. `bootstrap.min.css`, `localhost:8765`
 */
function fileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1) ?? path;
}

/**
 * Where a declaration comes from, for people: the selector and the file
 * with its line (and column, for single-line minified files), or what kind
 * of style it is.
 *
 * @param declaration - Declaration
 * @param cdp - CDP connection whose stylesheet headers to use
 * @returns e.g. `.btn-primary (bootstrap.min.css:5:52628)`, `style attribute`, `browser default`
 */
export function sourceLabel(declaration: Declaration, cdp: CDPConnection): string {
  const { source } = declaration;
  if (source.kind === 'inline') return 'style attribute';
  if (source.kind === 'attribute') return 'HTML attribute';
  if (source.origin === 'user-agent') return `${source.selector ?? ''} (browser default)`.trim();
  const header = source.styleSheetId
    ? headersByConnection.get(cdp)?.get(source.styleSheetId)
    : undefined;
  return `${source.selector ?? ''} (${fileLabel(header, source.line, source.column)})`;
}

/**
 * A stylesheet position as `file:line[:column]`.
 *
 * @param header - Stylesheet header (unknown: just the line)
 * @param line - 0-based line within the stylesheet
 * @param column - 0-based column
 * @returns e.g. `app.css:12`, `bootstrap.min.css:5:52628`, `<style> in index.html:40`,
 *   `constructed stylesheet`, `<style> added by a script` (a sheet a script created and
 *   filled with `insertRule`: its lines are not in any file)
 */
function fileLabel(
  header: Protocol.CSS.CSSStyleSheetHeader | undefined,
  line: number | undefined,
  column: number | undefined
): string {
  if (!header) return line === undefined ? 'stylesheet' : `stylesheet:${line + 1}`;
  if (header.isConstructed) return 'constructed stylesheet';
  const file = fileName(header.sourceURL) || 'page';
  const where = header.isInline ? `<style> in ${file}` : file;
  if (header.isMutable && !header.sourceURL) return `<style> added by a script`;
  const absoluteLine = (line ?? 0) + (header.isInline ? header.startLine : 0) + 1;
  const firstLine = header.isInline && (line ?? 0) === 0;
  const absoluteColumn = (column ?? 0) + (firstLine ? header.startColumn : 0) + 1;
  const minified = header.endLine - header.startLine < 10 && (column ?? 0) > 200;
  return minified ? `${where}:${absoluteLine}:${absoluteColumn}` : `${where}:${absoluteLine}`;
}
