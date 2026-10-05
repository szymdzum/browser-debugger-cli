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
import {
  emptySelectorError,
  indexOutOfRangeError,
  noNodesFoundError,
  staleNodeError,
} from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  parseSelectorFilters,
  type ScopedStep,
  type SelectorFilter,
} from '@/utils/selectorFilters.js';

/** Selector placeholder that makes page scripts use the bound node. */
export const BOUND_TARGET_SELECTOR = '__bdg_bound_target__';

/**
 * Page-side matching of filters ({@link SelectorFilter}) and scoped steps
 * ({@link ScopedStep}): called with the open shadow roots of the page, returns
 * `{ passesAll, descend }`.
 *
 * Visible means rendered (`checkVisibility()`: not inside a closed
 * `<details>` or under `content-visibility: hidden`), a non-empty box and
 * `visibility: visible`, as in Playwright (`opacity: 0` still counts as
 * visible). Text is the rendered text (`innerText`) of visible elements and
 * the text nodes of hidden ones (display or visibility; not those of
 * `<script>`, `<style>` or `<noscript>`), so text filters match hidden
 * elements like Playwright's and `:visible` decides visibility; button inputs
 * use their value. Whitespace is collapsed; filter texts arrive normalized
 * (`has-text` lowercased). `:visible` is checked before the text filters,
 * which read the text.
 *
 * Steps and `:has()` match CSS relative to an element (`:scope > css`). A
 * descendant step also searches the open shadow roots under the element (the
 * whole step CSS inside one shadow tree); a child step stays in the
 * element's own tree.
 */
export const FILTER_MATCHING_JS = `(shadowRoots) => {
  const skipped = /^(script|style|noscript|template)$/;
  const hiddenText = (el) => {
    const walker = el.ownerDocument.createTreeWalker(el, 5, {
      acceptNode: (node) => (node.nodeType === 1 && skipped.test(node.localName) ? 2 : 1)
    });
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) text += node.data;
    }
    return text;
  };
  const textOf = (el) => {
    if (el.localName === 'input' && /^(submit|button|reset)$/i.test(el.type)) return el.value;
    const rendered = typeof el.innerText === 'string' &&
      (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));
    return (rendered ? el.innerText : hiddenText(el)).replace(/\\s+/g, ' ').trim();
  };
  const passes = (el, filter) => {
    if (filter.kind === 'visible') {
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility === 'visible';
    }
    if (filter.kind === 'has') return filter.selectors.some((chain) => descend(el, chain).length > 0);
    const text = textOf(el);
    return filter.kind === 'text-is' ? text === filter.text : text.toLowerCase().includes(filter.text);
  };
  const passesAll = (el, filters) =>
    filters.every((filter) => filter.kind !== 'visible' || passes(el, filter)) &&
    filters.every((filter) => filter.kind === 'visible' || passes(el, filter));
  const isUnder = (scope, node) => {
    for (let current = node; current; current = current.getRootNode().host) {
      if (scope === current || scope.contains(current)) return true;
    }
    return false;
  };
  const stepMatches = (scope, step) => {
    const matches = [...scope.querySelectorAll(':scope ' + step.combinator + ' ' + step.css)];
    if (step.combinator !== ' ') return matches;
    for (const root of shadowRoots) {
      if (isUnder(scope, root.host)) matches.push(...root.querySelectorAll(step.css));
    }
    return matches;
  };
  const descend = (scope, steps) => {
    let current = [scope];
    for (const step of steps) {
      const next = new Set();
      for (const el of current) {
        for (const match of stepMatches(el, step)) {
          if (passesAll(match, step.filters)) next.add(match);
        }
      }
      current = [...next];
    }
    return current;
  };
  return { passesAll: passesAll, descend: descend };
}`;

/**
 * Page-side selector search that also reaches into open shadow roots and
 * same-origin iframes (recursively), like a user sees the page.
 *
 * Takes the selector and, when it has text or visibility filters, its parts
 * from {@link parseSelectorFilters}: their CSS runs as one selector list and
 * a match is kept when it passes the filters of a part it matches; a part
 * with scoped steps contributes the steps' matches under it instead (each
 * element once). Matches come in document order: those of the document
 * first, then those of each shadow root and frame in the order they are
 * reached. Cross-origin iframes are separate processes and cannot be
 * searched. Throws a `SyntaxError` for an invalid selector.
 */
export const DEEP_QUERY_JS = `function (selector, parts) {
  const css = parts ? parts.map((part) => part.css).join(', ') : selector;
  const found = [];
  const roots = [];
  const visit = (root) => {
    roots.push(root);
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
  const shadowRoots = roots.filter((root) => root.host);
  const { passesAll, descend } = (${FILTER_MATCHING_JS})(shadowRoots);
  const result = new Set();
  for (const el of found) {
    for (const part of parts) {
      if (!el.matches(part.css) || !passesAll(el, part.filters)) continue;
      for (const match of descend(el, part.steps || [])) result.add(match);
    }
  }
  const rootOrder = new Map(roots.map((root, i) => [root, i]));
  const rootIndex = (el) => rootOrder.get(el.getRootNode()) ?? roots.length;
  return [...result].sort((a, b) =>
    rootIndex(a) - rootIndex(b) || (a.compareDocumentPosition(b) & 4 ? -1 : a === b ? 0 : 1)
  );
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
 * Page-side: the form control a `<label>` stands for (`label.control`: its
 * `for` target or the control inside it), or null for other elements and
 * labels without one. Fill, click and key presses act on that control, like
 * Playwright.
 */
export const LABEL_CONTROL_JS = `(el) => (el && el.localName === 'label' ? el.control : null)`;

/**
 * Arguments for {@link DEEP_QUERY_JS} / {@link FIND_ELEMENTS_JS} and the page
 * scripts built on them: the selector as a JS string literal and its parts
 * (`null` for plain CSS, which runs unchanged).
 *
 * @param selector - Selector as the user gave it (or the bound-node placeholder)
 * @returns JS source of the two arguments, e.g. `"li:visible", [{...}]`
 * @throws CommandError (81) for an empty selector or a misplaced or malformed filter
 */
export function selectorArgsJS(selector: string): string {
  if (selector.trim() === '') {
    const err = emptySelectorError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
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

/**
 * Error for an element a command could not find.
 *
 * @param target - Selector (and index) or backend node id the command was given
 * @param matchCount - Elements the selector matched
 * @returns Stale (87), out of range (81) or not found (83) error
 */
export function missingElementError(
  target: { selector: string; index?: number; backendNodeId?: number },
  matchCount: number
): CommandError {
  if (target.backendNodeId !== undefined) {
    const err = staleNodeError();
    return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
  }
  if (matchCount > 0) {
    const err = indexOutOfRangeError(target.index ?? 0, matchCount - 1);
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const err = noNodesFoundError(target.selector);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}
