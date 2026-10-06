import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { unknownQueryFieldError } from '@/errors/messages.js';
import { callBdgScript, callCDP } from '@/ipc/client.js';
import { MASKED_VALUE, SENSITIVE_FIELD_JS } from '@/runtime/dom/elementInfo.js';
import { childFrameIds } from '@/runtime/dom/frameLayout.js';
import type { A11yNode, A11yTree, A11yQueryPattern, A11yQueryResult, NodeRef } from '@/types.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { levenshteinDistance } from '@/utils/levenshtein.js';

/**
 * Builds accessibility tree from raw CDP nodes.
 *
 * Pure function that filters out ignored nodes and builds the tree structure.
 * Children that are ignored are replaced by their own non-ignored children
 * (as DevTools shows the tree), so every `childIds` entry is in `nodes`, and
 * nodes are listed depth-first from the root (document order).
 * Separated from collectA11yTree for easier unit testing.
 *
 * @param rawNodes - Raw AXNode array from CDP
 * @returns Parsed accessibility tree
 * @throws Error if no root node found
 */
export function buildTreeFromRawNodes(rawNodes: Protocol.Accessibility.AXNode[]): A11yTree {
  const rawById = new Map(rawNodes.map((rawNode) => [rawNode.nodeId, rawNode]));
  const rootRaw = rawNodes.find((rawNode) => !rawNode.ignored);
  if (!rootRaw) {
    throw new CommandError(
      'No root node found in accessibility tree',
      { suggestion: 'The page may not be fully loaded. Wait and retry.' },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }

  const nodes = new Map<string, A11yNode>();
  const visit = (rawNode: Protocol.Accessibility.AXNode): void => {
    if (nodes.has(rawNode.nodeId)) return;
    const node = parseA11yNode(rawNode);
    const childIds = visibleChildIds(rawNode, rawById);
    if (childIds.length > 0) node.childIds = childIds;
    else delete node.childIds;
    nodes.set(node.nodeId, node);
    for (const childId of childIds) {
      const child = rawById.get(childId);
      if (child) visit(child);
    }
  };
  visit(rootRaw);
  rawNodes.filter((rawNode) => !rawNode.ignored).forEach(visit);

  const root = nodes.get(rootRaw.nodeId) as A11yNode;
  return { root, nodes, count: nodes.size };
}

/**
 * Ids of a node's children as shown: ignored children are replaced by their
 * own non-ignored descendants; ids missing from the tree are dropped.
 *
 * @param rawNode - Node whose children to list
 * @param rawById - All raw nodes by id
 * @param seen - Ids already listed (guards against cycles)
 * @returns Child ids, all of non-ignored nodes in the tree
 */
function visibleChildIds(
  rawNode: Protocol.Accessibility.AXNode,
  rawById: Map<string, Protocol.Accessibility.AXNode>,
  seen: Set<string> = new Set()
): string[] {
  return (rawNode.childIds ?? []).flatMap((childId) => {
    const child = rawById.get(childId);
    if (!child || seen.has(childId)) return [];
    seen.add(childId);
    return child.ignored ? visibleChildIds(child, rawById, seen) : [childId];
  });
}

/**
 * Collects the full accessibility tree from the page via IPC.
 *
 * Uses the session's persistent CDP connection through callCDP for consistency
 * with other DOM commands and to avoid connection conflicts.
 *
 * @returns Parsed and filtered accessibility tree
 * @throws Error if CDP Accessibility domain fails
 */
export async function collectA11yTree(): Promise<A11yTree> {
  await callCDP('Accessibility.enable', {});

  try {
    const response = await callCDP('Accessibility.getFullAXTree', {});
    const result = response.data?.result as
      Protocol.Accessibility.GetFullAXTreeResponse | undefined;
    if (!result?.nodes) {
      throw new CommandError(
        'Failed to get accessibility tree',
        { suggestion: 'CDP returned no nodes. The page may not be fully loaded.' },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    const tree = buildTreeFromRawNodes([
      ...result.nodes,
      ...(await collectFrameNodes(result.nodes)),
    ]);
    return maskSecretValues(tree, await sensitiveNodeIds(tree));
  } finally {
    await callCDP('Accessibility.disable', {});
  }
}

/** Concurrent page checks for {@link sensitiveNodeIds} */
const SENSITIVE_CHECK_CONCURRENCY = 10;

/**
 * The accessibility nodes whose value is a secret: nodes with a value whose
 * element is a sensitive field ({@link SENSITIVE_FIELD_JS}: passwords, card
 * fields, one-time codes). Only nodes with a value are checked, one page
 * call each (a page has few).
 *
 * @param tree - Accessibility tree
 * @returns Node ids of secret fields
 */
async function sensitiveNodeIds(tree: A11yTree): Promise<Set<string>> {
  const candidates = [...tree.nodes.values()].filter(
    (node) => node.value !== undefined && node.backendDOMNodeId !== undefined
  );
  const limiter = new ConcurrencyLimiter(SENSITIVE_CHECK_CONCURRENCY);
  const checked = await Promise.all(
    candidates.map((node) =>
      limiter.run(async () =>
        (await isSensitiveField(node.backendDOMNodeId ?? 0)) ? node.nodeId : null
      )
    )
  );
  return new Set(checked.filter((id): id is string => id !== null));
}

/**
 * Whether an element is a sensitive field. An element that cannot be read
 * counts as one, so a value is never shown by mistake.
 *
 * @param backendNodeId - The element
 * @returns True for secret fields (and unreadable elements)
 */
async function isSensitiveField(backendNodeId: number): Promise<boolean> {
  const objectGroup = 'bdg-a11y-secret';
  const resolved = await callBdgScript('DOM.resolveNode', { backendNodeId, objectGroup });
  const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
    ?.objectId;
  if (!objectId) return true;
  try {
    const response = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function () { return this.nodeType !== 1 || (${SENSITIVE_FIELD_JS})(this); }`,
      returnByValue: true,
    });
    const value = (response.data?.result as { result?: { value?: unknown } } | undefined)?.result
      ?.value;
    return value !== false;
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/**
 * The tree with the values of secret fields masked ({@link MASKED_VALUE},
 * whatever their length), and the names and values of the nodes inside them
 * left out (the text Chrome lists under a text field is its value).
 *
 * @param tree - Accessibility tree
 * @param secretIds - Node ids of secret fields
 * @returns The same tree (nodes replaced in place)
 */
export function maskSecretValues(tree: A11yTree, secretIds: ReadonlySet<string>): A11yTree {
  const hide = (nodeId: string, inside: boolean): void => {
    const node = tree.nodes.get(nodeId);
    if (!node) return;
    const { name: _name, value: _value, ...rest } = node;
    const masked = inside
      ? rest
      : { ...node, ...(node.value !== undefined && { value: MASKED_VALUE }) };
    tree.nodes.set(nodeId, masked);
    if (tree.root.nodeId === nodeId) tree.root = masked;
    node.childIds?.forEach((childId) => hide(childId, true));
  };
  secretIds.forEach((nodeId) => hide(nodeId, false));
  return tree;
}

/**
 * Accessibility nodes of the page's iframes, attached under their `Iframe`
 * node (the page's own tree stops there). Frames in another process
 * (cross-origin) cannot be read this way and are skipped. Node ids are
 * prefixed per frame, as each frame numbers its nodes on its own.
 *
 * @param pageNodes - The page's nodes (their iframe nodes get the frame root as
 *   child; nested frames attach to their parent frame's nodes)
 * @returns Nodes of all readable frames
 */
async function collectFrameNodes(
  pageNodes: Protocol.Accessibility.AXNode[]
): Promise<Protocol.Accessibility.AXNode[]> {
  const tree = (await callCDP('Page.getFrameTree', {})).data?.result as
    Protocol.Page.GetFrameTreeResponse | undefined;
  const known = [...pageNodes];
  const collected: Protocol.Accessibility.AXNode[] = [];
  for (const [index, frameId] of childFrameIds(tree?.frameTree).entries()) {
    const nodes = await frameNodes(frameId, `f${index}:`, known);
    known.push(...nodes);
    collected.push(...nodes);
  }
  return collected;
}

/**
 * One frame's nodes, with ids prefixed, its root attached to the node of its
 * `<iframe>` element.
 *
 * @param frameId - Frame id
 * @param prefix - Prefix for the frame's node ids
 * @param ownerNodes - Nodes that may contain the frame's `<iframe>` node
 * @returns The frame's nodes, or none when it cannot be read
 */
async function frameNodes(
  frameId: string,
  prefix: string,
  ownerNodes: Protocol.Accessibility.AXNode[]
): Promise<Protocol.Accessibility.AXNode[]> {
  const response = await callCDP('Accessibility.getFullAXTree', { frameId });
  const nodes = (response.data?.result as Protocol.Accessibility.GetFullAXTreeResponse | undefined)
    ?.nodes;
  const owner = (await callCDP('DOM.getFrameOwner', { frameId })).data?.result as
    Protocol.DOM.GetFrameOwnerResponse | undefined;
  if (!nodes?.length || !owner) return [];
  const prefixed = nodes.map((node) => ({
    ...node,
    nodeId: prefix + node.nodeId,
    ...(node.parentId && { parentId: prefix + node.parentId }),
    ...(node.childIds && { childIds: node.childIds.map((id) => prefix + id) }),
  }));
  const root = prefixed.find((node) => !node.parentId);
  const iframeNode = ownerNodes.find((node) => node.backendDOMNodeId === owner.backendNodeId);
  if (root && iframeNode) iframeNode.childIds = [...(iframeNode.childIds ?? []), root.nodeId];
  return prefixed;
}

/**
 * Chrome reports some states (`checked`, `pressed`) as the strings "true" and
 * "false" (they may also be "mixed"); make those booleans like the others.
 *
 * @param value - Property value
 * @returns The value, with "true"/"false" as booleans
 */
function booleanIfFlag(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * Parses raw CDP AXNode into simplified A11yNode format.
 *
 * Extracts key properties (role, name, description, value) and common
 * ARIA properties (focusable, focused, disabled, required).
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Simplified A11yNode
 */
function parseA11yNode(rawNode: Protocol.Accessibility.AXNode): A11yNode {
  const node: A11yNode = {
    nodeId: rawNode.nodeId,
    role: extractRole(rawNode),
  };

  if (rawNode.name?.value) {
    node.name = String(rawNode.name.value);
  }

  if (rawNode.description?.value) {
    node.description = String(rawNode.description.value);
  }

  if (rawNode.value?.value) {
    node.value = String(rawNode.value.value);
  }

  if (rawNode.properties) {
    const props: Record<string, unknown> = {};

    for (const prop of rawNode.properties) {
      if (prop.name === 'focusable') {
        node.focusable = prop.value.value === true;
      } else if (prop.name === 'focused') {
        node.focused = prop.value.value === true;
      } else if (prop.name === 'disabled') {
        node.disabled = prop.value.value === true;
      } else if (prop.name === 'required') {
        node.required = prop.value.value === true;
      } else {
        props[prop.name] = booleanIfFlag(prop.value.value);
      }
    }

    if (Object.keys(props).length > 0) {
      node.properties = props;
    }
  }

  if (rawNode.childIds && rawNode.childIds.length > 0) {
    node.childIds = rawNode.childIds;
  }

  if (rawNode.backendDOMNodeId) {
    node.backendDOMNodeId = rawNode.backendDOMNodeId;
  }

  return node;
}

/**
 * Extracts role string from AXNode.
 *
 * Prefers explicit role over Chrome internal role.
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Role string (e.g., 'button', 'textbox', 'heading')
 */
function extractRole(rawNode: Protocol.Accessibility.AXNode): string {
  if (rawNode.role?.value) {
    return String(rawNode.role.value);
  }
  return 'unknown';
}

/**
 * Roles of text nodes: they repeat the name of the element they are in (a
 * name search found every button three times) and are not elements that
 * commands can act on. Left out unless the query asks for the role.
 */
const TEXT_ROLES = new Set(['statictext', 'inlinetextbox']);

/**
 * Queries accessibility tree by pattern (role, name, description).
 *
 * Performs case-insensitive matching with AND logic for multiple fields.
 * An element reported more than once (by the page's tree and its frame's)
 * is listed once.
 *
 * @param tree - Accessibility tree to search
 * @param pattern - Query pattern with optional role, name, description
 * @returns Query result with matching nodes
 *
 * @example
 * ```typescript
 * // Find submit buttons
 * queryA11yTree(tree, { role: 'button', name: 'Submit' });
 *
 * // Find all textboxes
 * queryA11yTree(tree, { role: 'textbox' });
 *
 * // Find by name only
 * queryA11yTree(tree, { name: 'Email' });
 * ```
 */
export function queryA11yTree(tree: A11yTree, pattern: A11yQueryPattern): A11yQueryResult {
  const matches: A11yNode[] = [];
  const seenElements = new Set<number>();

  const wantsText = pattern.role !== undefined && TEXT_ROLES.has(pattern.role.toLowerCase());
  for (const node of tree.nodes.values()) {
    if (!wantsText && TEXT_ROLES.has(node.role.toLowerCase())) continue;
    if (!matchesPattern(node, pattern)) continue;
    if (node.backendDOMNodeId !== undefined) {
      if (seenElements.has(node.backendDOMNodeId)) continue;
      seenElements.add(node.backendDOMNodeId);
    }
    matches.push(node);
  }

  return {
    nodes: matches,
    count: matches.length,
    pattern,
  };
}

/**
 * Match a value against a query term.
 *
 * Without `*` the term matches as a case-insensitive substring (or exactly,
 * for `exact`); `*` matches any run of characters.
 *
 * @param value - Node value (role, name, description)
 * @param term - Query term
 * @param exact - Whole-value match instead of substring
 * @returns True on match
 */
function matchesTerm(value: string | undefined, term: string, exact = false): boolean {
  if (value === undefined) return false;
  if (!term.includes('*')) {
    const [v, t] = [value.toLowerCase(), term.toLowerCase()];
    return exact ? v === t : v.includes(t);
  }
  const source = term
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*');
  return new RegExp(exact ? `^${source}$` : source, 'i').test(value);
}

/**
 * Checks if a node matches the query pattern.
 *
 * All specified fields must match (AND logic), case-insensitively: role
 * exactly, name and description as substrings; `*` is a wildcard.
 *
 * @param node - A11y node to test
 * @param pattern - Query pattern
 * @returns True if node matches all pattern criteria
 */
function matchesPattern(node: A11yNode, pattern: A11yQueryPattern): boolean {
  if (pattern.role && !matchesTerm(node.role, pattern.role, true)) return false;
  if (pattern.name && !matchesTerm(node.name, pattern.name)) return false;
  if (pattern.description && !matchesTerm(node.description, pattern.description)) return false;
  return true;
}

/** Query fields and their aliases. */
const QUERY_FIELDS: Record<string, keyof A11yQueryPattern> = {
  role: 'role',
  name: 'name',
  description: 'description',
  desc: 'description',
};

/** The next `key:`/`key=` anywhere (fields may follow other text). */
const QUERY_KEY = /([a-z]+)\s*[:=]/i;

/** A quoted value (it may contain anything but its own quote). */
const QUOTED_QUERY_VALUE = /^\s*("[^"]*"|'[^']*')/;

/** Where a role value ends: at the next `key:` after a space or comma. */
const NEXT_QUERY_FIELD = /[\s,]+[a-z]+\s*[:=]/i;

/**
 * Where a name or description ends: only at a known field that has a value,
 * so names keep their spaces and colons (`name=E-mail address:`).
 */
const NEXT_KNOWN_QUERY_FIELD = /[\s,]+(?:role|name|description|desc)\s*[:=](?=\s*[^\s,])/i;

/**
 * Read one field value.
 *
 * @param text - Text after `key:`
 * @param field - Field the value is for
 * @returns The value, where it ends in `text`, and whether it was quoted
 */
function readQueryValue(
  text: string,
  field: keyof A11yQueryPattern
): { value: string; end: number; quoted: boolean } {
  const quoted = QUOTED_QUERY_VALUE.exec(text);
  if (quoted?.[1]) return { value: quoted[1].slice(1, -1), end: quoted[0].length, quoted: true };
  const next = (field === 'role' ? NEXT_QUERY_FIELD : NEXT_KNOWN_QUERY_FIELD).exec(text);
  const end = next ? next.index : text.length;
  const value = text
    .slice(0, end)
    .trim()
    .replace(/,+$/, '')
    .replace(/^(["'])(.*)\1$/s, '$2');
  return { value, end, quoted: false };
}

/**
 * Parses query pattern string into A11yQueryPattern object.
 *
 * Fields are `key:value` or `key=value`, separated by spaces or commas.
 * Keys: role, name, description (desc). Case-insensitive. A role ends at the
 * next `key:`; a name or description runs to the next role/name/description
 * field with a value, or to the end, so it may contain spaces and colons
 * (`name=E-mail address:`). Quote a value to end it explicitly.
 *
 * @param patternString - Query pattern string
 * @returns Parsed query pattern
 * @throws CommandError (81) for unknown keys, also a misspelled one inside a name
 *
 * @example
 * ```typescript
 * parseQueryPattern('role:button name:Submit')     // { role: 'button', name: 'Submit' }
 * parseQueryPattern('role=link,name=Google Chrome') // { role: 'link', name: 'Google Chrome' }
 * parseQueryPattern('name:"Sign in" role:button')  // { name: 'Sign in', role: 'button' }
 * parseQueryPattern('name=E-mail address:')        // { name: 'E-mail address:' }
 * ```
 */
export function parseQueryPattern(patternString: string): A11yQueryPattern {
  const pattern: A11yQueryPattern = {};
  let rest = patternString;
  for (let key = QUERY_KEY.exec(rest); key; key = QUERY_KEY.exec(rest)) {
    const rawKey = key[1] ?? '';
    const field = QUERY_FIELDS[rawKey.toLowerCase()];
    if (!field) throwUnknownField(rawKey);
    const valueText = rest.slice(key.index + key[0].length);
    const { value, end, quoted } = readQueryValue(valueText, field);
    if (!quoted && field !== 'role') checkMisspelledField(value, field);
    if (value) pattern[field] = value;
    rest = valueText.slice(end);
  }
  return pattern;
}

/**
 * Throw the exit-81 error for an unknown query field.
 *
 * @param field - The unrecognized key
 * @param similar - A known field it looks like a typo of
 * @param value - The name or description that absorbed it
 * @throws CommandError (81)
 */
function throwUnknownField(field: string, similar?: string, value?: string): never {
  const err = unknownQueryFieldError(field, similar, value);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/** A `word:`/`word=` inside a name or description. */
const ABSORBED_KEY = /[\s,]([a-z]+)\s*[:=]/gi;

/**
 * Reject a name or description that swallowed a misspelled field
 * (`name:Save rol:button`): a `word:` within edit distance 1 of role, name or
 * desc (2 of description). Wider distances would catch common label words
 * (`Date:`, `Note:`, `Code:`).
 *
 * @param value - Unquoted name or description
 * @param field - Field it is the value of
 * @throws CommandError (81) with a "did you mean" suggestion
 */
function checkMisspelledField(value: string, field: keyof A11yQueryPattern): void {
  for (const [, word = ''] of value.matchAll(ABSORBED_KEY)) {
    const lower = word.toLowerCase();
    if (QUERY_FIELDS[lower]) continue;
    const similar = Object.keys(QUERY_FIELDS).find(
      (name) => levenshteinDistance(lower, name) <= (name.length > 4 ? 2 : 1)
    );
    if (similar) throwUnknownField(word, similar, `${field}=${value}`);
  }
}

/**
 * Resolve accessibility properties for a DOM node via IPC.
 *
 * Uses the session's persistent CDP connection through callCDP for consistency.
 * Selectors are resolved by the caller (see `resolveBackendNodeIds`), so they
 * reach shadow roots and same-origin iframes like every other DOM command.
 *
 * @param target - Node reference
 * @returns A11y node or null if not found
 */
export async function resolveA11yNode(target: NodeRef): Promise<A11yNode | null> {
  await callCDP('Accessibility.enable', {});

  try {
    const a11yResponse = await callCDP('Accessibility.getPartialAXTree', {
      ...target,
      fetchRelatives: false,
    });
    const a11yResult = a11yResponse.data?.result as
      Protocol.Accessibility.GetPartialAXTreeResponse | undefined;

    if (!a11yResult?.nodes) {
      return null;
    }

    const rawNode = a11yResult.nodes.find((n) => !n.ignored);
    if (!rawNode) {
      return null;
    }

    return parseA11yNode(rawNode);
  } finally {
    await callCDP('Accessibility.disable', {});
  }
}

/**
 * Why an element has no node in the accessibility tree (e.g. it is not
 * rendered, aria-hidden, or a decorative image with `alt=""`).
 *
 * @param target - Node reference
 * @returns Chrome's reasons in plain words (empty if unknown)
 */
export async function a11yIgnoredReasons(target: NodeRef): Promise<string[]> {
  await callCDP('Accessibility.enable', {});
  try {
    const response = await callCDP('Accessibility.getPartialAXTree', {
      ...target,
      fetchRelatives: false,
    });
    const nodes = (
      response.data?.result as Protocol.Accessibility.GetPartialAXTreeResponse | undefined
    )?.nodes;
    return (nodes?.[0]?.ignoredReasons ?? []).map(
      (reason) => IGNORED_REASONS[reason.name] ?? reason.name
    );
  } finally {
    await callCDP('Accessibility.disable', {});
  }
}

/** Chrome's ignored reasons in plain words */
const IGNORED_REASONS: Record<string, string> = {
  notRendered: 'not rendered (display: none or hidden)',
  notVisible: 'not visible',
  ariaHiddenElement: 'aria-hidden="true"',
  ariaHiddenSubtree: 'inside an aria-hidden element',
  presentationalRole: 'presentational (e.g. an image with alt="")',
  emptyAlt: 'an image with alt=""',
  inertElement: 'inert',
  inertSubtree: 'inside an inert element',
  activeModalDialog: 'outside the open modal dialog',
  probablyPresentational: 'probably decorative',
  uninteresting: 'has no role or name',
  labelFor: 'a label (its text names another element)',
};
