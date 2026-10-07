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
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  actionBrokenByPageError,
  actionScriptFailedError,
  emptySelectorError,
  indexOutOfRangeError,
  noNodesFoundError,
  staleNodeError,
} from '@/errors/messages.js';
import { COMPOSED_JS, FLAT_TEXT_JS } from '@/runtime/dom/elementInfo.js';
import { ActionScriptError, throwIfInvalidSelector } from '@/runtime/dom/formFillHelpers/shared.js';
import { frameScopedConnection } from '@/runtime/dom/frameScopedConnection.js';
import { evaluateInBdgWorld } from '@/runtime/page/bdgWorld.js';
import { findReplacedBuiltins } from '@/runtime/page/replacedBuiltins.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  brokenByReplacedBuiltinsSuggestion,
  replacedBuiltinsWarning,
} from '@/ui/messages/commands.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  parseSelectorFilters,
  type ScopedStep,
  type SelectorFilter,
} from '@/utils/selectorFilters.js';

/** Selector placeholder that makes page scripts use the bound node. */
export const BOUND_TARGET_SELECTOR = '__bdg_bound_target__';

/** Removes the node bound for index-based commands, and matches bound for a selector, from the window they were stored on */
export const UNBIND_TARGET_SCRIPT = 'delete window.__bdgTarget; delete window.__bdgMatches';

/**
 * Built-ins the selector search ({@link DEEP_QUERY_JS}) cannot do without:
 * when the page replaced one, the search runs in bdg's world instead.
 * Helpers that libraries replace with working versions (Prototype.js's
 * `Array.prototype.map`) are left to {@link SCRIPT_BUILTINS}.
 */
const SELECTION_BUILTINS = [
  'Element.prototype.querySelectorAll',
  'Element.prototype.querySelector',
  'Document.prototype.querySelectorAll',
  'Document.prototype.querySelector',
  'DocumentFragment.prototype.querySelectorAll',
  'Element.prototype.matches',
  'Element.prototype.closest',
  'Node.prototype.getRootNode',
  'Node.prototype.compareDocumentPosition',
  'Node.prototype.contains',
  'NodeList.prototype[Symbol.iterator]',
  'Array.prototype[Symbol.iterator]',
  'Array.prototype.push',
  'Set',
  'Map',
];

/** Other built-ins the interaction scripts use */
const SCRIPT_BUILTINS = [
  'Array.from',
  'Array.prototype.map',
  'Array.prototype.filter',
  'Array.prototype.forEach',
  'Array.prototype.some',
  'Array.prototype.find',
  'Array.prototype.includes',
  'Object.keys',
  'Object.assign',
  'Object.getOwnPropertyDescriptor',
  'Function.prototype.call',
  'JSON.stringify',
  'JSON.parse',
];

/** DOM built-ins the interaction scripts act through (anti-bot scripts often make them throw) */
const DOM_ACTION_BUILTINS = [
  'Element.prototype.getBoundingClientRect',
  'Element.prototype.getClientRects',
  'Element.prototype.scrollIntoView',
  'window.getComputedStyle',
  'Document.prototype.elementFromPoint',
  'Document.prototype.createEvent',
  'EventTarget.prototype.dispatchEvent',
  'HTMLElement.prototype.focus',
  'HTMLElement.prototype.blur',
  'HTMLElement.prototype.click',
  'Event',
  'MouseEvent',
  'HTMLInputElement.prototype.value',
  'HTMLTextAreaElement.prototype.value',
  'HTMLSelectElement.prototype.value',
];

/** Matches bound for a selector when the page replaced the selector search built-ins (enough for --index) */
const MATCH_BIND_LIMIT = 100;

/** Page-side: stores a node as match `i` of the selector being bound on the top window (runs on the node, in its frame; a cross-origin frame cannot reach the top window and fails) */
const BIND_MATCH_FUNCTION = `function (selector, i) {
  const w = window.top;
  if (!w.__bdgMatches || w.__bdgMatches.selector !== selector) return false;
  w.__bdgMatches.nodes[i] = this;
  return true;
}`;

const log = createLogger('dom');

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
 * use their value. Text is read in the flat tree, as `bdg dom query` shows
 * it: the text a web component's open shadow root renders, slotted content
 * in place of its slots. A visible component, slot or element holding either
 * ({@link COMPOSED_JS}) is read with {@link FLAT_TEXT_JS}, including the
 * selects and editable regions `innerText` reads. Whitespace is collapsed;
 * filter texts arrive normalized (`has-text` lowercased). `:visible` is
 * checked before the text filters, which read the text.
 *
 * Steps and `:has()` match CSS relative to an element (`:scope > css`). A
 * descendant step also searches the open shadow roots under the element (the
 * whole step CSS inside one shadow tree); a child step stays in the
 * element's own tree.
 */
export const FILTER_MATCHING_JS = `(shadowRoots) => {
  const composed = ${COMPOSED_JS};
  const flatText = ${FLAT_TEXT_JS};
  const skipped = /^(script|style|noscript|template)$/;
  const hiddenText = (el) => {
    const nodes = el.localName === 'slot' ? el.assignedNodes({ flatten: true }) : (el.shadowRoot || el).childNodes;
    let text = '';
    for (const node of nodes) {
      if (node.nodeType === 3) text += node.data;
      else if (node.nodeType === 1 && !skipped.test(node.localName)) text += hiddenText(node);
    }
    return text;
  };
  const textOf = (el) => {
    if (el.localName === 'input' && /^(submit|button|reset)$/i.test(el.type)) return el.value;
    const rendered = typeof el.innerText === 'string' &&
      (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));
    const text = !rendered ? hiddenText(el) : composed(el) ? flatText(el, Infinity, true) : el.innerText;
    return text.replace(/\\s+/g, ' ').trim();
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
 * the matches bound for the selector when the page replaced the search
 * built-ins ({@link bindMatches}), otherwise all matches of the selector
 * ({@link DEEP_QUERY_JS}).
 */
export const FIND_ELEMENTS_JS = `function (selector, parts) {
  if (selector === '${BOUND_TARGET_SELECTOR}') {
    const el = window.__bdgTarget;
    return el && el.isConnected ? [el] : [];
  }
  const bound = window.__bdgMatches;
  if (bound && bound.selector === selector) {
    const connected = [];
    for (let i = 0; i < bound.nodes.length; i++) {
      if (bound.nodes[i] && bound.nodes[i].isConnected) connected[connected.length] = bound.nodes[i];
    }
    return connected;
  }
  return (${DEEP_QUERY_JS})(selector, parts);
}`;

/**
 * Page-side check of what selectors cannot search in the top document:
 * iframes whose document cannot be read (cross-origin) and `<object>`/`<embed>`
 * elements. Cheap: no frame is entered.
 */
export const UNSEARCHED_CONTENT_JS = `(() => {
  const frames = Array.from(document.querySelectorAll('iframe, frame'));
  const unreadable = (frame) => {
    try { return !frame.contentDocument; } catch (e) { return true; }
  };
  return { crossOriginFrames: frames.some(unreadable), embeds: !!document.querySelector('object, embed') };
})()`;

/** Elements whose ids or classes are read for "did you mean" (bounds the work on huge pages) */
const NAME_SCAN_LIMIT = 5000;

/**
 * Page-side ids (`kind` "id") or classes (`kind` "class") in the top
 * document, from the first {@link NAME_SCAN_LIMIT} elements that have one.
 *
 * @param kind - Which names to read
 * @returns Expression evaluating to the distinct names
 */
export function pageNamesJS(kind: 'id' | 'class'): string {
  return `(() => {
  const names = new Set();
  const elements = document.querySelectorAll('[${kind}]');
  for (let i = 0; i < elements.length && i < ${NAME_SCAN_LIMIT}; i++) {
    const el = elements[i];
    ${kind === 'id' ? 'if (el.id) names.add(el.id);' : 'for (const name of el.classList) names.add(name);'}
  }
  return Array.from(names);
})()`;
}

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
 * the scripts run in the top page, so the node goes on the top window, which
 * same-origin frames can reach. A cross-origin frame cannot write to the top
 * window: the node then goes on its own window (`"frame"`) and the scripts
 * run in that frame ({@link frameScopedConnection}).
 */
const BIND_FUNCTION = `function () {
  if (!this.isConnected) return false;
  try { window.top.__bdgTarget = this; return 'top'; } catch (e) { window.__bdgTarget = this; return 'frame'; }
}`;

/** Selector and index the page scripts should use, and the connection to run them on. */
export interface ScriptTarget {
  selector: string;
  index?: number;
  /** Connection for the page scripts (scoped to the element's frame when the top page cannot reach it) */
  cdp: CDPConnection;
  /** Built-ins the page replaced that the page scripts use (they run in the page's world) */
  replacedBuiltins?: string[];
  /** The page replaced the selector search, so the matches were found in bdg's world */
  boundInBdgWorld?: boolean;
}

/**
 * Make the node with `backendNodeId` the target of the next page script.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id from the query cache
 * @returns Connection for the page scripts: the session's, or one running them
 *   in the node's frame when that frame is cross-origin
 * @throws CommandError (exit 87) when the node no longer exists in the page
 */
async function bindTargetNode(cdp: CDPConnection, backendNodeId: number): Promise<CDPConnection> {
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
  const scope = bound.result?.value;
  if (scope === 'frame') return frameScopedConnection(cdp, objectId);
  if (scope !== 'top') throw stale;
  return cdp;
}

/**
 * Resolve what a page script should target for an interaction request.
 *
 * @param cdp - CDP connection
 * @param params - Request with a selector (and optional index) or a backend node id
 * @returns Selector/index for the page script and the connection to run it on
 */
async function resolveScriptTarget(
  cdp: CDPConnection,
  params: { selector?: string; index?: number; backendNodeId?: number }
): Promise<ScriptTarget> {
  if (params.backendNodeId === undefined) {
    const selector = params.selector ?? '';
    const replaced = await replacedBuiltins(cdp);
    const searchReplaced = replaced.some((name) => SELECTION_BUILTINS.includes(name));
    const bound = searchReplaced && (await bindMatches(cdp, selector, params.index ?? 0));
    return {
      selector,
      ...(params.index !== undefined && { index: params.index }),
      cdp,
      ...(replaced.length > 0 && { replacedBuiltins: replaced }),
      ...(bound && { boundInBdgWorld: true }),
    };
  }
  const scriptCdp = await bindTargetNode(cdp, params.backendNodeId);
  const replaced = await replacedBuiltins(scriptCdp);
  return {
    selector: BOUND_TARGET_SELECTOR,
    cdp: scriptCdp,
    ...(replaced.length > 0 && { replacedBuiltins: replaced }),
  };
}

/**
 * The built-ins the interaction scripts use that the page replaced.
 *
 * @param cdp - CDP connection
 * @returns Their dotted names (empty when all are the browser's, or the check failed)
 */
function replacedBuiltins(cdp: CDPSender): Promise<string[]> {
  return findReplacedBuiltins(cdp, [
    ...SELECTION_BUILTINS,
    ...SCRIPT_BUILTINS,
    ...DOM_ACTION_BUILTINS,
  ]);
}

/**
 * Search the selector in bdg's own world, where the page's replacements do
 * not apply, and hand the matches (the first {@link MATCH_BIND_LIMIT}, or up
 * to the index asked for) to the page scripts, which run in the page's world.
 * When a match cannot be handed over (or the search fails other than on an
 * invalid selector), nothing is bound and the scripts search themselves.
 *
 * @param cdp - CDP connection
 * @param selector - Selector as the user gave it
 * @param index - Match the action is for
 * @returns Whether the matches were bound
 * @throws CommandError (81) for an invalid selector
 */
async function bindMatches(cdp: CDPConnection, selector: string, index: number): Promise<boolean> {
  const objectGroup = `bdg-bind-${Date.now()}`;
  const limit = Math.max(MATCH_BIND_LIMIT, index + 1);
  try {
    const found = await evaluateInBdgWorld(cdp, {
      expression: `(${DEEP_QUERY_JS})(${selectorArgsJS(selector)}).slice(0, ${limit})`,
      objectGroup,
    });
    if (found.exceptionDetails) throwIfInvalidSelector(found.exceptionDetails, selector);
    const arrayId = found.result.objectId;
    if (found.exceptionDetails || !arrayId) return false;
    const { result } = (await cdp.send('Runtime.getProperties', {
      objectId: arrayId,
      ownProperties: true,
    })) as Protocol.Runtime.GetPropertiesResponse;
    const matches = result
      .filter((property) => /^\d+$/.test(property.name))
      .map((property) => ({ i: Number(property.name), objectId: property.value?.objectId }));
    await cdp.send('Runtime.evaluate', {
      expression: `window.__bdgMatches = { selector: ${JSON.stringify(selector)}, nodes: [] }`,
    });
    const bound = await Promise.all(
      matches.map(({ i, objectId }) =>
        objectId ? bindMatch(cdp, selector, i, objectId) : Promise.resolve(false)
      )
    );
    if (bound.every(Boolean)) return true;
    await cdp.send('Runtime.evaluate', { expression: 'delete window.__bdgMatches' });
    return false;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    log.debug(`Matches not bound: ${getErrorMessage(error)}`);
    return false;
  } finally {
    await cdp
      .send('Runtime.releaseObjectGroup', { objectGroup })
      .catch((error: unknown) => log.debug(`Matches not released: ${getErrorMessage(error)}`));
  }
}

/**
 * Hand one match from bdg's world to the page's world as match `i`.
 *
 * @param cdp - CDP connection
 * @param selector - Selector the matches are for
 * @param i - Its position among the matches
 * @param objectId - The match in bdg's world
 * @returns Whether it was handed over
 */
async function bindMatch(
  cdp: CDPConnection,
  selector: string,
  i: number,
  objectId: string
): Promise<boolean> {
  try {
    const { node } = (await cdp.send('DOM.describeNode', {
      objectId,
    })) as Protocol.DOM.DescribeNodeResponse;
    const resolved = (await cdp.send('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
    })) as Protocol.DOM.ResolveNodeResponse;
    if (!resolved.object.objectId) return false;
    const stored = (await cdp.send('Runtime.callFunctionOn', {
      objectId: resolved.object.objectId,
      functionDeclaration: BIND_MATCH_FUNCTION,
      arguments: [{ value: selector }, { value: i }],
      returnByValue: true,
    })) as Protocol.Runtime.CallFunctionOnResponse;
    return stored.result.value === true;
  } catch (error) {
    log.debug(`Match ${i} not bound: ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * Whether an error is about the bound node: the placeholder only appears in
 * "not found" messages, which for a bound node mean it left the page.
 *
 * @param text - Error message
 * @returns True when the bound node was not found
 */
function boundNodeMissing(text: string | undefined): boolean {
  return text?.includes(BOUND_TARGET_SELECTOR) === true;
}

/**
 * Run an interaction on the element a request targets. Results and errors
 * never show the internal placeholder: a bound node the page scripts could
 * not find is reported as stale (87), and results carry the user's selector.
 * On a page that replaced the selector search, a result warns that the
 * element was found in bdg's world; on a page that replaced built-ins the
 * scripts use, a failure adds that they may be the cause, and a script that
 * threw is reported as broken by the page (90), naming them.
 *
 * @param cdp - CDP connection
 * @param params - Request with a selector (and optional index) or a backend node id
 * @param work - The interaction, given the script target
 * @returns The interaction's result
 * @throws CommandError (87) when the bound node left the page during the
 *   action, (90) when its script threw on a page that replaced built-ins
 */
export async function onScriptTarget<
  T extends {
    selector?: string;
    error?: string;
    suggestion?: string;
    exitCode?: number;
    warning?: string;
    replacedBuiltins?: string[];
  },
>(
  cdp: CDPConnection,
  params: { selector?: string; index?: number; backendNodeId?: number },
  work: (target: ScriptTarget) => Promise<T>
): Promise<T> {
  const err = staleNodeError();
  let target: ScriptTarget | undefined;
  try {
    target = await resolveScriptTarget(cdp, params);
    const replaced = target.replacedBuiltins ?? [];
    const result = withReplacedBuiltins(
      withUserSelector(await work(target), params.selector),
      target.boundInBdgWorld ? replaced : []
    );
    if (result.error && replaced.length > 0) {
      return { ...result, suggestion: withBrokenHint(result.suggestion, replaced) };
    }
    if (!boundNodeMissing(result.error)) return result;
    return {
      ...result,
      error: err.message,
      suggestion: err.suggestion,
      exitCode: EXIT_CODES.STALE_CACHE,
    };
  } catch (error) {
    const replaced = target?.replacedBuiltins ?? [];
    if (error instanceof ActionScriptError) {
      throw actionScriptFailure(error, replaced, params.selector ?? '');
    }
    if (error instanceof CommandError && replaced.length > 0) {
      const suggestion = error.metadata['suggestion'];
      throw new CommandError(
        error.message,
        {
          suggestion: withBrokenHint(
            typeof suggestion === 'string' ? suggestion : undefined,
            replaced
          ),
        },
        error.exitCode
      );
    }
    if (!(error instanceof CommandError) || !boundNodeMissing(error.message)) throw error;
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
  } finally {
    if (target && target.cdp !== cdp) unbindInFrame(target.cdp);
  }
}

/**
 * The error for an action script that threw: on a page that replaced
 * built-ins the scripts use, that the page broke it (90, naming them);
 * otherwise what it threw (110), with the user's selector.
 *
 * @param error - What the action reported
 * @param replaced - Built-ins the page replaced
 * @param selector - Selector the user gave (or the cached query's selector)
 * @returns Error to throw
 */
function actionScriptFailure(
  error: ActionScriptError,
  replaced: string[],
  selector: string
): CommandError {
  if (replaced.length > 0) {
    const err = actionBrokenByPageError(error.action, error.exception, replaced);
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_CONFLICT
    );
  }
  const err = actionScriptFailedError(error.action, error.exception, selector);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
}

/**
 * Remove a node bound in a cross-origin frame from that frame's window
 * (through the scoped connection, so the script runs where the bind ran; the
 * session removes the one bound on the top window after every interaction).
 * Not waited for.
 *
 * @param frameConnection - Connection scoped to the node's frame
 */
function unbindInFrame(frameConnection: CDPConnection): void {
  void frameConnection
    .send('Runtime.evaluate', { expression: UNBIND_TARGET_SCRIPT })
    .catch((error: unknown) => log.debug(`Frame target not unbound: ${getErrorMessage(error)}`));
}

/**
 * A failed action's suggestion with the hint that the page's replaced
 * built-ins may have broken it.
 *
 * @param suggestion - The action's own suggestion
 * @param replaced - Built-ins the page replaced
 * @returns Both, the action's first
 */
function withBrokenHint(suggestion: string | undefined, replaced: string[]): string {
  const hint = brokenByReplacedBuiltinsSuggestion(replaced);
  return suggestion ? `${suggestion}. ${hint}` : hint;
}

/**
 * Warn that the page replaced built-ins the page scripts use: they run in
 * the page's world, so the action may misbehave (the element itself was
 * found in bdg's world). The warning names the first few; `replacedBuiltins`
 * lists them all.
 *
 * @param result - Script result
 * @param replaced - Built-ins the page replaced
 * @returns Result with the warning added to any it has
 */
function withReplacedBuiltins<T extends { warning?: string; replacedBuiltins?: string[] }>(
  result: T,
  replaced: string[] | undefined
): T {
  if (!replaced || replaced.length === 0) return result;
  const warning = replacedBuiltinsWarning(replaced);
  return {
    ...result,
    warning: result.warning ? `${result.warning}; ${warning}` : warning,
    replacedBuiltins: replaced,
  };
}

/**
 * Report the user's selector instead of the internal placeholder.
 *
 * @param result - Script result
 * @param selector - Selector the user gave (or the cached query's selector)
 * @returns Result with the placeholder replaced
 */
function withUserSelector<T extends { selector?: string }>(
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
