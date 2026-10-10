/**
 * `dom form` and Chrome's form errors: an error goes next to each listed
 * field at fault, the rest (e.g. a label that labels nothing) in a list.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeObjectPage } from '@/__testutils__/fakeObjectPage.js';
import type { RawField, RawFormData } from '@/ipc/protocol/domTypes.js';
import { connectedNodes, withFormIssues } from '@/runtime/dom/formIssues.js';
import type { PageIssue } from '@/types.js';

/**
 * A text field.
 *
 * @param index - Field index
 * @param backendNodeId - Its node id, if bound
 * @returns Field
 */
function field(index: number, backendNodeId?: number): RawField {
  return {
    index,
    formIndex: 0,
    selector: `#f${index}`,
    type: 'text',
    label: `Field ${index}`,
    name: `f${index}`,
    required: false,
    disabled: false,
    readOnly: false,
    hidden: false,
    native: true,
    value: '',
    isValid: true,
    ...(backendNodeId !== undefined && { backendNodeId }),
  };
}

const DATA: RawFormData = {
  forms: [
    {
      index: 0,
      name: null,
      action: null,
      method: 'GET',
      step: null,
      relevanceScore: 0,
      inIframe: false,
      fields: [field(0, 11), field(1, 12), field(2)],
      buttons: [],
    },
  ],
};

const DUPLICATE_IDS: PageIssue = {
  code: 'GenericIssue',
  type: 'FormDuplicateIdForInputError',
  text: 'Duplicate id',
  nodes: [{ backendNodeId: 11 }, { backendNodeId: 12 }],
  count: 2,
};

const LABEL_FOR_MISSING: PageIssue = {
  code: 'GenericIssue',
  type: 'FormLabelForMatchesNonExistingIdError',
  text: 'Label labels nothing',
  nodes: [
    { backendNodeId: 7, description: 'label[for="missing"]' },
    { backendNodeId: 8 },
    { backendNodeId: 9, description: 'label[for="gone"]' },
  ],
  count: 3,
};

/** Elements still in the document (9 was removed by a re-render) */
const CONNECTED = new Set([7, 8, 11, 12]);

void describe('withFormIssues', () => {
  void it('puts an error on each listed field at fault', () => {
    const fields = withFormIssues(DATA, [DUPLICATE_IDS], CONNECTED).forms[0]?.fields;
    assert.deepEqual(
      fields?.map((f) => f.issues),
      [['Duplicate id'], ['Duplicate id'], undefined]
    );
  });

  void it('lists errors of elements that are no listed field on their own', () => {
    const data = withFormIssues(DATA, [DUPLICATE_IDS, LABEL_FOR_MISSING], CONNECTED);
    assert.deepEqual(data.formIssues, [
      { text: 'Label labels nothing', elements: ['label[for="missing"]'] },
    ]);
  });

  void it('leaves out elements a re-render removed, and errors with none left', () => {
    const data = withFormIssues(DATA, [LABEL_FOR_MISSING], new Set([8, 11, 12]));
    assert.equal(data.formIssues, undefined);
  });

  void it('leaves other issues and pages without form errors alone', () => {
    const quirks: PageIssue = { code: 'QuirksModeIssue', text: 'quirks' };
    assert.equal(withFormIssues(DATA, [quirks], CONNECTED), DATA);
  });
});

/** CDP mock: node 1 is gone (no object), 2 is connected, 3 detached */
class NodeCDP {
  readonly sent: string[] = [];

  /**
   * Answer node lookups.
   *
   * @param method - CDP method
   * @param params - Params
   * @returns Result
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sent.push(method);
    if (method === 'DOM.resolveNode') {
      const id = params['backendNodeId'];
      if (id === 1) return Promise.reject(new Error('No node with given id found'));
      return Promise.resolve({ object: { type: 'object', objectId: `obj-${String(id)}` } });
    }
    if (method === 'Runtime.callFunctionOn') {
      return Promise.resolve({
        result: { type: 'boolean', value: params['objectId'] === 'obj-2' },
      });
    }
    return Promise.resolve({});
  }
}

void describe('connectedNodes', () => {
  void it('keeps the nodes still in the document and releases what it looked up', async () => {
    const cdp = new NodeCDP();
    const connected = await connectedNodes(cdp, [1, 2, 3]);
    assert.deepEqual([...connected], [2]);
    assert.equal(cdp.sent.at(-1), 'Runtime.releaseObjectGroup');
  });

  void it('keeps nodes of concurrent lookups when one releases its objects first (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) => method === 'DOM.resolveNode' && params['backendNodeId'] === 2,
    });
    const lookups = await Promise.all([connectedNodes(page, [1]), connectedNodes(page, [2])]);
    assert.deepEqual(
      lookups.map((connected) => [...connected]),
      [[1], [2]]
    );
    assert.deepEqual(page.releasedUses, []);
  });

  void it('sends nothing without nodes', async () => {
    const cdp = new NodeCDP();
    assert.equal((await connectedNodes(cdp, [])).size, 0);
    assert.deepEqual(cdp.sent, []);
  });
});
