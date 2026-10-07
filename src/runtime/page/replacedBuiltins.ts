/**
 * Which browser built-ins a page replaced (polyfills, old frameworks,
 * anti-bot scripts). Scripts that must run in the page's own world (actions,
 * `dom eval` results) depend on them.
 *
 * The check does not trust the page: a small page script only collects the
 * functions (plain property reads and the page's
 * `Object.getOwnPropertyDescriptor`, itself checked), and whether each is
 * native comes from the description CDP gives a function, which V8 builds
 * itself, so a replaced `Function.prototype.toString` or `.call` changes
 * nothing. A getter or setter counts as the property (a page-defined getter
 * on `window.getComputedStyle`, a replaced `value` setter); a property that
 * throws or is gone counts as replaced. An iterator is not checked when the
 * page replaced `Symbol` (iteration does not use it).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Description V8 gives a native function, e.g. `function querySelector() { [native code] }` */
const NATIVE_FUNCTION = /\{\s*\[native code\]\s*\}$/;

/** Suffix naming a prototype's iterator, e.g. `NodeList.prototype[Symbol.iterator]` */
const ITERATOR_SUFFIX = '[Symbol.iterator]';

/** Path segment the collector reads as `Symbol.iterator` */
const ITERATOR_KEY = '@@iterator';

/** Object group of the collected functions (released after each check) */
const OBJECT_GROUP = 'bdg-builtins';

/**
 * Page-side collector: for each name, the function(s) behind it, as a flat
 * list of `index, function` pairs (`undefined` for one that throws or is
 * gone). Uses no array or object helpers of the page.
 *
 * @param names - Dotted paths from the global object (a leading `window.` is
 *   skipped; a trailing `[Symbol.iterator]` names the iterator)
 * @returns Function declaration
 */
function collectorFunction(names: readonly string[]): string {
  const paths = names.map((name) =>
    name
      .replace(/^window\./, '')
      .replace(ITERATOR_SUFFIX, `.${ITERATOR_KEY}`)
      .split('.')
  );
  return `function () {
  const paths = ${JSON.stringify(paths)};
  const describe = Object.getOwnPropertyDescriptor;
  const found = [];
  const add = (i, value) => { found[found.length] = i; found[found.length] = value; };
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    let key = path[path.length - 1];
    let owner = window;
    try {
      for (let j = 0; j < path.length - 1; j++) owner = owner[path[j]];
    } catch (e) { add(i, undefined); continue; }
    if (key === '${ITERATOR_KEY}') {
      try { key = Symbol.iterator; } catch (e) { continue; }
      if (typeof key !== 'symbol') continue;
    }
    let own;
    try { own = describe(owner, key); } catch (e) { own = undefined; }
    if (own && (own.get || own.set)) {
      if (own.get) add(i, own.get);
      if (own.set) add(i, own.set);
    } else if (own) {
      add(i, own.value);
    } else {
      try { add(i, owner[key]); } catch (e) { continue; }
    }
  }
  return found;
}`;
}

/**
 * The built-ins of a list that the page replaced.
 *
 * @param cdp - CDP connection (or session) of the page
 * @param names - Dotted paths, e.g. `Element.prototype.matches`,
 *   `window.getComputedStyle`, `NodeList.prototype[Symbol.iterator]`
 * @param objectId - An object of the realm to check (e.g. a frame's eval
 *   result); default: the page's main world
 * @returns The replaced ones, in list order (empty when the check failed)
 */
export async function findReplacedBuiltins(
  cdp: CDPSender,
  names: readonly string[],
  objectId?: string
): Promise<string[]> {
  const functionDeclaration = collectorFunction(names);
  try {
    const collected = (await (objectId
      ? cdp.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration,
          objectGroup: OBJECT_GROUP,
        })
      : cdp.send('Runtime.evaluate', {
          expression: `(${functionDeclaration})()`,
          objectGroup: OBJECT_GROUP,
        }))) as Protocol.Runtime.EvaluateResponse;
    const listId = collected.result.objectId;
    if (collected.exceptionDetails || !listId) return [];
    const { result } = (await cdp.send('Runtime.getProperties', {
      objectId: listId,
      ownProperties: true,
    })) as Protocol.Runtime.GetPropertiesResponse;
    return replacedNames(names, result);
  } catch (error) {
    log.debug(`Built-ins not checked: ${getErrorMessage(error)}`);
    return [];
  } finally {
    await cdp
      .send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP })
      .catch((error: unknown) => log.debug(`Built-ins not released: ${getErrorMessage(error)}`));
  }
}

/**
 * Names whose collected function is not native.
 *
 * @param names - The names checked
 * @param properties - Properties of the collected `index, function` list
 * @returns Replaced names, in list order
 */
function replacedNames(
  names: readonly string[],
  properties: Protocol.Runtime.PropertyDescriptor[]
): string[] {
  const entries = new Map<number, Protocol.Runtime.RemoteObject | undefined>();
  for (const property of properties) {
    if (/^\d+$/.test(property.name)) entries.set(Number(property.name), property.value);
  }
  const replaced = new Set<number>();
  for (let i = 0; entries.has(i); i += 2) {
    const index: unknown = entries.get(i)?.value;
    const value = entries.get(i + 1);
    const native = value?.type === 'function' && NATIVE_FUNCTION.test(value.description ?? '');
    if (typeof index === 'number' && !native) replaced.add(index);
  }
  return names.filter((_name, i) => replaced.has(i));
}
