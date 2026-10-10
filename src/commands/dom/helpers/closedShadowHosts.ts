/**
 * Custom elements with a closed shadow root, for a selector that matched
 * nothing: page scripts cannot see a closed root (`element.shadowRoot` is
 * null), CDP can. Read only on that failure path, and only when the page
 * has candidates (defined custom elements without an open shadow root).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { callBdgScript, callCDP } from '@/ipc/client.js';
import { DEEP_QUERY_JS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Custom elements checked for a closed shadow root (one `DOM.describeNode` each) */
export const CLOSED_HOST_LIMIT = 20;

/**
 * Page-side array of the elements that may host a closed shadow root:
 * defined custom elements of the top document (open shadow roots searched)
 * without an open one, at most {@link CLOSED_HOST_LIMIT} and one more (which
 * tells that the check stopped before the end of the page).
 */
export const CLOSED_HOST_CANDIDATES_JS = `(${DEEP_QUERY_JS})('*', null).filter((el) => el.ownerDocument === document && el.localName.includes('-') && !el.shadowRoot && el.matches(':defined')).slice(0, ${CLOSED_HOST_LIMIT + 1})`;

/** Calls that read the candidates */
let readCount = 0;

/** What {@link closedShadowHostNames} found */
export interface ClosedShadowHosts {
  /** Short names (`tag#id`) of the hosts, e.g. `x-vault#pay` */
  hosts: string[];
  /** The page has more candidates than were checked ({@link CLOSED_HOST_LIMIT}) */
  capped: boolean;
}

/**
 * The first {@link CLOSED_HOST_LIMIT} candidates
 * ({@link CLOSED_HOST_CANDIDATES_JS}) whose shadow root is closed, and
 * whether there were more. None when the page did not answer.
 *
 * @returns The hosts found, and whether the check stopped early
 */
export async function closedShadowHostNames(): Promise<ClosedShadowHosts> {
  const objectGroup = `bdg-closed-hosts-${process.pid}-${++readCount}`;
  try {
    const evaluated = await callBdgScript('Runtime.evaluate', {
      expression: CLOSED_HOST_CANDIDATES_JS,
      objectGroup,
    });
    const arrayId = (evaluated.data?.result as Protocol.Runtime.EvaluateResponse | undefined)
      ?.result.objectId;
    if (!arrayId) return { hosts: [], capped: false };
    const candidates = await entryObjectIds(arrayId);
    const names = await Promise.all(candidates.slice(0, CLOSED_HOST_LIMIT).map(closedHostName));
    return {
      hosts: names.filter((name): name is string => name !== undefined),
      capped: candidates.length > CLOSED_HOST_LIMIT,
    };
  } catch (error) {
    log.debug(`Closed shadow hosts not read: ${getErrorMessage(error)}`);
    return { hosts: [], capped: false };
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup }).catch((error: unknown) =>
      log.debug(`Object group not released: ${getErrorMessage(error)}`)
    );
  }
}

/**
 * Object ids of the entries of a page-side array, in order.
 *
 * @param arrayId - The array
 * @returns Entry object ids
 */
async function entryObjectIds(arrayId: string): Promise<string[]> {
  const response = await callCDP('Runtime.getProperties', {
    objectId: arrayId,
    ownProperties: true,
  });
  const properties =
    (response.data?.result as Protocol.Runtime.GetPropertiesResponse | undefined)?.result ?? [];
  return properties
    .filter((property) => /^\d+$/.test(property.name))
    .sort((a, b) => Number(a.name) - Number(b.name))
    .flatMap((property) => (property.value?.objectId ? [property.value.objectId] : []));
}

/**
 * The short name of an element whose shadow root is closed.
 *
 * @param objectId - The element
 * @returns `tag#id`, or undefined when it has no closed shadow root
 */
async function closedHostName(objectId: string): Promise<string | undefined> {
  const described = await callCDP('DOM.describeNode', { objectId });
  const node = (described.data?.result as Protocol.DOM.DescribeNodeResponse | undefined)?.node;
  if (!node?.shadowRoots?.some((root) => root.shadowRootType === 'closed')) return undefined;
  const attributes = node.attributes ?? [];
  const idAt = attributes.findIndex((name, i) => i % 2 === 0 && name === 'id');
  const id = idAt >= 0 ? attributes[idAt + 1] : undefined;
  return node.localName + (id ? `#${id}` : '');
}
