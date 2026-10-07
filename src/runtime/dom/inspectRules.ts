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
 * The stylesheet headers seen on a connection (after {@link trackStyleSheets}
 * and `CSS.enable`).
 *
 * @param cdp - CDP connection
 * @returns Headers
 */
export function styleSheetHeaders(cdp: CDPConnection): Iterable<Protocol.CSS.CSSStyleSheetHeader> {
  return headersByConnection.get(cdp)?.values() ?? [];
}

/** Matched styles of an element, or why they are missing */
export type MatchedStyles =
  Protocol.CSS.GetMatchedStylesForNodeResponse | 'timeout' | 'failed' | 'skipped';

/** A matched-styles request, with its answer once it came */
interface MatchedRequest {
  promise: Promise<Protocol.CSS.GetMatchedStylesForNodeResponse | 'failed'>;
  answer?: Protocol.CSS.GetMatchedStylesForNodeResponse | 'failed';
}

/** What is known about the matched styles of the current document */
interface DocumentStyles {
  /** Requests by node id, least recently used first */
  requests: Map<number, MatchedRequest>;
  /** The request Chrome is working on */
  running?: Promise<unknown> | undefined;
  /** A read took longer than its budget on this document */
  slow: boolean;
}

/** Answers kept per document (one can be several MB on CSS-heavy pages) */
const MAX_KEPT_ANSWERS = 4;

/** Events after which kept answers may be stale (a navigation resets everything) */
const STYLE_CHANGE_EVENTS = [
  'CSS.styleSheetAdded',
  'CSS.styleSheetChanged',
  'CSS.styleSheetRemoved',
  'CSS.mediaQueryResultChanged',
  'DOM.attributeModified',
  'DOM.attributeRemoved',
  'DOM.inlineStyleInvalidated',
  'DOM.childNodeInserted',
  'DOM.childNodeRemoved',
  'DOM.childNodeCountUpdated',
  'DOM.pseudoElementAdded',
  'DOM.pseudoElementRemoved',
];

/** Matched-styles state per connection */
const documentStylesByConnection = new WeakMap<CDPConnection, DocumentStyles>();

/**
 * The matched-styles state of a connection, tracked from its first use: a
 * new document (`DOM.documentUpdated`) starts afresh, style and DOM changes
 * drop the kept answers. Events of other sessions (iframes) are ignored.
 *
 * @param cdp - CDP connection
 * @returns State
 */
function documentStyles(cdp: CDPConnection): DocumentStyles {
  const existing = documentStylesByConnection.get(cdp);
  if (existing) return existing;
  const state: DocumentStyles = { requests: new Map(), slow: false };
  documentStylesByConnection.set(cdp, state);
  cdp.on('DOM.documentUpdated', (_params, sessionId) => {
    if (sessionId) return;
    state.requests.clear();
    state.slow = false;
  });
  for (const event of STYLE_CHANGE_EVENTS) {
    cdp.on(event, (_params, sessionId) => {
      if (!sessionId) state.requests.clear();
    });
  }
  return state;
}

/**
 * Send a matched-styles request and keep it, dropping the least recently
 * used answers beyond {@link MAX_KEPT_ANSWERS}. A failed one is not kept.
 *
 * @param cdp - CDP connection
 * @param state - Document state
 * @param nodeId - Node id of the element
 * @returns The request
 */
function sendMatchedRequest(
  cdp: CDPConnection,
  state: DocumentStyles,
  nodeId: number
): MatchedRequest {
  const request: MatchedRequest = {
    promise: cdp
      .send('CSS.getMatchedStylesForNode', { nodeId })
      .then((response) => response as Protocol.CSS.GetMatchedStylesForNodeResponse)
      .catch((error: unknown) => {
        log.debug(`CSS.getMatchedStylesForNode failed: ${String(error)}`);
        return 'failed' as const;
      }),
  };
  state.running = request.promise;
  void request.promise.then((answer) => {
    request.answer = answer;
    if (state.running === request.promise) state.running = undefined;
    if (answer === 'failed' && state.requests.get(nodeId) === request) {
      state.requests.delete(nodeId);
    }
  });
  state.requests.set(nodeId, request);
  for (const oldest of state.requests.keys()) {
    if (state.requests.size <= MAX_KEPT_ANSWERS) break;
    state.requests.delete(oldest);
  }
  return request;
}

/**
 * The element's request, sent once Chrome has answered the one it is
 * working on (another element's, or this one's sent by a concurrent call).
 *
 * @param cdp - CDP connection
 * @param state - Document state
 * @param nodeId - Node id of the element
 * @param deadline - When to give up waiting
 * @returns The request, or undefined when the running one outlasted the deadline
 */
async function requestWhenFree(
  cdp: CDPConnection,
  state: DocumentStyles,
  nodeId: number,
  deadline: number
): Promise<MatchedRequest | undefined> {
  while (state.running) {
    const kept = state.requests.get(nodeId);
    if (kept) return kept;
    if ((await raceTimeout(state.running, deadline - Date.now())) === undefined) return undefined;
  }
  return state.requests.get(nodeId) ?? sendMatchedRequest(cdp, state, nodeId);
}

/**
 * The rules that match an element, with its inline style and what its
 * ancestors pass down, or why they are missing. An answer (or a request
 * still running) for the element is reused until the document, its
 * stylesheets or its DOM change; another element's request is sent only
 * after the one Chrome is working on, within the budget. Once a read took
 * longer than its budget, `skipWhenSlow` reads on the same document return
 * `skipped` at once unless the answer is already there.
 *
 * @param cdp - CDP connection
 * @param nodeId - Node id of the element
 * @param budgetMs - Time allowed
 * @param options - `skipWhenSlow`: do not wait on a document known to be slow (the default hints)
 * @returns Matched styles, `timeout` (longer than the budget), `failed` (CDP error)
 *   or `skipped` (slow document)
 */
export async function matchedStyles(
  cdp: CDPConnection,
  nodeId: number,
  budgetMs: number,
  options: { skipWhenSlow?: boolean } = {}
): Promise<MatchedStyles> {
  const state = documentStyles(cdp);
  const kept = state.requests.get(nodeId);
  if (kept) {
    state.requests.delete(nodeId);
    state.requests.set(nodeId, kept);
  }
  if (kept?.answer) return kept.answer;
  if (options.skipWhenSlow && state.slow) return 'skipped';
  const deadline = Date.now() + budgetMs;
  const request = kept ?? (await requestWhenFree(cdp, state, nodeId, deadline));
  const answer = request && (await raceTimeout(request.promise, deadline - Date.now()));
  if (answer) return answer;
  state.slow = true;
  return 'timeout';
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
  return `${source.selector ?? ''} (${stylesheetPositionLabel(header, source.line, source.column)})`;
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
export function stylesheetPositionLabel(
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
