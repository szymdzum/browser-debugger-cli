/**
 * Bind interaction scripts to an exact DOM node.
 *
 * Indices from `bdg dom query` / `bdg dom form` refer to one specific node
 * (by backend node id). Re-running the selector at action time would hit a
 * different element after the DOM changed, so the node itself is handed to
 * the page scripts: it is resolved through CDP and stored on `window`, and the
 * scripts' element lookup ({@link FIND_ELEMENTS_JS}) returns it for
 * {@link BOUND_TARGET_SELECTOR}.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { staleNodeError } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parseSelectorFilters, type SelectorFilter } from '@/utils/selectorFilters.js';

/** Selector placeholder that makes page scripts use the bound node. */
export const BOUND_TARGET_SELECTOR = '__bdg_bound_target__';

/**
 * Page-side test of one text or visibility filter ({@link SelectorFilter}).
 * Visible means a non-empty box and `visibility: visible`, as in Playwright
 * (`opacity: 0` still counts as visible). Text is the rendered text (`innerText`, `textContent` for elements without
 * it) with whitespace collapsed; filter texts arrive normalized (`has-text`
 * lowercased).
 */
const FILTER_MATCHES_JS = `(el, filter) => {
  if (filter.kind === 'visible') {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility === 'visible';
  }
  const text = (typeof el.innerText === 'string' ? el.innerText : el.textContent || '').replace(/\\s+/g, ' ').trim();
  return filter.kind === 'text-is' ? text === filter.text : text.toLowerCase().includes(filter.text);
}`;

/**
 * Page-side selector search that also reaches into open shadow roots and
 * same-origin iframes (recursively), like a user sees the page.
 *
 * Takes the selector and, when it has text or visibility filters, its parts
 * from {@link parseSelectorFilters}: their CSS runs as one selector list and
 * a match is kept when it passes the filters of a part it matches.
 * Matches of the document come first, then those of each shadow root and
 * frame in document order. Cross-origin iframes are separate processes and
 * cannot be searched. Throws a `SyntaxError` for an invalid selector.
 */
export const DEEP_QUERY_JS = `function (selector, parts) {
  const css = parts ? parts.map((part) => part.css).join(', ') : selector;
  const found = [];
  const visit = (root) => {
    for (const match of root.querySelectorAll(css)) found.push(match);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let frameDocument = null;
        try { frameDocument = el.contentDocument; } catch (e) { frameDocument = null; }
        if (frameDocument) visit(frameDocument);
      }
    }
  };
  visit(document);
  if (!parts) return found;
  const passes = ${FILTER_MATCHES_JS};
  return found.filter((el) => parts.some((part) => el.matches(part.css) && part.filters.every((filter) => passes(el, filter))));
}`;

/**
 * Page-side element lookup shared by the interaction scripts.
 *
 * Returns the bound node (if still in the page) for the placeholder selector,
 * otherwise all matches of the selector ({@link DEEP_QUERY_JS}).
 */
export const FIND_ELEMENTS_JS = `function (selector, parts) {
  if (selector === '${BOUND_TARGET_SELECTOR}') {
    const el = window.__bdgTarget;
    return el && el.isConnected ? [el] : [];
  }
  return (${DEEP_QUERY_JS})(selector, parts);
}`;

/**
 * Arguments for {@link DEEP_QUERY_JS} / {@link FIND_ELEMENTS_JS} and the page
 * scripts built on them: the selector as a JS string literal and its parts
 * (`null` for plain CSS, which runs unchanged).
 *
 * @param selector - Selector as the user gave it (or the bound-node placeholder)
 * @returns JS source of the two arguments, e.g. `"li:visible", [{...}]`
 * @throws CommandError (81) for a misplaced or malformed filter
 */
export function selectorArgsJS(selector: string): string {
  return `${JSON.stringify(selector)}, ${JSON.stringify(parseSelectorFilters(selector))}`;
}

/**
 * Store the node for the page scripts. It runs in the node's own frame, while
 * the scripts run in the top page, so the node goes on the top window (always
 * reachable for the same-origin frames bdg can target).
 */
const BIND_FUNCTION = `function () {
  let host = window;
  try { host = window.top; host.__bdgTarget = this; } catch (e) { host = window; host.__bdgTarget = this; }
  return this.isConnected;
}`;

/** Selector and index the page scripts should use. */
export interface ScriptTarget {
  selector: string;
  index?: number;
}

/**
 * Make the node with `backendNodeId` the target of the next page script.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id from the query cache
 * @throws CommandError (exit 87) when the node no longer exists in the page
 */
export async function bindTargetNode(cdp: CDPConnection, backendNodeId: number): Promise<void> {
  const err = staleNodeError();
  const stale = new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.STALE_CACHE
  );
  let objectId: string | undefined;
  try {
    const resolved = (await cdp.send('DOM.resolveNode', { backendNodeId })) as {
      object?: { objectId?: string };
    };
    objectId = resolved.object?.objectId;
  } catch {
    throw stale;
  }
  if (!objectId) throw stale;

  const bound = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: BIND_FUNCTION,
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  if (bound.result?.value !== true) throw stale;
}

/**
 * Resolve what a page script should target for an interaction request.
 *
 * @param cdp - CDP connection
 * @param params - Request with a selector (and optional index) or a backend node id
 * @returns Selector/index for the page script
 */
export async function resolveScriptTarget(
  cdp: CDPConnection,
  params: { selector?: string; index?: number; backendNodeId?: number }
): Promise<ScriptTarget> {
  if (params.backendNodeId === undefined) {
    return {
      selector: params.selector ?? '',
      ...(params.index !== undefined && { index: params.index }),
    };
  }
  await bindTargetNode(cdp, params.backendNodeId);
  return { selector: BOUND_TARGET_SELECTOR };
}

/**
 * Report the user's selector instead of the internal placeholder.
 *
 * @param result - Script result
 * @param selector - Selector the user gave (or the cached query's selector)
 * @returns Result with the placeholder replaced
 */
export function withUserSelector<T extends { selector?: string }>(
  result: T,
  selector: string | undefined
): T {
  if (result.selector !== BOUND_TARGET_SELECTOR) return result;
  return { ...result, ...(selector !== undefined && { selector }) };
}
