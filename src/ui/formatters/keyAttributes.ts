/**
 * Key attributes of an element (`KeyAttributes`) shortened for one line of
 * human output: `dom query` shows them in the element's tag, `dom get` after
 * its role. `--json` has the full values.
 */

import type { KeyAttributes } from '@/types.js';
import { cutMiddle, escapeControlChars, truncateUrl } from '@/ui/formatting.js';
import { safeParseUrl } from '@/utils/url.js';

/** Longest value shown (longer ones are cut in the middle) */
const MAX_VALUE_LENGTH = 40;

/**
 * An image URL as its file name, after `…/` when it had a path or host
 * before it (`…/sl-404.168b1cce.jpg`); data: URLs keep their start.
 *
 * @param src - `src` attribute
 * @returns Short form
 */
function fileName(src: string): string {
  if (/^(data|blob):/i.test(src)) return src;
  const path = src.split(/[?#]/)[0] ?? src;
  const name = path.substring(path.lastIndexOf('/') + 1);
  return name && name !== path ? `…/${name}` : src;
}

/**
 * An iframe URL as its host, with `/…` when it has a path or query
 * (`//pay.example/…`); others (about:blank, relative URLs) as given.
 *
 * @param src - `src` attribute
 * @returns Short form
 */
function hostOf(src: string): string {
  const parsed = /^https?:/i.test(src) ? safeParseUrl(src) : null;
  if (!parsed) return src;
  const more = parsed.pathname.length > 1 || parsed.search ? '/…' : '';
  return `//${parsed.host}${more}`;
}

/**
 * A link or form target: an absolute web URL as `//host/path`, cut in the
 * middle of the path (`//` keeps it from reading as a relative path).
 *
 * @param url - `href` or `action` attribute
 * @returns Short form
 */
function shortUrl(url: string): string {
  return /^https?:/i.test(url) ? `//${truncateUrl(url, MAX_VALUE_LENGTH - 2)}` : url;
}

/**
 * One value shortened for display.
 *
 * @param tag - Element tag
 * @param name - Attribute name
 * @param value - Full value
 * @returns Short value on one line
 */
export function shortValue(tag: string, name: string, value: string): string {
  let short = value;
  if (name === 'src') short = tag === 'iframe' ? hostOf(value) : fileName(value);
  else if (name === 'href' || name === 'action') short = shortUrl(value);
  return cutMiddle(escapeControlChars(short.replace(/\s+/g, ' ').trim()), MAX_VALUE_LENGTH);
}

/**
 * Key attributes as `name="value"` items, values shortened: an image's
 * file name, an iframe's host, links without their scheme, the rest cut in
 * the middle at 40 characters. `checked` is shown as a bare word, and left
 * out when false.
 *
 * @param tag - Element tag
 * @param attributes - Key attributes
 * @param leaveOut - Names not to show (already shown elsewhere)
 * @returns Items in attribute order, e.g. `['src="…/logo.png"', 'alt="Logo"']`
 */
export function keyAttributeItems(
  tag: string,
  attributes: KeyAttributes | undefined,
  leaveOut: ReadonlySet<string> = new Set()
): string[] {
  return Object.entries(attributes ?? {}).flatMap(([name, value]) => {
    if (leaveOut.has(name) || value === false) return [];
    if (value === true) return [name];
    return [`${name}="${shortValue(tag, name, value)}"`];
  });
}

/**
 * Key attributes with `type` as the page wrote it: the live type of a form
 * control (`text` for an input without `type`, `submit` for a button in a
 * form) is not an attribute, so a selector built from it would match
 * nothing. Human output shows the result; `--json` keeps the live type.
 *
 * @param attributes - Key attributes (with the live `type`)
 * @param typeAttribute - The `type` attribute as written, if the element has one
 * @returns Key attributes with `type` replaced or left out
 */
export function withWrittenType(
  attributes: KeyAttributes | undefined,
  typeAttribute: string | undefined
): KeyAttributes | undefined {
  if (!attributes || !('type' in attributes)) return attributes;
  const { type: _live, ...rest } = attributes;
  return typeAttribute ? { type: typeAttribute, ...rest } : rest;
}
