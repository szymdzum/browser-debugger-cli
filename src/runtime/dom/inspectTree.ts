/**
 * The child tree of `bdg dom inspect`: the page-side walk's children
 * ({@link RawTreeNode}) with sizes rounded, consecutive identical siblings
 * (same label, size and layout) grouped into one row with a count
 * (`li.card ×33 266x107`), and cut to a number of rows in document order.
 */

import type { InspectTreeNode } from '@/ipc/protocol/inspectTypes.js';
import { containerKind } from '@/runtime/dom/inspectLayoutModel.js';
import type { RawTreeNode } from '@/runtime/dom/inspectScripts.js';

/** Default depth of the tree */
export const DEFAULT_TREE_DEPTH = 2;

/** Default number of rows */
export const DEFAULT_TREE_LIMIT = 20;

/** Characters of text kept per row */
const ROW_TEXT_LENGTH = 30;

/**
 * Cut a row's text on a whole character.
 *
 * @param text - Text
 * @returns At most {@link ROW_TEXT_LENGTH} characters, with `…` when cut
 */
export function rowText(text: string): string {
  const characters = Array.from(text);
  return characters.length > ROW_TEXT_LENGTH
    ? `${characters.slice(0, ROW_TEXT_LENGTH).join('').trimEnd()}…`
    : text;
}

/**
 * One child as a tree row (its children converted too).
 *
 * @param raw - Child from the page-side walk
 * @returns Tree row
 */
function toNode(raw: RawTreeNode): InspectTreeNode {
  const layout = containerKind(raw.display);
  const children = raw.children ? groupSiblings(raw.children.map(toNode)) : undefined;
  return {
    element: raw.label,
    x: Math.round(raw.x * 10) / 10,
    y: Math.round(raw.y * 10) / 10,
    w: Math.round(raw.w),
    h: Math.round(raw.h),
    ...(layout && { layout }),
    ...(raw.text && { text: rowText(raw.text) }),
    ...(children && children.length > 0 && { children }),
    ...(raw.childCount && { childCount: raw.childCount }),
    ...(raw.hidden && { hiddenChildren: raw.hidden }),
  };
}

/**
 * Whether two siblings look the same in the tree.
 *
 * @param a - Row
 * @param b - Row
 * @returns True for the same label, size and layout
 */
function identical(a: InspectTreeNode, b: InspectTreeNode): boolean {
  return a.element === b.element && a.w === b.w && a.h === b.h && a.layout === b.layout;
}

/**
 * Group runs of identical siblings into one row with a count. A group keeps
 * its text only when every member has the same, and lists no children.
 *
 * @param nodes - Sibling rows
 * @returns Rows with runs grouped
 */
export function groupSiblings(nodes: readonly InspectTreeNode[]): InspectTreeNode[] {
  const grouped: InspectTreeNode[] = [];
  for (let i = 0; i < nodes.length;) {
    const first = nodes[i] as InspectTreeNode;
    let run = 1;
    while (i + run < nodes.length && identical(first, nodes[i + run] as InspectTreeNode)) run++;
    if (run === 1) {
      grouped.push(first);
    } else {
      const members = nodes.slice(i, i + run);
      const sameText = members.every((member) => member.text === first.text);
      const {
        children: _children,
        childCount: _count,
        hiddenChildren: _hidden,
        text,
        ...row
      } = first;
      grouped.push({ ...row, ...(sameText && text && { text }), count: run });
    }
    i += run;
  }
  return grouped;
}

/**
 * Rows a node takes in the tree (itself and its listed descendants).
 *
 * @param node - Row
 * @returns Row count
 */
function rowCount(node: InspectTreeNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + rowCount(child), 0);
}

/**
 * Keep the first rows in document order.
 *
 * @param nodes - Rows
 * @param budget - Rows still allowed (decremented)
 * @returns Kept rows and the number left out
 */
function prune(
  nodes: readonly InspectTreeNode[],
  budget: { left: number }
): { kept: InspectTreeNode[]; dropped: number } {
  const kept: InspectTreeNode[] = [];
  let dropped = 0;
  for (const node of nodes) {
    if (budget.left <= 0) {
      dropped += rowCount(node);
      continue;
    }
    budget.left--;
    if (!node.children) {
      kept.push(node);
      continue;
    }
    const sub = prune(node.children, budget);
    dropped += sub.dropped;
    const { children: _children, ...row } = node;
    kept.push(sub.kept.length > 0 ? { ...row, children: sub.kept } : row);
  }
  return { kept, dropped };
}

/**
 * The child tree from the page-side walk: grouped, then cut to `limit` rows.
 *
 * @param raw - Children from the walk
 * @param limit - Rows shown at most
 * @param skipped - Children the walk did not reach (counted as left out)
 * @returns Rows and the number of rows left out
 */
export function buildTree(
  raw: readonly RawTreeNode[],
  limit: number,
  skipped = 0
): { children: InspectTreeNode[]; moreRows: number } {
  const rows = groupSiblings(raw.map(toNode));
  const { kept, dropped } = prune(rows, { left: limit });
  return { children: kept, moreRows: dropped + skipped };
}
