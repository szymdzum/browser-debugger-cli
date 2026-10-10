/**
 * The class list of an element as `dom query`, `dom get` (`domContext`) and
 * `dom get --raw` report it in JSON.
 */

/**
 * The classes of an element, from its attributes: always an array, empty
 * when the element has no class attribute or only whitespace in it.
 *
 * @param attributes - Element attributes
 * @returns The class names in attribute order
 */
export function elementClasses(attributes: Record<string, string>): string[] {
  return (attributes['class'] ?? '').split(/\s+/).filter(Boolean);
}
