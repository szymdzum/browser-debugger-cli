import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { unknownQueryFieldError } from '@/errors/messages.js';
import { callBdgScript, callCDP } from '@/ipc/client.js';
import { MASKED_VALUE, SENSITIVE_FIELD_JS } from '@/runtime/dom/elementInfo.js';
import { childFrameIds } from '@/runtime/dom/frameLayout.js';
import type {
  A11yNode,
  A11yTree,
  A11yQueryPattern,
  A11yQueryResult,
  ListedA11yNode,
  ListedA11yTree,
  NodeRef,
} from '@/types.js';
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

/** Roles that only lay out their children and say nothing themselves */
const LAYOUT_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
]);

/**
 * Whether a node is left out of `dom a11y tree`: text boxes, blank text,
 * text that repeats its parent's name, and nameless layout wrappers.
 *
 * @param node - Accessibility node
 * @param parentName - Name of the nearest named ancestor
 * @returns True when the node says nothing of its own
 */
function isTreeNoise(node: A11yNode, parentName: string | undefined): boolean {
  return (
    node.role === 'InlineTextBox' ||
    (node.role === 'StaticText' && (node.name === parentName || !node.name?.trim())) ||
    (LAYOUT_ROLES.has(node.role) && !node.name)
  );
}

/**
 * The nodes `dom a11y tree` lists, depth-first from the root (then nodes not
 * under it, such as frame content): the first `limit` (0 = all) no deeper
 * than `maxDepth`. Noise ({@link isTreeNoise}) is counted as skipped and its
 * children move up a level, so the budget goes to meaningful nodes; nodes cut
 * by the limit or depth are counted as omitted. Every node of the tree is
 * listed, omitted or skipped.
 *
 * @param tree - Accessibility tree
 * @param limit - Nodes to list (0 = all listable ones)
 * @param maxDepth - Deepest level to list (0 = root only; undefined = all)
 * @returns Listed nodes with their depth, the tree size, and how many were cut or skipped
 */
export function listA11yTree(tree: A11yTree, limit: number, maxDepth?: number): ListedA11yTree {
  const nodes: ListedA11yNode[] = [];
  const visited = new Set<string>();
  let omitted = 0;
  let skipped = 0;
  const visit = (node: A11yNode, depth: number, parentName: string | undefined): void => {
    if (visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    const listable = !isTreeNoise(node, parentName);
    if (listable) {
      const fits = (limit === 0 || nodes.length < limit) && (maxDepth ?? depth) >= depth;
      if (fits) nodes.push(listedNode(node, depth));
      else omitted++;
    } else {
      skipped++;
    }
    for (const childId of node.childIds ?? []) {
      const child = tree.nodes.get(childId);
      if (child) visit(child, listable ? depth + 1 : depth, node.name ?? parentName);
    }
  };
  visit(tree.root, 0, undefined);
  for (const node of tree.nodes.values()) visit(node, 0, undefined);
  return {
    nodes,
    count: tree.count,
    ...(omitted > 0 && { omitted }),
    ...(skipped > 0 && { skipped }),
    ...(tree.masked && { masked: true }),
  };
}

/**
 * A node as the tree lists it: its depth instead of child ids (its children
 * follow it, one level deeper).
 *
 * @param node - Accessibility node
 * @param depth - Its level in the listing
 * @returns Listed node
 */
function listedNode(node: A11yNode, depth: number): ListedA11yNode {
  const { childIds: _childIds, ...rest } = node;
  return { ...rest, depth };
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

    const rawNodes = [...result.nodes, ...(await collectFrameNodes(result.nodes))];
    const tree = buildTreeFromRawNodes(rawNodes);
    const secretIds = await sensitiveNodeIds(tree);
    maskSecretValues(tree, secretIds);
    maskSecretReferences(tree, rawNodes, secretIds);
    maskSecretMessages(tree, await secretValidationMessages(tree, secretIds));
    if (secretIds.size > 0) tree.masked = true;
    return tree;
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

/** Counter giving each secret field check its own object group */
let secretChecks = 0;

/**
 * Page-side check, on a node with an accessibility value, of whether it is
 * a sensitive field ({@link SENSITIVE_FIELD_JS}); a node that is not an
 * element counts as one.
 */
const SECRET_VALUE_CHECK_JS = `function () { return this.nodeType !== 1 || (${SENSITIVE_FIELD_JS})(this); }`;

/**
 * Page-side check, on an element a name or description comes from, of
 * whether it is a form control holding a secret (#642): a label or heading
 * whose id reads like a secret name (`password-label`) is not one, so the
 * name it gives stays. A node that is not an element counts as secret.
 */
const SECRET_RELATION_CHECK_JS = `function () {
  if (this.nodeType !== 1) return true;
  const control = /^(input|textarea|select)$/.test(this.localName) || this.isContentEditable === true;
  return control && (${SENSITIVE_FIELD_JS})(this);
}`;

/**
 * Whether an element is a sensitive field. An element that cannot be read
 * counts as one, so a value is never shown by mistake. Each check has an
 * object group of its own: checks run concurrently (and so do commands), and
 * the release of a shared group would free another check's element before it
 * is read, masking a plain value.
 *
 * @param backendNodeId - The element
 * @param check - Page-side function run on the element
 * @returns True for secret fields (and unreadable elements)
 */
async function isSensitiveField(
  backendNodeId: number,
  check: string = SECRET_VALUE_CHECK_JS
): Promise<boolean> {
  return (await readOnElement(backendNodeId, check)) !== false;
}

/**
 * Run a page-side function on an element (as `this`) and read its result
 * by value, in an object group of its own (see {@link isSensitiveField}).
 *
 * @param backendNodeId - The element
 * @param functionDeclaration - Function source
 * @returns The result; undefined when the element cannot be resolved
 */
async function readOnElement(backendNodeId: number, functionDeclaration: string): Promise<unknown> {
  const objectGroup = `bdg-a11y-secret-${process.pid}-${++secretChecks}`;
  const resolved = await callBdgScript('DOM.resolveNode', { backendNodeId, objectGroup });
  const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
    ?.objectId;
  if (!objectId) return undefined;
  try {
    const response = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      returnByValue: true,
    });
    return (response.data?.result as { result?: { value?: unknown } } | undefined)?.result?.value;
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

/** Page-side: the browser's validation message of a field, if any */
const VALIDATION_MESSAGE_JS = `function () { return typeof this.validationMessage === 'string' ? this.validationMessage : ''; }`;

/**
 * The browser's validation messages of the secret fields that have one
 * (#643): Chrome shows the message of the invalid field it focused as an
 * `alert` node of the tree, and the text may give the value's length.
 *
 * @param tree - Accessibility tree
 * @param secretIds - Node ids of secret fields
 * @returns The messages, each once
 */
async function secretValidationMessages(
  tree: A11yTree,
  secretIds: ReadonlySet<string>
): Promise<Set<string>> {
  const elements = [...secretIds]
    .map((nodeId) => tree.nodes.get(nodeId)?.backendDOMNodeId)
    .filter((id): id is number => id !== undefined);
  const limiter = new ConcurrencyLimiter(SENSITIVE_CHECK_CONCURRENCY);
  const messages = await Promise.all(
    elements.map((backendNodeId) =>
      limiter.run(() => readOnElement(backendNodeId, VALIDATION_MESSAGE_JS))
    )
  );
  return new Set(messages.filter((message): message is string => Boolean(message)));
}

/**
 * The tree with every node whose name is a secret field's validation
 * message (the `alert` Chrome shows for the invalid field it focused)
 * renamed {@link MASKED_VALUE} (#643); the alert's name may carry a
 * trailing space, so names are compared trimmed.
 *
 * @param tree - Accessibility tree
 * @param messages - Validation messages of secret fields
 * @returns The same tree (nodes replaced in place)
 */
export function maskSecretMessages(tree: A11yTree, messages: ReadonlySet<string>): A11yTree {
  if (messages.size === 0) return tree;
  const trimmed = new Set([...messages].map((message) => message.trim()));
  for (const [nodeId, node] of tree.nodes) {
    if (node.name === undefined || !trimmed.has(node.name.trim())) continue;
    const masked = { ...node, name: MASKED_VALUE };
    tree.nodes.set(nodeId, masked);
    if (tree.root.nodeId === nodeId) tree.root = masked;
  }
  return tree;
}

/**
 * The tree with the names and descriptions that come from a secret field
 * masked ({@link maskSecretRelations}, #642): a field whose
 * `aria-labelledby` or `aria-describedby` points at a card number field is
 * named `Confirm ••••`, not by the number.
 *
 * @param tree - Accessibility tree, secret values already masked
 * @param rawNodes - The raw nodes it was built from, with the relations
 * @param secretIds - Node ids of secret fields
 * @returns The same tree (nodes replaced in place)
 */
function maskSecretReferences(
  tree: A11yTree,
  rawNodes: Protocol.Accessibility.AXNode[],
  secretIds: ReadonlySet<string>
): A11yTree {
  const secretElements = new Set<number>();
  for (const nodeId of secretIds) {
    const backendNodeId = tree.nodes.get(nodeId)?.backendDOMNodeId;
    if (backendNodeId !== undefined) secretElements.add(backendNodeId);
  }
  if (secretElements.size === 0) return tree;
  for (const rawNode of rawNodes) {
    const node = tree.nodes.get(rawNode.nodeId);
    if (!node) continue;
    const masked = maskSecretRelations(node, rawNode, (id) => secretElements.has(id));
    if (masked === node) continue;
    tree.nodes.set(rawNode.nodeId, masked);
    if (tree.root.nodeId === rawNode.nodeId) tree.root = masked;
  }
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
 * The value of a node property. Relations (`labelledby`, `controls`, …)
 * are the ids of the related elements, space-separated as in the ARIA
 * attribute: Chrome gives `idrefList` relations that value, but `nodeList`
 * ones (`labelledby`) only the related nodes, whose text is left out (it
 * may be a secret field's value). Related nodes without an id are left out.
 *
 * @param value - CDP property value
 * @returns The value, or undefined when there is none
 */
function propertyValue(value: Protocol.Accessibility.AXValue): unknown {
  if (value.value !== undefined || !value.relatedNodes) return booleanIfFlag(value.value);
  const ids = value.relatedNodes.flatMap((related) => (related.idref ? [related.idref] : []));
  return ids.length > 0 ? ids.join(' ') : undefined;
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
        const value = propertyValue(prop.value);
        if (value !== undefined) props[prop.name] = value;
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

    return maskSecretRelations(parseA11yNode(rawNode), rawNode, await secretRelations(rawNode));
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

/**
 * The related nodes of an accessibility value: those listed on it and on
 * each source that was not superseded (the `attributeValue` of an
 * `aria-labelledby` source lists them with the text each contributed).
 *
 * @param value - Name, description or attribute value
 * @returns Related nodes, possibly listed twice
 */
function relatedNodes(
  value: Protocol.Accessibility.AXValue | undefined
): Protocol.Accessibility.AXRelatedNode[] {
  if (!value) return [];
  const ofSources = (value.sources ?? []).flatMap((source) =>
    source.superseded ? [] : [...relatedNodes(source.value), ...relatedNodes(source.attributeValue)]
  );
  return [...(value.relatedNodes ?? []), ...ofSources];
}

/**
 * The related nodes a property lists (`labelledby`, `describedby`).
 *
 * @param rawNode - Raw AXNode from CDP
 * @param name - Property name
 * @returns Related nodes
 */
function propertyRelations(
  rawNode: Protocol.Accessibility.AXNode,
  name: Protocol.Accessibility.AXPropertyName
): Protocol.Accessibility.AXRelatedNode[] {
  return (rawNode.properties ?? [])
    .filter((property) => property.name === name)
    .flatMap((property) => property.value.relatedNodes ?? []);
}

/**
 * Related nodes each once, by backend node id (the first listing of a node
 * is the one with its text).
 *
 * @param nodes - Related nodes
 * @returns Distinct related nodes
 */
function distinctRelations(
  nodes: Protocol.Accessibility.AXRelatedNode[]
): Protocol.Accessibility.AXRelatedNode[] {
  const seen = new Set<number>();
  return nodes.filter((node) => {
    if (seen.has(node.backendDOMNodeId)) return false;
    seen.add(node.backendDOMNodeId);
    return true;
  });
}

/**
 * The nodes a node's accessible name comes from.
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Related nodes, each once
 */
function nameRelations(
  rawNode: Protocol.Accessibility.AXNode
): Protocol.Accessibility.AXRelatedNode[] {
  return distinctRelations([
    ...relatedNodes(rawNode.name),
    ...propertyRelations(rawNode, 'labelledby'),
  ]);
}

/**
 * The nodes a node's accessible description comes from.
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Related nodes, each once
 */
function descriptionRelations(
  rawNode: Protocol.Accessibility.AXNode
): Protocol.Accessibility.AXRelatedNode[] {
  return distinctRelations([
    ...relatedNodes(rawNode.description),
    ...propertyRelations(rawNode, 'describedby'),
  ]);
}

/**
 * Backend node ids of the elements a node's accessible name and description
 * come from (`aria-labelledby`, `aria-describedby` and other relations).
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Backend node ids, in order of appearance, each once
 */
export function secretRelationIds(rawNode: Protocol.Accessibility.AXNode): number[] {
  return distinctRelations([...nameRelations(rawNode), ...descriptionRelations(rawNode)]).map(
    (node) => node.backendDOMNodeId
  );
}

/**
 * A computed text with what secret related nodes contributed replaced by
 * {@link MASKED_VALUE}: each secret node's text, or the whole text when a
 * secret node's contribution is not known (a description's related nodes
 * come without their text) or not found in it.
 *
 * @param text - Computed name or description
 * @param related - The nodes it comes from
 * @param isSecret - Whether a backend node id is a secret field
 * @returns The masked text, or undefined when no related node is secret
 */
function maskedContribution(
  text: string,
  related: Protocol.Accessibility.AXRelatedNode[],
  isSecret: (backendNodeId: number) => boolean
): string | undefined {
  const secret = related.filter((node) => isSecret(node.backendDOMNodeId));
  if (secret.length === 0) return undefined;
  let masked = text;
  for (const node of secret) {
    if (node.text === '') continue;
    if (node.text === undefined || !masked.includes(node.text)) return MASKED_VALUE;
    masked = masked.split(node.text).join(MASKED_VALUE);
  }
  return masked;
}

/**
 * The node with the part of its name or description that a secret field
 * contributed replaced by {@link MASKED_VALUE} (#642).
 *
 * @param node - Parsed node
 * @param rawNode - Its raw AXNode, with the relations
 * @param isSecret - Whether a backend node id is a secret field
 * @returns The node, or a copy with the name or description masked
 */
export function maskSecretRelations(
  node: A11yNode,
  rawNode: Protocol.Accessibility.AXNode,
  isSecret: (backendNodeId: number) => boolean
): A11yNode {
  const name =
    node.name === undefined
      ? undefined
      : maskedContribution(node.name, nameRelations(rawNode), isSecret);
  const description =
    node.description === undefined
      ? undefined
      : maskedContribution(node.description, descriptionRelations(rawNode), isSecret);
  if (name === undefined && description === undefined) return node;
  return {
    ...node,
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
  };
}

/**
 * Which of the elements a node's name and description come from are secret
 * fields, checked in the page ({@link SECRET_RELATION_CHECK_JS}), for a
 * node read on its own (`dom get`, `a11y describe`).
 *
 * @param rawNode - Raw AXNode from CDP
 * @returns Whether a backend node id is a secret field
 */
async function secretRelations(
  rawNode: Protocol.Accessibility.AXNode
): Promise<(backendNodeId: number) => boolean> {
  const ids = secretRelationIds(rawNode);
  const limiter = new ConcurrencyLimiter(SENSITIVE_CHECK_CONCURRENCY);
  const checked = await Promise.all(
    ids.map((id) => limiter.run(() => isSensitiveField(id, SECRET_RELATION_CHECK_JS)))
  );
  const secret = new Set(ids.filter((_, index) => checked[index]));
  return (backendNodeId) => secret.has(backendNodeId);
}
