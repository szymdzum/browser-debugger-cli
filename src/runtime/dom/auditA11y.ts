/**
 * `bdg dom audit a11y`: the accessibility-tree rules ({@link findAxHits}) of
 * the page and of each of its frames, plus the id rules, which read the DOM
 * ({@link A11Y_IDS_JS}); elements get a selector the next command can take.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { sendTyped, type Protocol } from '@/connection/typed-cdp.js';
import {
  A11Y_RULES,
  type A11yRuleId,
  type AuditA11yElement,
  type AuditA11yRule,
  type AuditResult,
} from '@/ipc/protocol/auditTypes.js';
import { findAxHits, type A11yHit, type A11yReason } from '@/runtime/dom/auditA11yModel.js';
import { AUDIT_ELEMENT_CAP } from '@/runtime/dom/auditScripts.js';
import { childFrameIds } from '@/runtime/dom/frameLayout.js';
import { NODE_SELECTOR_FUNCTION, selectorOfNode } from '@/runtime/dom/targetNode.js';
import { callFunctionInBdgWorld } from '@/runtime/page/bdgWorld.js';
import { createLogger } from '@/ui/logging/index.js';
import { a11yDetail, a11yNoSelectorNote } from '@/ui/messages/commands.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Frames whose tree is read, at most */
const A11Y_FRAME_CAP = 20;

/** Selector lookups in flight at once (each is a few page calls) */
const SELECTOR_LOOKUPS = 8;

/** Selector of a finding about the page as a whole */
const PAGE_ELEMENT = 'body';

/** An element the id scan flags, as the page reports it */
interface RawIdIssue {
  reason: A11yReason;
  tag: string;
  id: string;
  selector: string | null;
}

/** What {@link A11Y_IDS_JS} returns */
interface RawIdScan {
  total: number;
  issues: RawIdIssue[];
  capped: boolean;
}

/**
 * Page-side id scan over the document, its open shadow roots and same-origin
 * iframes. Arguments: the findings to build selectors for, the element cap.
 */
export const A11Y_IDS_JS = `function (limit, cap) {
  const selectorOf = ${NODE_SELECTOR_FUNCTION};
  const found = [];
  const roots = [document];
  let walked = 0;
  let capped = false;
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    const byId = new Map();
    const refs = [];
    for (const el of root.querySelectorAll('*')) {
      if (++walked > cap) { capped = true; break; }
      if (el.id) { if (!byId.has(el.id)) byId.set(el.id, []); byId.get(el.id).push(el); }
      for (const attribute of ['aria-labelledby', 'aria-describedby']) {
        if (el.hasAttribute(attribute)) refs.push({ el: el, attribute: attribute });
      }
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.localName === 'iframe') {
        try { if (el.contentDocument) roots.push(el.contentDocument); } catch (e) { continue; }
      }
    }
    for (const [id, els] of byId) {
      if (els.length > 1) els.slice(1).forEach((el) => found.push({ el: el, reason: { kind: 'duplicate-id', id: id, total: els.length } }));
    }
    for (const ref of refs) {
      for (const id of (ref.el.getAttribute(ref.attribute) || '').split(/\\s+/).filter(Boolean)) {
        if (!root.getElementById(id)) found.push({ el: ref.el, reason: { kind: 'missing-reference', attribute: ref.attribute, id: id } });
      }
    }
  }
  const issues = found.slice(0, limit).map((f) => ({
    reason: f.reason, tag: f.el.localName, id: f.el.id, selector: selectorOf.call(f.el)
  }));
  return { total: found.length, issues: issues, capped: capped };
}`;

/**
 * The tree of one frame.
 *
 * @param cdp - CDP connection
 * @param frameId - Frame, or undefined for the page
 * @returns Nodes, or none when the frame cannot be read (cross-origin)
 */
async function treeNodes(
  cdp: CDPConnection,
  frameId?: string
): Promise<Protocol.Accessibility.AXNode[]> {
  try {
    const { nodes } = await sendTyped(cdp, 'Accessibility.getFullAXTree', {
      ...(frameId && { frameId }),
    });
    return nodes;
  } catch (error) {
    log.debug(`No accessibility tree for frame ${frameId ?? 'top'}: ${getErrorMessage(error)}`);
    return [];
  }
}

/**
 * Hits of the page and of its frames; a frame has its own headings and
 * landmarks, so only its image and control names count.
 *
 * @param cdp - CDP connection
 * @returns Hits and whether frames were left out
 */
async function collectAxHits(cdp: CDPConnection): Promise<{ hits: A11yHit[]; truncated: boolean }> {
  const [{ frameTree }, pageNodes] = await Promise.all([
    sendTyped(cdp, 'Page.getFrameTree'),
    treeNodes(cdp),
  ]);
  const frames = childFrameIds(frameTree);
  const frameNodes = await Promise.all(
    frames.slice(0, A11Y_FRAME_CAP).map((frameId) => treeNodes(cdp, frameId))
  );
  const hits = [
    ...findAxHits(pageNodes, { page: true }),
    ...frameNodes.flatMap((nodes) => findAxHits(nodes, { page: false })),
  ];
  return { hits, truncated: frames.length > A11Y_FRAME_CAP };
}

/**
 * A label for an element no selector finds again (in an iframe, or one of several alike in a shadow root): its tag and id.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Element
 * @returns `tag#id` or `tag`
 */
async function elementLabel(cdp: CDPConnection, backendNodeId: number): Promise<string> {
  try {
    const { node } = await sendTyped(cdp, 'DOM.describeNode', { backendNodeId });
    const attributes = node.attributes ?? [];
    const id = attributes[attributes.indexOf('id') + 1];
    return node.localName + (attributes.includes('id') && id ? `#${id}` : '');
  } catch (error) {
    log.debug(`No label for node ${backendNodeId}: ${getErrorMessage(error)}`);
    return PAGE_ELEMENT;
  }
}

/**
 * The element of a hit, as a selector.
 *
 * @param cdp - CDP connection
 * @param hit - Hit
 * @returns Selector, or `tag#id` (and a note) for an element no selector finds alone
 */
async function hitElement(
  cdp: CDPConnection,
  hit: A11yHit,
  lookups: ConcurrencyLimiter
): Promise<AuditA11yElement> {
  const detail = a11yDetail(hit.reason);
  if (hit.backendNodeId === undefined) return { element: PAGE_ELEMENT, detail };
  const backendNodeId = hit.backendNodeId;
  const selector = await lookups.run(() => selectorOfNode(cdp, backendNodeId));
  return selector
    ? { element: selector, detail }
    : unselectable(await elementLabel(cdp, backendNodeId), detail);
}

/**
 * An element no selector finds alone: its label, and a note saying so.
 *
 * @param label - `tag#id` or `tag`, shown as `<tag#id>` so it is not taken for a selector
 * @param detail - What the rule found
 * @returns The listed element
 */
function unselectable(label: string, detail: string): AuditA11yElement {
  return { element: `<${label}>`, detail: `${detail} ${a11yNoSelectorNote()}` };
}

/**
 * The id-rule findings of the page.
 *
 * @param cdp - CDP connection
 * @param limit - Findings to give selectors
 * @returns The scan, or none when the page script failed
 */
async function scanIds(cdp: CDPConnection, limit: number): Promise<RawIdScan | undefined> {
  const response = await callFunctionInBdgWorld(cdp, {
    functionDeclaration: A11Y_IDS_JS,
    arguments: [{ value: limit }, { value: AUDIT_ELEMENT_CAP }],
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    log.debug(`Id scan failed: ${response.exceptionDetails.exception?.description ?? 'unknown'}`);
    return undefined;
  }
  return response.result.value as RawIdScan | undefined;
}

/**
 * Run the a11y rules.
 *
 * @param cdp - CDP connection
 * @param limit - Elements listed per rule
 * @returns One entry per rule, in {@link A11Y_RULES} order
 */
export async function auditA11y(
  cdp: CDPConnection,
  limit: number
): Promise<NonNullable<AuditResult['a11y']>> {
  await sendTyped(cdp, 'Accessibility.enable', {});
  try {
    const [{ hits, truncated }, ids] = await Promise.all([collectAxHits(cdp), scanIds(cdp, limit)]);
    const idElements = (ids?.issues ?? []).map((issue) =>
      issue.selector
        ? { element: issue.selector, detail: a11yDetail(issue.reason) }
        : unselectable(issue.tag + (issue.id ? `#${issue.id}` : ''), a11yDetail(issue.reason))
    );
    const lookups = new ConcurrencyLimiter(SELECTOR_LOOKUPS);
    const ruleEntry = async (id: A11yRuleId): Promise<AuditA11yRule> => {
      if (id === 'duplicate-id') return { id, count: ids?.total ?? 0, elements: idElements };
      const ruleHits = hits.filter((hit) => hit.rule === id);
      const elements = await Promise.all(
        ruleHits.slice(0, limit).map((hit) => hitElement(cdp, hit, lookups))
      );
      return { id, count: ruleHits.length, elements };
    };
    return {
      rules: await Promise.all(A11Y_RULES.map(ruleEntry)),
      ...((truncated || ids?.capped) && { truncated: true as const }),
    };
  } finally {
    await sendTyped(cdp, 'Accessibility.disable', {}).catch((error: unknown) =>
      log.debug(`Accessibility.disable failed: ${getErrorMessage(error)}`)
    );
  }
}
