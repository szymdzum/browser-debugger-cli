/**
 * The class list of an element as `dom query`, `dom get` (`domContext`) and
 * `dom get --raw` report it in JSON.
 */

/**
 * The classes of an element, from its attributes.
 *
 * @param attributes - Element attributes
 * @returns The class names in attribute order
 */
export function elementClasses(attributes: Record<string, string>): string[] {
  void attributes;
  throw new Error('not implemented');
}
