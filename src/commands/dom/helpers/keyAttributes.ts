/**
 * The attributes that identify an element by its type (an image's `src`, a
 * link's `href`, a field's name and value), shown by `dom query`, `dom get`
 * and `dom a11y describe`.
 */

import type { ElementState, KeyAttributes } from '@/types.js';

/** Shown instead of a password field's value */
export const MASKED_VALUE = '••••';

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
 * The key attributes of an element: the identifying attributes of its type
 * that are set (empty ones left out) and the live state of a form control
 * (type, current value, checked, selected options). A password field's value
 * is masked.
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
  if (!names) return undefined;
  const result: KeyAttributes = {};
  const type = state.type ?? attributes['type'];
  if (type) result['type'] = type;
  for (const name of names) {
    const value = attributes[name];
    if (value) result[name] = value;
  }
  if (state.value) result['value'] = type === 'password' ? MASKED_VALUE : state.value;
  if (state.checked !== undefined) result['checked'] = state.checked;
  if (state.selected) result['selected'] = state.selected;
  return Object.keys(result).length > 0 ? result : undefined;
}
