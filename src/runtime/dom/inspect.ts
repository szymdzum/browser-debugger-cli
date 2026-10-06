/**
 * `bdg dom inspect`: what one element looks like, read in the daemon.
 *
 * The element is found like the other element commands find it (selector
 * with filters through open shadow roots and same-origin iframes, or the
 * exact cached node). Then, in parallel: one page-side walk on the element
 * ({@link INSPECT_PAGE_JS}: text, placement in the parent, backgrounds, child
 * tree), `dom layout`'s measurement (page position, hidden, covered,
 * offscreen) and, once the nodes are pushed to CDP, `CSS.getComputedStyleForNode`
 * for the element, its layout parent and its `::before`/`::after`,
 * `CSS.getPlatformFontsForNode` for its text and `DOM.getBoxModel`. DOM and
 * CSS are enabled on the first inspect and kept on. Matched rules are not
 * read (no cascade).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  operationFailedError,
  unknownCssPropertyError,
  whyAllPropertyError,
} from '@/errors/messages.js';
import type { DomInspectCommand } from '@/ipc/protocol/commands.js';
import type { InspectResult } from '@/ipc/protocol/inspectTypes.js';
import { throwIfInvalidSelector } from '@/runtime/dom/formFillHelpers/shared.js';
import { selectedProps } from '@/runtime/dom/inspectAllStyles.js';
import { buildCascadeFields } from '@/runtime/dom/inspectCascadeModel.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import { buildInspectResult, type InspectSources } from '@/runtime/dom/inspectModel.js';
import type { PlatformFont, PseudoSource } from '@/runtime/dom/inspectPaintModel.js';
import { matchedStyles, sourceLabel, trackStyleSheets } from '@/runtime/dom/inspectRules.js';
import { INSPECT_PAGE_JS, RELATED_NODE_JS, type RawInspect } from '@/runtime/dom/inspectScripts.js';
import { DEFAULT_TREE_DEPTH, DEFAULT_TREE_LIMIT } from '@/runtime/dom/inspectTree.js';
import { inspectLayout } from '@/runtime/dom/layout.js';
import { DEEP_QUERY_JS, missingElementError, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

const log = createLogger('dom');

/** Connections DOM and CSS were enabled on */
const stylesEnabled = new WeakSet<CDPConnection>();

/** Time allowed for the matched rules behind the default hints (large stylesheets take longer) */
const HINTS_BUDGET_MS = 1000;

/** Time allowed for them with --rules or --why */
const RULES_BUDGET_MS = 5000;

/** Distinguishes the object groups of concurrent calls */
let groupCounter = 0;

/** The element found, with how many matched */
interface FoundElement {
  objectId: string;
  count: number;
  index: number;
  /** How the match was chosen when no index was given and several matched */
  picked?: InspectResult['picked'];
}

/**
 * Page-side choice of a match: the index asked for, else the first visible
 * one (rendered, not `visibility: hidden`, not `opacity: 0`), else the first
 * rendered one, else the first
 */
const PICK_MATCH_JS = `function (i) {
  if (i !== null) return i;
  const check = (el, options) => (el.checkVisibility ? el.checkVisibility(options) : el.getClientRects().length > 0);
  const visible = Array.prototype.findIndex.call(this, (el) => check(el, { visibilityProperty: true, opacityProperty: true }));
  if (visible >= 0) return visible;
  const rendered = Array.prototype.findIndex.call(this, (el) => check(el, {}));
  return rendered < 0 ? 0 : rendered;
}`;

/** Nodes whose styles are read, as CDP describes them */
interface RelatedNodes {
  node: number;
  parent?: number;
  textHolder?: number;
  fontHolder?: number;
  pseudo: Array<{ type: PseudoSource['type']; backendNodeId: number }>;
}

/**
 * Inspect one element.
 *
 * @param cdp - CDP connection
 * @param params - Selector (and index) or backend node id, and options
 * @returns Inspect result
 * @throws CommandError (83) no match, (81) index out of range, invalid
 *   selector or unknown property, (87) the cached element left the page
 */
export async function inspectElement(
  cdp: CDPConnection,
  params: DomInspectCommand
): Promise<InspectResult> {
  const started = Date.now();
  if (params.why === 'all') {
    const err = whyAllPropertyError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const objectGroup = `bdg-inspect-${++groupCounter}`;
  try {
    const found = await findElement(cdp, params, objectGroup);
    const sources = await readSources(cdp, found.objectId, params, objectGroup);
    if (sources.raw.unknownWhy) throwUnknownProperties([params.why ?? ''], sources);
    const propValues = sources.props ? checkedProps(sources.props, sources) : undefined;
    const built = buildInspectResult(sources, {
      selector: params.selector,
      index: found.index,
      count: found.count,
      treeLimit: params.treeLimit ?? DEFAULT_TREE_LIMIT,
      ...(params.all && { all: true }),
      ...(propValues && { propValues }),
    });
    const withCascade = { ...built, ...cascadeFields(cdp, sources) };
    const result = found.picked ? { ...withCascade, picked: found.picked } : withCascade;
    log.debug(`Inspected ${result.element} in ${Date.now() - started} ms`);
    return result;
  } finally {
    void cdp
      .send('Runtime.releaseObjectGroup', { objectGroup })
      .catch((error: unknown) => log.debug(`Object group not released: ${getErrorMessage(error)}`));
  }
}

/**
 * The properties asked for with `--props`.
 *
 * @param names - Property names (custom property patterns expanded)
 * @param sources - What was read
 * @returns Values by name
 * @throws CommandError (81) for a name no value was found for
 */
function checkedProps(names: string[], sources: InspectSources): InspectResult['props'] {
  const { props, unknown } = selectedProps(
    names,
    sources.style,
    sources.raw.props,
    sources.raw.unknownProps
  );
  if (unknown.length === 0) return props;
  return throwUnknownProperties(unknown, sources);
}

/**
 * Reject names that are not CSS properties, with the closest computed ones.
 *
 * @param unknown - Names
 * @param sources - What was read (computed property names)
 * @throws CommandError (81) always
 */
function throwUnknownProperties(unknown: string[], sources: InspectSources): never {
  const suggestions = unknown.flatMap((name) =>
    findSimilar(name, Object.keys(sources.style), { maxSuggestions: 1 })
  );
  const err = unknownCssPropertyError(unknown, suggestions);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * `--props` names with custom property patterns expanded: `--*` gives every
 * custom property the element has (its own and inherited), `--bs-btn-*`
 * those with that prefix, sorted.
 *
 * @param names - Names asked for
 * @param style - Computed styles (custom properties included)
 * @returns Names
 */
function expandCustomPropertyPatterns(names: string[], style: StyleMap): string[] {
  return names.flatMap((name) => {
    if (!name.startsWith('--') || !name.endsWith('*')) return [name];
    const prefix = name.slice(0, -1);
    return Object.keys(style)
      .filter((key) => key.startsWith('--') && key.startsWith(prefix))
      .sort();
  });
}

/**
 * Hints, `--rules` and `--why` from the matched rules.
 *
 * @param cdp - CDP connection (stylesheet headers for the source labels)
 * @param sources - What was read
 * @returns Cascade fields, or `cascade: 'timeout' | 'failed'` when the rules were not read
 */
function cascadeFields(cdp: CDPConnection, sources: InspectSources): Partial<InspectResult> {
  if (!sources.matched) return {};
  if (typeof sources.matched === 'string') return { cascade: sources.matched };
  return buildCascadeFields({
    matched: sources.matched,
    style: sources.style,
    parentStyle: sources.parentStyle,
    replaced: sources.raw.replaced === true,
    formControl: sources.raw.formControl && sources.raw.hasText,
    ...(sources.hints === false && { hints: false }),
    label: (declaration) => sourceLabel(declaration, cdp),
    ...(sources.rules && { rules: true }),
    ...(sources.why && { why: sources.why }),
    ...(sources.raw.whyLonghands && { whyLonghands: sources.raw.whyLonghands }),
    ...(sources.raw.whyComputed && { whyComputed: sources.raw.whyComputed }),
    ...(sources.props && { props: sources.props }),
  });
}

/**
 * Find the element: the cached node, or the match at the index (default 0)
 * among the selector's matches.
 *
 * @param cdp - CDP connection
 * @param params - Selector (and index) or backend node id
 * @param objectGroup - Object group for the handles
 * @returns The element's remote object and the match count
 * @throws CommandError when there is no such element
 */
async function findElement(
  cdp: CDPConnection,
  params: DomInspectCommand,
  objectGroup: string
): Promise<FoundElement> {
  if (params.backendNodeId !== undefined) {
    const objectId = await resolveCachedNode(cdp, params.backendNodeId, objectGroup);
    if (!objectId) throw missingElementError(params, 0);
    return { objectId, count: 1, index: 0 };
  }
  const matches = await querySelector(cdp, params.selector, objectGroup);
  const [count, index] = await Promise.all([
    callOn<number>(cdp, matches, 'function () { return this.length; }', []),
    callOn<number>(cdp, matches, PICK_MATCH_JS, [params.index ?? null]),
  ]);
  const element = (await cdp.send('Runtime.callFunctionOn', {
    objectId: matches,
    functionDeclaration: 'function (i) { return this[i] || null; }',
    arguments: [{ value: index ?? 0 }],
    objectGroup,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  const objectId = element.result.objectId;
  if (!objectId) throw missingElementError(params, count ?? 0);
  return { objectId, count: count ?? 0, index: index ?? 0, ...pickedHow(params, count, index) };
}

/**
 * How a match was chosen, for the note on several matches.
 *
 * @param params - Command parameters (an explicit --index needs no note)
 * @param count - Number of matches
 * @param index - Index chosen
 * @returns `picked` when no index was given and several elements matched
 */
function pickedHow(
  params: DomInspectCommand,
  count: number | undefined,
  index: number | undefined
): Pick<FoundElement, 'picked'> {
  if (params.index !== undefined || (count ?? 0) < 2) return {};
  return { picked: (index ?? 0) > 0 ? 'first-visible' : 'first' };
}

/**
 * Resolve a cached node that is still in the page.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id from the query cache
 * @param objectGroup - Object group for the handle
 * @returns Remote object id, or undefined when the node left the page
 */
async function resolveCachedNode(
  cdp: CDPConnection,
  backendNodeId: number,
  objectGroup: string
): Promise<string | undefined> {
  const resolved = (await cdp
    .send('DOM.resolveNode', { backendNodeId, objectGroup })
    .catch((error: unknown) => {
      log.debug(`Node ${backendNodeId} not resolved: ${getErrorMessage(error)}`);
      return {};
    })) as Partial<Protocol.DOM.ResolveNodeResponse>;
  const objectId = resolved.object?.objectId;
  if (!objectId) return undefined;
  const connected = await callOn<boolean>(
    cdp,
    objectId,
    'function () { return this.isConnected; }',
    []
  );
  return connected ? objectId : undefined;
}

/**
 * Run the selector search ({@link DEEP_QUERY_JS}) and keep the array of matches.
 *
 * @param cdp - CDP connection
 * @param selector - Selector (filters allowed)
 * @param objectGroup - Object group for the array
 * @returns Remote object id of the array
 * @throws CommandError (81) invalid selector, (91) page script failure
 */
async function querySelector(
  cdp: CDPConnection,
  selector: string,
  objectGroup: string
): Promise<string> {
  const response = (await cdp.send('Runtime.evaluate', {
    expression: `(${DEEP_QUERY_JS})(${selectorArgsJS(selector)})`,
    objectGroup,
  })) as Protocol.Runtime.EvaluateResponse;
  if (response.exceptionDetails || !response.result.objectId) {
    if (response.exceptionDetails) throwIfInvalidSelector(response.exceptionDetails, selector);
    const err = operationFailedError(
      'find the element',
      response.exceptionDetails?.text ?? 'no result'
    );
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return response.result.objectId;
}

/**
 * Call a function on a remote object and return its value.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object (`this`)
 * @param functionDeclaration - Function source
 * @param args - Arguments (JSON values)
 * @returns The value, or undefined when the call threw
 */
async function callOn<T>(
  cdp: CDPConnection,
  objectId: string,
  functionDeclaration: string,
  args: unknown[]
): Promise<T | undefined> {
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  if (response.exceptionDetails) {
    log.debug(
      `Page function failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`
    );
    return undefined;
  }
  return response.result.value as T;
}

/**
 * Read everything about the element: the page-side walk, `dom layout`'s
 * measurement and the CDP styles, fonts and box.
 *
 * @param cdp - CDP connection
 * @param objectId - The element
 * @param params - Request
 * @param objectGroup - Object group for handles
 * @returns Inputs of {@link buildInspectResult}
 */
async function readSources(
  cdp: CDPConnection,
  objectId: string,
  params: DomInspectCommand,
  objectGroup: string
): Promise<InspectSources> {
  const related = await relatedNodes(cdp, objectId, objectGroup);
  const [raw, measured, styles] = await Promise.all([
    readPage(cdp, objectId, params),
    measure(cdp, params.selector, related.node),
    readStyles(cdp, related, params),
  ]);
  return {
    raw,
    ...styles,
    fonts: raw.textHolder ? styles.fonts.textHolder : styles.fonts.node,
    ...measured,
    ...(params.rules && { rules: true }),
    ...(params.why && { why: params.why }),
    ...(params.props && { props: expandCustomPropertyPatterns(params.props, styles.style) }),
    ...(params.hints === false && { hints: false }),
  };
}

/**
 * The page-side walk on the element.
 *
 * @param cdp - CDP connection
 * @param objectId - The element
 * @param params - Tree depth and `--props`
 * @returns Page-side measurements
 * @throws CommandError (91) when the walk fails
 */
async function readPage(
  cdp: CDPConnection,
  objectId: string,
  params: DomInspectCommand
): Promise<RawInspect> {
  const raw = await callOn<RawInspect>(cdp, objectId, INSPECT_PAGE_JS, [
    params.props || params.all ? 0 : (params.tree ?? DEFAULT_TREE_DEPTH),
    params.props ?? null,
    params.why ?? null,
  ]);
  if (raw) return raw;
  const err = operationFailedError('inspect the element', 'the page script failed');
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
}

/**
 * The backend node id of the element's layout parent, the element that
 * draws most of its text, or the parent of that text's nodes.
 *
 * @param cdp - CDP connection
 * @param objectId - The element
 * @param which - `parent`, `textHolder` or `fontHolder`
 * @param objectGroup - Object group for handles
 * @returns Backend node id, or undefined when there is none
 */
async function relatedNode(
  cdp: CDPConnection,
  objectId: string,
  which: 'parent' | 'textHolder' | 'fontHolder',
  objectGroup: string
): Promise<number | undefined> {
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: RELATED_NODE_JS,
    arguments: [{ value: which }],
    objectGroup,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  const id = response.result.objectId;
  return id ? (await describe(cdp, id)).backendNodeId : undefined;
}

/**
 * The backend node ids of the element, its layout parent, its text holder
 * (with the parent of its text nodes) and its generated pseudo-elements.
 *
 * @param cdp - CDP connection
 * @param objectId - The element
 * @param objectGroup - Object group for handles
 * @returns Backend node ids
 */
async function relatedNodes(
  cdp: CDPConnection,
  objectId: string,
  objectGroup: string
): Promise<RelatedNodes> {
  const [node, parent, textHolder, fontHolder] = await Promise.all([
    describe(cdp, objectId),
    relatedNode(cdp, objectId, 'parent', objectGroup),
    relatedNode(cdp, objectId, 'textHolder', objectGroup),
    relatedNode(cdp, objectId, 'fontHolder', objectGroup),
  ]);
  const pseudo = (node.pseudoElements ?? [])
    .filter((p) => p.pseudoType === 'before' || p.pseudoType === 'after')
    .map((p) => ({
      type: `::${p.pseudoType}` as PseudoSource['type'],
      backendNodeId: p.backendNodeId,
    }));
  return {
    node: node.backendNodeId,
    ...(parent && { parent }),
    ...(textHolder && textHolder !== node.backendNodeId && { textHolder }),
    ...(fontHolder && { fontHolder }),
    pseudo,
  };
}

/**
 * Describe a node (no tracking needed).
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the node
 * @returns CDP node description
 */
async function describe(cdp: CDPConnection, objectId: string): Promise<Protocol.DOM.Node> {
  const { node } = (await cdp.send('DOM.describeNode', {
    objectId,
  })) as Protocol.DOM.DescribeNodeResponse;
  return node;
}

/**
 * The element as `dom layout` measures it (page position, visibility, cover)
 * and the color scheme the page sees. Not fatal: without it the header has
 * no position.
 *
 * @param cdp - CDP connection
 * @param selector - Selector of the request
 * @param backendNodeId - The element
 * @returns Layout and color scheme
 */
async function measure(
  cdp: CDPConnection,
  selector: string,
  backendNodeId: number
): Promise<Pick<InspectSources, 'layout' | 'colorScheme'>> {
  try {
    const result = await inspectLayout(cdp, { selector, backendNodeId });
    const [layout] = result.elements;
    return {
      ...(layout && { layout }),
      ...(result.page.colorScheme && { colorScheme: result.page.colorScheme }),
    };
  } catch (error) {
    log.debug(`Layout not measured: ${getErrorMessage(error)}`);
    return {};
  }
}

/** Styles, fonts and size read through CDP */
interface CdpStyles {
  style: StyleMap;
  parentStyle?: StyleMap;
  /** Computed styles of the descendant that draws the text, when it is not the element */
  holderStyle?: StyleMap;
  pseudo: PseudoSource[];
  fonts: { node: PlatformFont[]; textHolder: PlatformFont[] };
  size?: { w: number; h: number };
  /** Matched rules (absent when not asked for); `timeout` when Chrome took too long */
  matched?: Protocol.CSS.GetMatchedStylesForNodeResponse | 'timeout' | 'failed';
}

/**
 * Node ids of the related nodes, for the CSS methods.
 *
 * @param cdp - CDP connection
 * @param related - Backend node ids
 * @returns Node id for a backend node id (undefined when it cannot be tracked)
 */
async function nodeIdLookup(
  cdp: CDPConnection,
  related: RelatedNodes
): Promise<(backendNodeId: number | undefined) => number | undefined> {
  const order = [
    related.node,
    related.parent,
    related.textHolder,
    related.fontHolder,
    ...related.pseudo.map((p) => p.backendNodeId),
  ];
  const ids = await pushNodes(
    cdp,
    order.filter((id): id is number => id !== undefined)
  );
  return (backendNodeId) => (backendNodeId === undefined ? undefined : ids.get(backendNodeId));
}

/**
 * Computed styles of the element, its parent and pseudo-elements, the
 * platform fonts of its text and its border box size.
 *
 * @param cdp - CDP connection
 * @param related - Backend node ids
 * @returns CDP styles
 */
async function readStyles(
  cdp: CDPConnection,
  related: RelatedNodes,
  params: DomInspectCommand
): Promise<CdpStyles> {
  await enableStyleDomains(cdp);
  const nodeIdOf = await nodeIdLookup(cdp, related);
  const optionalStyle = (backendNodeId: number | undefined): Promise<StyleMap | undefined> =>
    backendNodeId === undefined
      ? Promise.resolve(undefined)
      : computedStyle(cdp, nodeIdOf(backendNodeId));
  const [matched, style, parentStyle, holderStyle, nodeFonts, holderFonts, size, pseudo] =
    await Promise.all([
      readMatched(cdp, nodeIdOf(related.node), params),
      computedStyle(cdp, nodeIdOf(related.node)),
      optionalStyle(related.parent),
      optionalStyle(related.textHolder),
      platformFonts(cdp, nodeIdOf(related.node)),
      platformFonts(cdp, nodeIdOf(related.fontHolder)),
      borderBoxSize(cdp, related.node),
      Promise.all(
        related.pseudo.map((p) =>
          pseudoSource(cdp, p.type, p.backendNodeId, nodeIdOf(p.backendNodeId))
        )
      ),
    ]);
  return {
    style,
    ...(parentStyle && { parentStyle }),
    ...(holderStyle && { holderStyle }),
    pseudo,
    fonts: { node: nodeFonts, textHolder: holderFonts },
    ...(size && { size }),
    ...(matched && { matched }),
  };
}

/**
 * The element's matched rules, when hints, `--rules` or `--why` need them:
 * within {@link HINTS_BUDGET_MS} for the default hints (skipped on very
 * large stylesheets), {@link RULES_BUDGET_MS} when asked for explicitly.
 *
 * @param cdp - CDP connection
 * @param nodeId - Node id of the element
 * @param params - Request
 * @returns Matched styles, `timeout`, or undefined when not needed (or no node id)
 */
async function readMatched(
  cdp: CDPConnection,
  nodeId: number | undefined,
  params: DomInspectCommand
): Promise<CdpStyles['matched']> {
  const explicit = params.rules === true || params.why !== undefined;
  const skipped =
    !explicit && (params.hints === false || params.props !== undefined || params.all === true);
  if (nodeId === undefined || skipped) {
    return undefined;
  }
  return matchedStyles(cdp, nodeId, explicit ? RULES_BUDGET_MS : HINTS_BUDGET_MS);
}

/**
 * A pseudo-element's computed styles and size.
 *
 * @param cdp - CDP connection
 * @param type - `::before` or `::after`
 * @param backendNodeId - Its backend node id
 * @param nodeId - Its node id
 * @returns Pseudo source
 */
async function pseudoSource(
  cdp: CDPConnection,
  type: PseudoSource['type'],
  backendNodeId: number,
  nodeId: number | undefined
): Promise<PseudoSource> {
  const [style, size] = await Promise.all([
    computedStyle(cdp, nodeId),
    borderBoxSize(cdp, backendNodeId),
  ]);
  return { type, style, ...(size && { size: { w: Math.round(size.w), h: Math.round(size.h) } }) };
}

/**
 * Enable DOM and CSS once per connection (kept on: CSS.enable replays every
 * stylesheet, which costs up to a few hundred ms on large sites the first time).
 *
 * @param cdp - CDP connection
 */
async function enableStyleDomains(cdp: CDPConnection): Promise<void> {
  if (stylesEnabled.has(cdp)) return;
  trackStyleSheets(cdp);
  await cdp.send('DOM.enable', {});
  await cdp.send('CSS.enable', {});
  stylesEnabled.add(cdp);
}

/**
 * Node ids for backend node ids (CSS methods take node ids). When none can
 * be tracked, the document was never requested on this connection (or was
 * replaced by a navigation): it is requested, shallowly, and the push tried
 * again. A node that left the page meanwhile is simply missing.
 *
 * @param cdp - CDP connection
 * @param backendNodeIds - Backend node ids
 * @returns Node id per backend node id (missing when CDP cannot track it)
 */
async function pushNodes(
  cdp: CDPConnection,
  backendNodeIds: number[]
): Promise<Map<number, number>> {
  const push = async (): Promise<number[]> => {
    const response = (await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
      backendNodeIds,
    })) as Protocol.DOM.PushNodesByBackendIdsToFrontendResponse;
    return response.nodeIds;
  };
  let nodeIds = await push().catch(() => [] as number[]);
  if (nodeIds.every((id) => id === 0)) {
    await cdp.send('DOM.getDocument', { depth: 0 });
    nodeIds = await push().catch(() => [] as number[]);
  }
  return new Map(
    backendNodeIds.flatMap((backendNodeId, i) =>
      nodeIds[i] ? [[backendNodeId, nodeIds[i]] as const] : []
    )
  );
}

/**
 * Computed styles of a node.
 *
 * @param cdp - CDP connection
 * @param nodeId - Node id (none: empty)
 * @returns Styles by property name
 */
async function computedStyle(cdp: CDPConnection, nodeId: number | undefined): Promise<StyleMap> {
  if (!nodeId) return {};
  const response = (await cdp
    .send('CSS.getComputedStyleForNode', { nodeId })
    .catch((error: unknown) => {
      log.debug(`Computed style not read: ${getErrorMessage(error)}`);
      return { computedStyle: [] };
    })) as Protocol.CSS.GetComputedStyleForNodeResponse;
  return Object.fromEntries(response.computedStyle.map((entry) => [entry.name, entry.value]));
}

/**
 * Fonts Chrome rendered a node's own text with.
 *
 * @param cdp - CDP connection
 * @param nodeId - Node id (none: no fonts)
 * @returns Platform fonts
 */
async function platformFonts(
  cdp: CDPConnection,
  nodeId: number | undefined
): Promise<PlatformFont[]> {
  if (!nodeId) return [];
  const response = (await cdp
    .send('CSS.getPlatformFontsForNode', { nodeId })
    .catch((error: unknown) => {
      log.debug(`Platform fonts not read: ${getErrorMessage(error)}`);
      return { fonts: [] };
    })) as Protocol.CSS.GetPlatformFontsForNodeResponse;
  return response.fonts;
}

/**
 * Border box size of a node.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id
 * @returns Width and height, or undefined when it has no box (not rendered)
 */
async function borderBoxSize(
  cdp: CDPConnection,
  backendNodeId: number
): Promise<{ w: number; h: number } | undefined> {
  try {
    const { model } = (await cdp.send('DOM.getBoxModel', {
      backendNodeId,
    })) as Protocol.DOM.GetBoxModelResponse;
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, , , x4 = 0, y4 = 0] = model.border;
    return { w: Math.hypot(x2 - x1, y2 - y1), h: Math.hypot(x4 - x1, y4 - y1) };
  } catch (error) {
    log.debug(`No box model: ${getErrorMessage(error)}`);
    return undefined;
  }
}
