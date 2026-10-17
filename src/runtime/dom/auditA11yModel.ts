/**
 * Rules of `bdg dom audit a11y` over the computed accessibility tree. Pure:
 * tested without a browser.
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
  | { kind: 'outside-landmark' };

/** An element a rule flags; `backendNodeId` is missing for page-level findings */
export interface A11yHit {
  rule: A11yRuleId;
  backendNodeId?: number;
  reason: A11yReason;
}

/**
 * Apply the accessibility-tree rules.
 *
 * @param nodes - Nodes of one frame's tree
 * @param options - `page`: the top document (heading and landmark rules apply to it only)
 * @returns Hits in document order
 */
export function findAxHits(
  nodes: Protocol.Accessibility.AXNode[],
  options: { page: boolean }
): A11yHit[] {
  void nodes;
  void options;
  throw new Error('not implemented');
}
