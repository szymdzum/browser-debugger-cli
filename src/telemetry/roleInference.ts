/**
 * Role inference utilities for synthesizing accessibility nodes from DOM context.
 *
 * When Chrome's accessibility tree returns no data for an element (all nodes ignored),
 * these utilities infer semantic meaning from HTML tags using implicit ARIA roles.
 *
 * @see https://www.w3.org/TR/html-aria/#docconformance
 */

import type { DomContext } from '@/types.js';
import type { A11yNode } from '@/types.js';

/**
 * Implicit ARIA roles mapped from HTML tags.
 *
 * Based on WAI-ARIA specification for HTML elements.
 * These represent the default accessibility semantics browsers assign to elements.
 *
 * @see https://www.w3.org/TR/html-aria/#docconformance
 */
const IMPLICIT_ARIA_ROLES: Record<string, string> = {
  // Interactive elements
  a: 'link',
  button: 'button',
  input: 'textbox',
  select: 'combobox',
  textarea: 'textbox',
  option: 'option',

  // Headings
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',

  // Landmarks
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  section: 'region',
  article: 'article',
  form: 'form',
  search: 'search',

  // Media
  img: 'image',
  figure: 'figure',
  figcaption: 'caption',
  video: 'video',
  audio: 'audio',

  // Lists
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  dl: 'list',
  dt: 'term',
  dd: 'definition',
  menu: 'menu',
  menuitem: 'menuitem',

  // Tables
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tfoot: 'rowgroup',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',

  // Other semantic elements
  dialog: 'dialog',
  details: 'group',
  summary: 'button',
  progress: 'progressbar',
  meter: 'meter',
  output: 'status',
  address: 'group',
  blockquote: 'blockquote',
  code: 'code',
  pre: 'group',
  hr: 'separator',
};

/**
 * Default role when no implicit mapping exists.
 */
const DEFAULT_ROLE = 'generic';

/**
 * Maximum length for synthesized accessible name from DOM text preview.
 */
const MAX_NAME_LENGTH = 100;

/**
 * Infers an ARIA role from an HTML tag name.
 *
 * Uses the WAI-ARIA specification's implicit role mappings.
 * Returns 'generic' for unknown or non-semantic tags (div, span, etc.).
 *
 * @param tag - HTML tag name (case-insensitive)
 * @returns Inferred ARIA role
 *
 * @example
 * ```typescript
 * inferRoleFromTag('button') // => 'button'
 * inferRoleFromTag('H1')     // => 'heading'
 * inferRoleFromTag('div')    // => 'generic'
 * ```
 */
export function inferRoleFromTag(tag: string): string {
  const normalizedTag = tag.toLowerCase();
  return IMPLICIT_ARIA_ROLES[normalizedTag] ?? DEFAULT_ROLE;
}

/**
 * Extracts heading level from tag name.
 *
 * @param tag - HTML tag name
 * @returns Heading level (1-6) or null if not a heading
 */
function extractHeadingLevel(tag: string): number | null {
  const match = tag.toLowerCase().match(/^h([1-6])$/);
  const level = match?.[1];
  if (!level) {
    return null;
  }
  return parseInt(level, 10);
}

/**
 * Synthesizes an A11yNode from DOM context when accessibility data is unavailable.
 *
 * Creates a minimal accessibility node with:
 * - Role inferred from HTML tag
 * - Name from text preview (if available)
 * - `inferred: true` flag to signal synthesized data
 *
 * @param domContext - DOM context with tag, classes, and text preview
 * @param nodeId - CDP node ID to associate with the synthesized node
 * @returns Synthesized A11yNode with `inferred: true`
 *
 * @example
 * ```typescript
 * synthesizeA11yNode(
 *   { tag: 'a', preview: 'Main page', classes: ['nav-link'] },
 *   123
 * );
 * // => { nodeId: '123', role: 'link', name: 'Main page', inferred: true, backendDOMNodeId: 123 }
 * ```
 */
export function synthesizeA11yNode(domContext: DomContext, nodeId?: number): A11yNode {
  const role = inferRoleFromTag(domContext.tag);

  const node: A11yNode = {
    nodeId: nodeId !== undefined ? String(nodeId) : 'synthesized',
    role,
    inferred: true,
    ...(nodeId !== undefined && { backendDOMNodeId: nodeId }),
  };

  // Use text preview as accessible name (truncated if needed)
  if (domContext.preview) {
    const name =
      domContext.preview.length > MAX_NAME_LENGTH
        ? domContext.preview.slice(0, MAX_NAME_LENGTH - 3) + '...'
        : domContext.preview;
    node.name = name;
  }

  // Add heading level as property for h1-h6 elements
  const headingLevel = extractHeadingLevel(domContext.tag);
  if (headingLevel !== null) {
    node.properties = { level: headingLevel };
  }

  return node;
}
