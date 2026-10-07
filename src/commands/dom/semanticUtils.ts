/**
 * Shared utilities for rendering semantic (a11y + DOM context) output.
 *
 * Used by both `dom query` and `dom get` to format accessibility nodes with
 * their surrounding DOM context and to fall back gracefully when only one
 * of the two data sources is available.
 */

import type { DomContext } from '@/commands/dom/helpers/index.js';
import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import { synthesizeA11yNode } from '@/telemetry/roleInference.js';
import type { A11yNode } from '@/types.js';
import { keyAttributeItems } from '@/ui/formatters/keyAttributes.js';
import { joinLines } from '@/ui/formatting.js';
import { elementTextLine, emptyElementLine } from '@/ui/messages/commands.js';

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
    const previewPart = domContext.preview && !domContext.text ? ` "${domContext.preview}"` : '';
    return ` ${tagPart}${classPart}>${previewPart}`;
  }

  return '';
}

/**
 * Key attributes of the element (src, href, a field's type and name, ...),
 * leaving out what the role line already shows: values equal to the
 * accessible name (an image's alt, a field's placeholder) and the value
 * when the accessibility node has one.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context with the key attributes
 * @returns ` src="…/logo.png"`-style text, or empty
 */
function buildKeyAttributesText(node: A11yNode, domContext: DomContext | null): string {
  if (!domContext?.attributes) return '';
  const shown = Object.entries(domContext.attributes)
    .filter(([, value]) => Boolean(node.name) && value === node.name)
    .map(([name]) => name);
  if (node.value !== undefined && node.value !== '') shown.push('value');
  const items = keyAttributeItems(domContext.tag, domContext.attributes, new Set(shown));
  return items.length > 0 ? ` ${items.join(' ')}` : '';
}

function buildPropertiesText(node: A11yNode): string {
  const props: string[] = [];
  if (node.value !== undefined && node.value !== '') props.push(`value: "${node.value}"`);
  const checked = node.properties?.['checked'];
  if (checked !== undefined) {
    props.push(checked === 'mixed' ? 'partly checked' : checked ? 'checked' : 'unchecked');
  }
  const expanded = node.properties?.['expanded'];
  if (expanded !== undefined) props.push(expanded ? 'expanded' : 'collapsed');
  if (node.focusable) props.push('focusable');
  if (node.focused) props.push('focused');
  if (node.disabled) props.push('disabled');
  if (node.required) props.push('required');
  return props.length > 0 ? ` (${props.join(', ')})` : '';
}

/**
 * Format a semantic node together with DOM context for human-readable output.
 *
 * The role line names the element's key attributes (an image's file name, a
 * link's href, a field's type and name), like `dom query` does, and is
 * followed by up to 500 characters of the element's text
 * (all of it with `dom get --full`) when it is longer than the one-line
 * preview or the role line shows an accessible name other than the text,
 * or, for an element without text or name, what it holds.
 *
 * @param data - Accessibility node and optional DOM context
 * @returns Role line, plus a text line for elements with longer or differently named text
 */
export function formatSemanticNodeWithContext(data: SemanticNodeWithContext): string {
  const { node, domContext } = data;
  const roleText = buildRoleText(node);
  const contextText = buildContextText(node, domContext);
  const keysText = buildKeyAttributesText(node, domContext);
  const propsText = buildPropertiesText(node);
  const inferredText = node.inferred ? ' (inferred from DOM)' : '';
  const line = `${roleText}${contextText}${keysText}${propsText}${inferredText}`;
  const text = textNotOnRoleLine(node, domContext);
  if (text) return joinLines(line, elementTextLine(text));
  if (domContext?.childCount !== undefined && !node.name) {
    return joinLines(
      line,
      emptyElementLine(domContext.children ?? [], domContext.childCount, domContext.shadowChildren)
    );
  }
  return line;
}

/**
 * The element's text when the role line does not show it: text longer than
 * the one-line preview, or the visible text of an element whose accessible
 * name is something else (an editor named by its aria-label), unless its
 * value shows that text. Texts are compared ignoring case and whitespace.
 * A sensitive field's text is never shown.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context with the text
 * @returns Text for the text line, or undefined
 */
function textNotOnRoleLine(node: A11yNode, domContext: DomContext | null): string | undefined {
  if (domContext?.sensitive) return undefined;
  if (domContext?.text) return domContext.text;
  const preview = domContext?.preview;
  if (!preview || !node.name) return undefined;
  const shown = [node.name, node.value].map((text) => comparableText(text ?? ''));
  return shown.includes(comparableText(preview)) ? undefined : preview;
}

/**
 * Text in the form texts are compared in.
 *
 * @param text - Text
 * @returns Lowercased text with whitespace collapsed
 */
function comparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
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
  if (a11yNode) return withSecretMasked(a11yNode, domContext);
  if (domContext && nodeId) return synthesizeA11yNode(domContext, nodeId);
  return null;
}

/**
 * The accessibility node with its value masked when the element holds a
 * secret (`domContext.sensitive`): Chrome reports a password field's value
 * as one bullet per character, and a field switched to text by a "show
 * password" button in clear.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context of the same element
 * @returns The node, with {@link MASKED_VALUE} as its value for a secret
 */
export function withSecretMasked(node: A11yNode, domContext: DomContext | null): A11yNode {
  if (!domContext?.sensitive || !node.value) return node;
  return { ...node, value: MASKED_VALUE };
}
