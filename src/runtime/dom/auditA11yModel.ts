/**
 * Rules of `bdg dom audit a11y` over the computed accessibility tree
 * (`Accessibility.getFullAXTree`), so `aria-label`, `aria-labelledby`,
 * `<label>`, `title` and text content count as names. Pure: tested without
 * a browser.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type { A11yRuleId } from '@/ipc/protocol/auditTypes.js';

/** Why a rule flags an element */
export type A11yReason =
  | { kind: 'unnamed' }
  | { kind: 'no-h1' }
  | { kind: 'extra-h1'; total: number }
  | { kind: 'skipped-level'; level: number; previous: number }
  | { kind: 'no-main' }
  | { kind: 'outside-landmark'; holders: number }
  | { kind: 'duplicate-id'; id: string; total: number }
  | { kind: 'missing-reference'; attribute: string; id: string };

/** An element a rule flags; `backendNodeId` is missing for page-level findings */
export interface A11yHit {
  rule: A11yRuleId;
  backendNodeId?: number;
  reason: A11yReason;
}

type AxNode = Protocol.Accessibility.AXNode;

/** Roles of images that need a text alternative */
const IMAGE_ROLES: ReadonlySet<string> = new Set(['image', 'img']);

/** Roles of controls that need a name (`<select>` is a combobox or a popup button, by Chrome version) */
const CONTROL_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'PopUpButton',
  'ComboBoxSelect',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'tab',
]);

/** Controls that are named already: an image inside one adds nothing a reader needs (`<input type=image>` holds one) */
const NAMED_BY_ITSELF_ROLES: ReadonlySet<string> = new Set(['button', 'link']);

/** Landmarks that exist without a name */
const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'main',
  'navigation',
  'search',
]);

/** Landmarks only when the author named them */
const NAMED_LANDMARK_ROLES: ReadonlySet<string> = new Set(['region', 'form']);

/**
 * The role of a node.
 *
 * @param node - Accessibility node
 * @returns Role, or empty
 */
function roleOf(node: AxNode): string {
  return String(node.role?.value ?? '');
}

/**
 * Whether a node has an accessible name.
 *
 * @param node - Accessibility node
 * @returns True when the name has text
 */
function hasName(node: AxNode): boolean {
  return String(node.name?.value ?? '').trim() !== '';
}

/**
 * The heading level of a node.
 *
 * @param node - Heading node
 * @returns Level, or 0 when missing
 */
function headingLevel(node: AxNode): number {
  const level: unknown = node.properties?.find((property) => property.name === 'level')?.value
    .value;
  return typeof level === 'number' ? level : 0;
}

/**
 * Whether a node is a landmark.
 *
 * @param node - Accessibility node
 * @returns True for a landmark role (a region or form only with a name)
 */
function isLandmark(node: AxNode): boolean {
  const role = roleOf(node);
  return LANDMARK_ROLES.has(role) || (NAMED_LANDMARK_ROLES.has(role) && hasName(node));
}

/** A node with the nearest ancestor that has a DOM element, and whether a landmark is above it */
interface Visit {
  node: AxNode;
  parent?: AxNode;
  holder: number | undefined;
  inLandmark: boolean;
}

/**
 * The nodes in document order (the list from Chrome is not).
 *
 * @param nodes - Nodes of one frame's tree
 * @returns Nodes depth-first from the root
 */
function inDocumentOrder(nodes: AxNode[]): Visit[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => !node.parentId) ?? nodes[0];
  const visits: Visit[] = [];
  const seen = new Set<string>();
  const stack: Visit[] = root ? [{ node: root, holder: undefined, inLandmark: false }] : [];
  while (stack.length > 0) {
    const visit = stack.pop();
    if (!visit || seen.has(visit.node.nodeId)) continue;
    seen.add(visit.node.nodeId);
    visits.push(visit);
    const inLandmark = visit.inLandmark || (!visit.node.ignored && isLandmark(visit.node));
    const holder = visit.node.backendDOMNodeId ?? visit.holder;
    const children = (visit.node.childIds ?? []).flatMap((id) => byId.get(id) ?? []);
    for (const child of children.reverse())
      stack.push({ node: child, parent: visit.node, holder, inLandmark });
  }
  return visits;
}

/**
 * Images and controls without an accessible name, and the elements holding
 * text outside landmarks.
 *
 * @param visits - Nodes in document order
 * @param page - Count text outside landmarks (the top document)
 * @returns Hits, and how many elements hold text outside landmarks
 */
function nodeHits(visits: Visit[], page: boolean): { hits: A11yHit[]; outside: number } {
  const hits: A11yHit[] = [];
  const outside = new Set<number>();
  for (const { node, parent, holder, inLandmark } of visits) {
    if (node.ignored) continue;
    const role = roleOf(node);
    const backendNodeId = node.backendDOMNodeId;
    if (backendNodeId !== undefined && !hasName(node)) {
      if (IMAGE_ROLES.has(role)) {
        if (parent && NAMED_BY_ITSELF_ROLES.has(roleOf(parent)) && hasName(parent)) continue;
        hits.push({ rule: 'img-alt', backendNodeId, reason: { kind: 'unnamed' } });
      } else if (CONTROL_ROLES.has(role)) {
        hits.push({ rule: 'control-name', backendNodeId, reason: { kind: 'unnamed' } });
      }
    }
    if (page && role === 'StaticText' && !inLandmark && hasName(node) && holder !== undefined) {
      outside.add(holder);
    }
  }
  return { hits, outside: outside.size };
}

/**
 * Heading hits: no h1, further h1s, and levels skipped going down.
 *
 * @param visits - Nodes in document order
 * @returns Hits
 */
function headingHits(visits: Visit[]): A11yHit[] {
  const headings = visits
    .map(({ node }) => node)
    .filter((node) => !node.ignored && roleOf(node) === 'heading');
  const h1Total = headings.filter((node) => headingLevel(node) === 1).length;
  const hits: A11yHit[] =
    h1Total === 0 ? [{ rule: 'heading-order', reason: { kind: 'no-h1' } }] : [];
  let previous = 0;
  let h1Seen = 0;
  for (const node of headings) {
    const level = headingLevel(node);
    if (level === 1 && ++h1Seen > 1) {
      hits.push({
        rule: 'heading-order',
        ...(node.backendDOMNodeId !== undefined && { backendNodeId: node.backendDOMNodeId }),
        reason: { kind: 'extra-h1', total: h1Total },
      });
    } else if (previous > 0 && level > previous + 1) {
      hits.push({
        rule: 'heading-order',
        ...(node.backendDOMNodeId !== undefined && { backendNodeId: node.backendDOMNodeId }),
        reason: { kind: 'skipped-level', level, previous },
      });
    }
    previous = level;
  }
  return hits;
}

/**
 * Apply the accessibility-tree rules.
 *
 * @param nodes - Nodes of one frame's tree
 * @param options - `page`: the top document (the heading and landmark rules apply to it only)
 * @returns Hits: image and control names, headings, then the landmark findings
 */
export function findAxHits(nodes: AxNode[], options: { page: boolean }): A11yHit[] {
  const visits = inDocumentOrder(nodes);
  const { hits, outside } = nodeHits(visits, options.page);
  if (!options.page) return hits;
  const hasMain = visits.some(({ node }) => !node.ignored && roleOf(node) === 'main');
  return [
    ...hits,
    ...headingHits(visits),
    ...(hasMain ? [] : [{ rule: 'landmarks' as const, reason: { kind: 'no-main' as const } }]),
    ...(outside > 0
      ? [
          {
            rule: 'landmarks' as const,
            reason: { kind: 'outside-landmark' as const, holders: outside },
          },
        ]
      : []),
  ];
}
