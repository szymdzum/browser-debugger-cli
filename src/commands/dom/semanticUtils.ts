/**
 * Shared utilities for rendering semantic (a11y + DOM context) output.
 *
 * Used by both `dom query` and `dom get` to format accessibility nodes with
 * their surrounding DOM context and to fall back gracefully when only one
 * of the two data sources is available.
 */

import type { DomContext } from '@/commands/dom/helpers/index.js';
import { MASKED_VALUE, labelClasses } from '@/runtime/dom/elementInfo.js';
import { synthesizeA11yNode } from '@/telemetry/roleInference.js';
import type { A11yNode } from '@/types.js';
import { keyAttributeItems, shortId, withWrittenType } from '@/ui/formatters/keyAttributes.js';
import { escapeControlChars, joinLines } from '@/ui/formatting.js';
import { elementTextLine, emptyElementLine } from '@/ui/messages/commands.js';

/**
 * Accessibility node paired with its surrounding DOM context for display.
 */
export interface SemanticNodeWithContext {
  /** The accessibility node; `backendNodeId` is the DOM node's backend id (`dom get` adds it) */
  node: A11yNode & { backendNodeId?: number };
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

/**
 * Elements that cannot hold children (void elements) or whose content is a
 * value shown on the role line (form controls): an empty-element line adds
 * nothing for them.
 */
const NO_CHILDREN_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
  'select',
  'textarea',
]);

/** An id that reads as a selector fragment, shown as `#id` */
const PLAIN_ID = /^[A-Za-z_][\w-]*$/;

/**
 * The text of the role line after the role: the accessible name, or the
 * element as `<tag#id.class>` with a one-line preview.
 *
 * A plain id is `#id`; one with a space, quote or other character a
 * selector cannot hold is `id="..."` as `dom query` writes it. Ids and
 * names are shortened to one line (control characters escaped, long ids
 * cut); `--json` keeps them whole.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context, if read
 * @returns Text starting with a space, or empty
 */
export function buildContextText(node: A11yNode, domContext: DomContext | null): string {
  const name = escapeControlChars(node.name?.replace(/\s+/g, ' ').trim() ?? '');
  if (name) return ` "${name}"`;

  if (domContext) {
    const id = domContext.id;
    const plainId = id !== undefined && PLAIN_ID.test(id);
    const tagPart = `<${domContext.tag}${plainId ? `#${shortId(id)}` : ''}`;
    const { shown } = labelClasses(domContext.classes, 3);
    const classPart = shown.length > 0 ? `.${shown.join('.')}` : '';
    const previewPart = domContext.preview && !domContext.text ? ` "${domContext.preview}"` : '';
    const idPart = id && !plainId ? ` id="${shortId(id)}"` : '';
    return ` ${tagPart}${classPart}${idPart}>${previewPart}`;
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
 * @param origin - Origin of the page, for links
 * @returns ` src="…/logo.png"`-style text, or empty
 */
function buildKeyAttributesText(
  node: A11yNode,
  domContext: DomContext | null,
  origin: string | undefined
): string {
  const attributes = withWrittenType(domContext?.attributes, domContext?.typeAttribute);
  if (!domContext || !attributes) return '';
  const shown = Object.entries(attributes)
    .filter(([, value]) => Boolean(node.name) && value === node.name)
    .map(([name]) => name);
  if (node.value !== undefined && node.value !== '') shown.push('value');
  const items = keyAttributeItems(domContext.tag, attributes, new Set(shown), origin);
  return items.length > 0 ? ` ${items.join(' ')}` : '';
}

function buildPropertiesText(node: A11yNode): string {
  const props: string[] = [];
  if (node.value !== undefined && node.value !== '') props.push(`value: "${node.value}"`);
  const checked = node.properties?.['checked'];
  if (checked !== undefined) {
    props.push(checked === 'mixed' ? 'partly checked' : checked ? 'checked' : 'unchecked');
  }
  const invalidValue = node.properties?.['invalid'];
  const invalid = invalidValue === true || invalidValue === 'true';
  const expanded = node.properties?.['expanded'];
  if (expanded !== undefined) props.push(expanded ? 'expanded' : 'collapsed');
  if (invalid) props.push('invalid');
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
 * @param options - `origin` of the page, so its own links show as paths
 * @returns Role line, plus a text line for elements with longer or differently named text
 */
export function formatSemanticNodeWithContext(
  data: SemanticNodeWithContext,
  options: { origin?: string | undefined } = {}
): string {
  const { node, domContext } = data;
  const roleText = buildRoleText(node);
  const contextText = buildContextText(node, domContext);
  const keysText = buildKeyAttributesText(node, domContext, options.origin);
  const propsText = buildPropertiesText(node);
  const inferredText = node.inferred ? ' (inferred from DOM)' : '';
  const line = `${roleText}${contextText}${keysText}${propsText}${inferredText}`;
  const text = textNotOnRoleLine(node, domContext);
  if (text) return joinLines(line, elementTextLine(text));
  if (domContext?.childCount !== undefined && !node.name && !NO_CHILDREN_TAGS.has(domContext.tag)) {
    return joinLines(
      line,
      emptyElementLine(
        domContext.children ?? [],
        domContext.childCount,
        domContext.shadowChildren ? (domContext.shadowRootMode ?? 'open') : undefined
      )
    );
  }
  return line;
}

/**
 * The element's text when the role line does not show it: text longer than
 * the one-line preview, or the visible text of an element whose accessible
 * name is something else (an editor named by its aria-label), unless its
 * name or value shows that text (a long heading with inline children is
 * named by all of it). Texts are compared ignoring case and whitespace.
 * A sensitive field's text is never shown.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context with the text
 * @returns Text for the text line, or undefined
 */
function textNotOnRoleLine(node: A11yNode, domContext: DomContext | null): string | undefined {
  if (domContext?.sensitive) return undefined;
  const text = domContext?.text ?? (node.name ? domContext?.preview : undefined);
  if (!text) return undefined;
  const shown = [node.name, node.value].map((value) => comparableText(value ?? ''));
  return shown.includes(comparableText(text)) ? undefined : text;
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
