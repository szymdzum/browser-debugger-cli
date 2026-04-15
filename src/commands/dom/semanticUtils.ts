/**
 * Shared utilities for rendering semantic (a11y + DOM context) output.
 *
 * Used by both `dom query` and `dom get` to format accessibility nodes with
 * their surrounding DOM context and to fall back gracefully when only one
 * of the two data sources is available.
 */

import { getDomContext, type DomContext } from '@/commands/dom/helpers.js';
import { callCDP } from '@/ipc/client.js';
import { synthesizeA11yNode } from '@/telemetry/roleInference.js';
import type { A11yNode } from '@/types.js';

/**
 * Accessibility node paired with its surrounding DOM context for display.
 */
export interface SemanticNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildRoleText(node: A11yNode): string {
  if (node.role.toLowerCase() === 'heading' && node.properties?.['level'] !== undefined) {
    const level = node.properties['level'];
    const levelNum = typeof level === 'number' ? level : Number(level);
    if (!isNaN(levelNum)) {
      return `[Heading L${levelNum}]`;
    }
  }
  return `[${capitalize(node.role)}]`;
}

function buildContextText(node: A11yNode, domContext: DomContext | null): string {
  if (node.name) {
    return ` "${node.name}"`;
  }

  if (domContext) {
    const tagPart = `<${domContext.tag}`;
    const classPart =
      domContext.classes && domContext.classes.length > 0
        ? `.${domContext.classes.slice(0, 3).join('.')}`
        : '';
    const previewPart = domContext.preview ? ` "${domContext.preview}"` : '';
    return ` ${tagPart}${classPart}>${previewPart}`;
  }

  return '';
}

function buildPropertiesText(node: A11yNode): string {
  const props: string[] = [];
  if (node.focusable) props.push('focusable');
  if (node.focused) props.push('focused');
  if (node.disabled) props.push('disabled');
  if (node.required) props.push('required');
  return props.length > 0 ? ` (${props.join(', ')})` : '';
}

/**
 * Format a semantic node together with DOM context for human-readable output.
 *
 * @param data - Accessibility node and optional DOM context
 * @returns One-line formatted string
 */
export function formatSemanticNodeWithContext(data: SemanticNodeWithContext): string {
  const { node, domContext } = data;
  const roleText = buildRoleText(node);
  const contextText = buildContextText(node, domContext);
  const propsText = buildPropertiesText(node);
  const inferredText = node.inferred ? ' (inferred from DOM)' : '';

  return `${roleText}${contextText}${propsText}${inferredText}`;
}

/**
 * Resolve an a11y node, falling back to a DOM-synthesized one when only
 * DOM context is available. Returns null when neither source can produce one.
 *
 * @param a11yNode - Accessibility node, if any
 * @param domContext - DOM context, if any
 * @param nodeId - CDP nodeId for synthesis
 */
export function resolveNodeWithFallback(
  a11yNode: A11yNode | null,
  domContext: DomContext | null,
  nodeId: number | undefined
): A11yNode | null {
  if (a11yNode) return a11yNode;
  if (domContext && nodeId) return synthesizeA11yNode(domContext, nodeId);
  return null;
}

/**
 * Look up a single element by selector to produce its nodeId and DOM context.
 *
 * Used by `dom get` (semantic mode) when the accessibility tree has no node
 * for the selector — the selector-based DOM context allows us to synthesize
 * one.
 */
export async function queryDomContextBySelector(
  selector: string
): Promise<{ nodeId: number | undefined; domContext: DomContext | null }> {
  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as { root?: { nodeId?: number } } | undefined;

  if (!doc?.root?.nodeId) {
    return { nodeId: undefined, domContext: null };
  }

  const queryResponse = await callCDP('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as { nodeId?: number } | undefined;

  if (!queryResult?.nodeId) {
    return { nodeId: undefined, domContext: null };
  }

  const domContext = await getDomContext(queryResult.nodeId);
  return { nodeId: queryResult.nodeId, domContext };
}
