/**
 * Daemon side of form discovery: the listed fields and buttons are bound to
 * their nodes by index, and custom elements whose closed shadow roots hold
 * fields are named.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeObjectPage } from '@/__testutils__/fakeObjectPage.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { formDiscoveryGroup, readFormDiscovery } from '@/runtime/dom/formDiscoveryNodes.js';
import type { RawFormData } from '@/runtime/dom/formTypes.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';

/** Discovery data: one form with a field (index 0) and a button (index 1) */
const DATA: RawFormData = {
  forms: [
    {
      index: 0,
      name: 'Login',
      action: null,
      method: 'GET',
      step: null,
      relevanceScore: 10,
      inIframe: false,
      shadowHost: 'x-login',
      fields: [
        {
          index: 0,
          formIndex: 0,
          selector: 'input[name="email"]',
          type: 'email',
          label: 'Email',
          name: 'email',
          required: true,
          disabled: false,
          readOnly: false,
          hidden: false,
          native: true,
          value: '',
          isValid: false,
        },
      ],
      buttons: [
        {
          index: 1,
          selector: 'form > button',
          label: 'Go',
          type: 'submit',
          disabled: false,
          explicitSubmit: false,
          formDefault: true,
          primaryClass: false,
        },
      ],
    },
  ],
};

/** Page-side array as `Runtime.getProperties` lists it */
function arrayProperties(objectIds: string[]): Protocol.Runtime.GetPropertiesResponse {
  return {
    result: [
      ...objectIds.map((objectId, i) => ({
        name: String(i),
        configurable: true,
        enumerable: true,
        value: { type: 'object' as const, objectId },
      })),
      {
        name: 'length',
        configurable: false,
        enumerable: false,
        value: { type: 'number' as const, value: objectIds.length },
      },
    ],
  };
}

/** Described nodes by object id or backend node id */
const NODES: Record<string, unknown> = {
  field: { backendNodeId: 101 },
  button: { backendNodeId: 102 },
  vault: {
    backendNodeId: 201,
    localName: 'x-vault',
    attributes: ['class', 'card', 'id', 'pay'],
    shadowRoots: [{ backendNodeId: 301, shadowRootType: 'closed' }],
  },
  icon: {
    backendNodeId: 202,
    localName: 'x-icon',
    attributes: [],
    shadowRoots: [{ backendNodeId: 302, shadowRootType: 'closed' }],
  },
  plain: { backendNodeId: 203, localName: 'x-plain', attributes: [] },
  '301': {
    backendNodeId: 301,
    children: [
      { nodeName: 'FORM', children: [{ nodeName: 'INPUT', attributes: ['name', 'card'] }] },
    ],
  },
  '302': {
    backendNodeId: 302,
    children: [
      { nodeName: 'SPAN', children: [{ nodeName: 'INPUT', attributes: ['type', 'hidden'] }] },
    ],
  },
};

/**
 * Fake page connection answering for the discovery result `root`.
 *
 * @param options - `failDescribe`: describeNode throws; `data`: discovery data returned
 * @returns Connection and the methods it received
 */
function fakeCdp(options: { failDescribe?: boolean; data?: unknown } = {}): {
  cdp: CDPSender;
  sent: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    sent.push({ method, params });
    switch (method) {
      case 'Runtime.callFunctionOn':
        return Promise.resolve({ result: { type: 'object', value: options.data ?? DATA } });
      case 'Runtime.getProperties': {
        const lists: Record<string, Protocol.Runtime.GetPropertiesResponse> = {
          root: {
            result: ['data', 'nodes', 'hosts'].map((name) => ({
              name,
              configurable: true,
              enumerable: true,
              value: { type: 'object' as const, objectId: name },
            })),
          },
          nodes: arrayProperties(['field', 'button']),
          hosts: arrayProperties(['vault', 'icon', 'plain']),
        };
        return Promise.resolve(lists[String(params['objectId'])] ?? { result: [] });
      }
      case 'DOM.describeNode': {
        if (options.failDescribe) return Promise.reject(new Error('No node with given id found'));
        const key = String(params['objectId'] ?? params['backendNodeId']);
        return Promise.resolve({ node: NODES[key] });
      }
      default:
        return Promise.resolve({});
    }
  };
  return { cdp: { send }, sent };
}

/** Object group of the discovery read */
const GROUP = 'bdg-form-discovery-test';

void describe('readFormDiscovery', () => {
  void it('binds each listed field and button to its node by index', async () => {
    const data = await readFormDiscovery(fakeCdp().cdp, 'root', GROUP);
    assert.equal(data.forms[0]?.fields[0]?.backendNodeId, 101);
    assert.equal(data.forms[0]?.buttons[0]?.backendNodeId, 102);
    assert.equal(data.forms[0]?.shadowHost, 'x-login');
  });

  void it('names custom elements whose closed shadow root holds a visible field', async () => {
    const data = await readFormDiscovery(fakeCdp().cdp, 'root', GROUP);
    assert.deepEqual(data.closedShadowHosts, ['x-vault#pay']);
  });

  void it('pierces a closed shadow root to read what it holds', async () => {
    const { cdp, sent } = fakeCdp();
    await readFormDiscovery(cdp, 'root', GROUP);
    const described = sent.filter(
      (call) => call.method === 'DOM.describeNode' && call.params['backendNodeId'] === 301
    );
    assert.deepEqual(described[0]?.params, { backendNodeId: 301, depth: -1, pierce: true });
  });

  void it('still returns the forms when nodes cannot be described', async () => {
    const data = await readFormDiscovery(fakeCdp({ failDescribe: true }).cdp, 'root', GROUP);
    assert.equal(data.forms[0]?.fields[0]?.backendNodeId, undefined);
    assert.equal(data.closedShadowHosts, undefined);
    assert.equal(data.forms.length, 1);
  });

  void it('releases the objects of the discovery', async () => {
    const { cdp, sent } = fakeCdp();
    await readFormDiscovery(cdp, 'root', GROUP);
    assert.deepEqual(sent.at(-1), {
      method: 'Runtime.releaseObjectGroup',
      params: { objectGroup: GROUP },
    });
  });

  void it('reads concurrent discoveries when one releases its objects first (#584)', async () => {
    const [first, second] = [formDiscoveryGroup(), formDiscoveryGroup()];
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) => method === 'Runtime.evaluate' && params['objectGroup'] === second,
      callResult: () => ({ result: { type: 'object', value: DATA } }),
    });
    const discovered = async (objectGroup: string): Promise<RawFormData> => {
      const { result } = (await page.send('Runtime.evaluate', {
        objectGroup,
      })) as Protocol.Runtime.EvaluateResponse;
      return readFormDiscovery(page, result.objectId, objectGroup);
    };
    const reads = await Promise.allSettled([discovered(first), discovered(second)]);
    assert.deepEqual(
      reads.map((read) =>
        read.status === 'rejected' ? String(read.reason) : read.value.forms.length
      ),
      [1, 1]
    );
    assert.deepEqual(page.releasedUses, []);
  });

  void it('rejects a result that is not discovery data, and still releases', async () => {
    const { cdp, sent } = fakeCdp({ data: { nothing: true } });
    await assert.rejects(
      readFormDiscovery(cdp, 'root', GROUP),
      /Unexpected form discovery response/
    );
    assert.equal(sent.at(-1)?.method, 'Runtime.releaseObjectGroup');
  });
});
