/**
 * The attributes that identify an element by its type (an image's `src`, a
 * link's `href`, a field's name and value), shown by `dom query`, `dom get`
 * and `dom a11y describe`.
 */

import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import type { ElementState, KeyAttributes } from '@/types.js';

/** Attributes read for each element type (live state is added for form controls) */
const ATTRIBUTES_BY_TAG: Record<string, readonly string[]> = {
  img: ['src', 'alt'],
  a: ['href'],
  input: ['name', 'placeholder'],
  textarea: ['name', 'placeholder'],
  button: ['name'],
  select: ['name'],
  iframe: ['src'],
  form: ['action', 'method'],
};

/**
 * The key attributes of an element: its shadow `part` name (how a page's CSS
 * reaches it with `::part()`), the identifying attributes of its type that
 * are set (empty ones left out) and the live state of a form control
 * (type, current value, checked, selected options). Values arrive masked
 * from the page (`ELEMENT_STATE_JS`); a hidden input's value is never read,
 * and a sensitive field's value is masked here again in case it was not.
 *
 * @param tag - Lower-case tag name
 * @param attributes - Element attributes
 * @param state - Live state read in the page (`ELEMENT_STATE_JS`)
 * @returns Key attributes, or undefined for an element type without any
 */
export function keyAttributes(
  tag: string,
  attributes: Record<string, string>,
  state: ElementState = {}
): KeyAttributes | undefined {
  const names = ATTRIBUTES_BY_TAG[tag];
  const part = attributes['part'];
  if (!names) return part ? { part } : undefined;
  const result: KeyAttributes = part ? { part } : {};
  const type = state.type ?? attributes['type'];
  if (type) result['type'] = type;
  for (const name of names) {
    const value = attributes[name];
    if (value) result[name] = value;
  }
  if (type === 'hidden') return result;
  const secret = state.sensitive === true || type === 'password';
  if (state.value) result['value'] = secret ? MASKED_VALUE : state.value;
  if (state.checked !== undefined) result['checked'] = state.checked;
  if (state.selected) result['selected'] = secret ? MASKED_VALUE : state.selected;
  return Object.keys(result).length > 0 ? result : undefined;
}
