/**
 * Daemon side of form discovery: run the page script
 * ({@link FORM_DISCOVERY_SCRIPT}) and read what it found.
 *
 * Besides the discovery data, the script hands over the listed fields and
 * buttons and the custom elements without an open shadow root. Each listed
 * element gets its backend node id, so `dom form` indices address the exact
 * node even when its selector is not unique (a field in a shadow root has no
 * selector path from the document). A closed shadow root is invisible to
 * page scripts (`element.shadowRoot` is null) but not to CDP: the custom
 * elements are described with `pierce`, and those whose closed root holds a
 * field are named as not inspectable.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { FORM_DISCOVERY_SCRIPT, isRawFormData } from '@/runtime/dom/formDiscovery.js';
import type { RawFormData } from '@/runtime/dom/formTypes.js';
import { evaluateInBdgWorld } from '@/runtime/page/bdgWorld.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Object group holding the discovery result and the nodes read from it */
export const FORM_DISCOVERY_GROUP = 'bdg-form-discovery';

/** Function returning the discovery data of the script's result */
const DATA_FUNCTION = 'function () { return this.data; }';

/**
 * Run the discovery script in bdg's world, keeping its result in
 * {@link FORM_DISCOVERY_GROUP} for {@link readFormDiscovery} (released here
 * when the script threw).
 *
 * @param cdp - Connection to the page
 * @returns Evaluate response; its result is the script's `{ data, nodes, hosts }`
 */
export async function evaluateFormDiscovery(
  cdp: Parameters<typeof evaluateInBdgWorld>[0]
): Promise<Protocol.Runtime.EvaluateResponse> {
  const response = await evaluateInBdgWorld(cdp, {
    expression: FORM_DISCOVERY_SCRIPT,
    objectGroup: FORM_DISCOVERY_GROUP,
  });
  if (response.exceptionDetails) await releaseDiscovery(cdp);
  return response;
}

/**
 * Read the discovery data from the script's result, with the backend node
 * id of each listed field and button and the custom elements whose closed
 * shadow roots hold fields. Node lookups that fail leave the data as it is
 * (the CLI then resolves fields by selector). Releases the result.
 *
 * @param cdp - Connection to the page
 * @param objectId - The script's result
 * @returns Discovery data
 * @throws Error when the result is not discovery data
 */
export async function readFormDiscovery(
  cdp: CDPSender,
  objectId: string | undefined
): Promise<RawFormData> {
  try {
    const data = objectId ? await discoveryData(cdp, objectId) : undefined;
    if (!objectId || !isRawFormData(data)) {
      throw new Error('Unexpected form discovery response');
    }
    const parts = await ownObjectIds(cdp, objectId);
    const [nodeIds, closedHosts] = await Promise.all([
      backendNodeIds(cdp, parts.get('nodes')).catch(logged([])),
      closedShadowHosts(cdp, parts.get('hosts')).catch(logged([])),
    ]);
    const bind = <T extends { index: number }>(element: T): T => {
      const backendNodeId = nodeIds[element.index];
      return backendNodeId === undefined ? element : { ...element, backendNodeId };
    };
    return {
      ...data,
      forms: data.forms.map((form) => ({
        ...form,
        fields: form.fields.map(bind),
        buttons: form.buttons.map(bind),
      })),
      ...(closedHosts.length > 0 && { closedShadowHosts: closedHosts }),
    };
  } finally {
    await releaseDiscovery(cdp);
  }
}

/**
 * Fallback for a failed node lookup: logs it and gives the empty result.
 *
 * @param empty - Result without nodes
 * @returns Rejection handler
 */
function logged<T>(empty: T): (error: unknown) => T {
  return (error) => {
    log.debug(`Form discovery nodes not read: ${getErrorMessage(error)}`);
    return empty;
  };
}

/**
 * Release the discovery result and the objects read from it.
 *
 * @param cdp - Connection to the page
 */
async function releaseDiscovery(cdp: CDPSender): Promise<void> {
  await cdp
    .send('Runtime.releaseObjectGroup', { objectGroup: FORM_DISCOVERY_GROUP })
    .catch(logged(undefined));
}

/**
 * The discovery data, copied by value.
 *
 * @param cdp - Connection to the page
 * @param objectId - The script's result
 * @returns Its `data`
 */
async function discoveryData(cdp: CDPSender, objectId: string): Promise<unknown> {
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: DATA_FUNCTION,
    returnByValue: true,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  return response.result.value;
}

/**
 * Object ids of an object's own properties.
 *
 * @param cdp - Connection to the page
 * @param objectId - Object
 * @returns Object id by property name (array entries by index)
 */
async function ownObjectIds(cdp: CDPSender, objectId: string): Promise<Map<string, string>> {
  const response = (await cdp.send('Runtime.getProperties', {
    objectId,
    ownProperties: true,
  })) as Protocol.Runtime.GetPropertiesResponse;
  const ids = new Map<string, string>();
  for (const property of response.result) {
    if (property.value?.objectId) ids.set(property.name, property.value.objectId);
  }
  return ids;
}

/**
 * Object ids of the entries of a page-side array (holes left undefined).
 *
 * @param cdp - Connection to the page
 * @param arrayObjectId - The array
 * @returns Entries by index
 */
async function arrayEntries(
  cdp: CDPSender,
  arrayObjectId: string | undefined
): Promise<Array<string | undefined>> {
  if (!arrayObjectId) return [];
  const entries: Array<string | undefined> = [];
  for (const [name, objectId] of await ownObjectIds(cdp, arrayObjectId)) {
    if (/^\d+$/.test(name)) entries[Number(name)] = objectId;
  }
  return entries;
}

/**
 * Backend node ids of the listed fields and buttons.
 *
 * @param cdp - Connection to the page
 * @param arrayObjectId - Page-side array of the elements by index
 * @returns Backend node id by index
 */
async function backendNodeIds(
  cdp: CDPSender,
  arrayObjectId: string | undefined
): Promise<Array<number | undefined>> {
  const entries = await arrayEntries(cdp, arrayObjectId);
  return Promise.all(
    Array.from(entries, async (objectId) => {
      if (!objectId) return undefined;
      const { node } = (await cdp.send('DOM.describeNode', {
        objectId,
      })) as Protocol.DOM.DescribeNodeResponse;
      return node.backendNodeId;
    })
  );
}

/**
 * The custom elements whose closed shadow root holds a form field.
 *
 * @param cdp - Connection to the page
 * @param arrayObjectId - Page-side array of custom elements without an open shadow root
 * @returns Their short names, e.g. `x-vault#pay`
 */
async function closedShadowHosts(
  cdp: CDPSender,
  arrayObjectId: string | undefined
): Promise<string[]> {
  const entries = (await arrayEntries(cdp, arrayObjectId)).filter(
    (objectId): objectId is string => objectId !== undefined
  );
  const names = await Promise.all(
    entries.map(async (objectId) => {
      const { node } = (await cdp.send('DOM.describeNode', {
        objectId,
        depth: 1,
        pierce: true,
      })) as Protocol.DOM.DescribeNodeResponse;
      const closed = node.shadowRoots?.find((root) => root.shadowRootType === 'closed');
      if (!closed) return undefined;
      const { node: root } = (await cdp.send('DOM.describeNode', {
        backendNodeId: closed.backendNodeId,
        depth: -1,
        pierce: true,
      })) as Protocol.DOM.DescribeNodeResponse;
      return holdsField(root) ? shortName(node) : undefined;
    })
  );
  return names.filter((name): name is string => name !== undefined);
}

/**
 * Whether a described subtree holds a form field (a visible input, a select
 * or a textarea), nested shadow roots included.
 *
 * @param node - Described node with its subtree
 * @returns True when it holds one
 */
function holdsField(node: Protocol.DOM.Node): boolean {
  if (node.nodeName === 'SELECT' || node.nodeName === 'TEXTAREA') return true;
  if (node.nodeName === 'INPUT' && attribute(node, 'type')?.toLowerCase() !== 'hidden') return true;
  return [...(node.children ?? []), ...(node.shadowRoots ?? [])].some(holdsField);
}

/**
 * An attribute of a described node.
 *
 * @param node - Described node
 * @param name - Attribute name
 * @returns Its value, or undefined
 */
function attribute(node: Protocol.DOM.Node, name: string): string | undefined {
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    if (attributes[i] === name) return attributes[i + 1];
  }
  return undefined;
}

/**
 * Short name of an element, as form discovery names shadow hosts: its tag
 * and id, e.g. `x-vault#pay`.
 *
 * @param node - Described element
 * @returns Name
 */
function shortName(node: Protocol.DOM.Node): string {
  const id = attribute(node, 'id');
  return node.localName + (id ? `#${id}` : '');
}
