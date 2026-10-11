/**
 * A node whose accessible name or description comes from a secret field
 * (`aria-labelledby`, `aria-describedby`) shows `••••` for that part (#642):
 * Chrome computes a name from a referenced field's value (it masks password
 * fields there, not card numbers or other secret-named fields).
 *
 * The raw nodes are shaped as `Accessibility.getPartialAXTree` returns
 * them: a name's `sources` carry the related nodes with the text each
 * contributed; a description's `describedby` property carries the related
 * nodes without their text.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import { maskSecretMessages, maskSecretRelations, secretRelationIds } from '@/telemetry/a11y.js';
import type { A11yNode, A11yTree } from '@/types.js';

/** The card field's backend node id (secret) and the label's (not) */
const CARD = 14;
const LABEL = 60;

/**
 * A text box named through `aria-labelledby`, as Chrome reports it.
 *
 * @param name - Computed name
 * @param related - The nodes the name comes from, with their text
 * @returns Raw node
 */
function labelledBy(
  name: string,
  related: Protocol.Accessibility.AXRelatedNode[]
): Protocol.Accessibility.AXNode {
  return {
    nodeId: '15',
    ignored: false,
    role: { type: 'role', value: 'textbox' },
    backendDOMNodeId: 15,
    name: {
      type: 'computedString',
      value: name,
      sources: [
        {
          type: 'relatedElement',
          value: { type: 'computedString', value: name },
          attribute: 'aria-labelledby',
          attributeValue: { type: 'idrefList', value: 'lbl cc', relatedNodes: related },
        },
        { type: 'attribute', attribute: 'aria-label', superseded: true },
      ],
    },
    value: { type: 'string', value: 'REFVALUE8' },
    properties: [{ name: 'labelledby', value: { type: 'nodeList', relatedNodes: related } }],
  };
}

/** A text box described by the card field (`aria-describedby`) */
const DESCRIBED_BY_CARD: Protocol.Accessibility.AXNode = {
  nodeId: '16',
  ignored: false,
  role: { type: 'role', value: 'textbox' },
  backendDOMNodeId: 16,
  name: { type: 'computedString', value: '' },
  description: { type: 'computedString', value: '4111111111111111' },
  value: { type: 'string', value: 'DESCVALUE9' },
  properties: [
    {
      name: 'describedby',
      value: {
        type: 'idrefList',
        value: 'cc',
        relatedNodes: [{ backendDOMNodeId: CARD, idref: 'cc' }],
      },
    },
  ],
};

const NAMED_BY_LABEL_AND_CARD = labelledBy('Confirm 4111111111111111', [
  { backendDOMNodeId: LABEL, idref: 'lbl', text: 'Confirm' },
  { backendDOMNodeId: CARD, idref: 'cc', text: '4111111111111111' },
]);

/**
 * The parsed node of a raw one, as the tree holds it.
 *
 * @param raw - Raw node
 * @returns Parsed node
 */
function parsed(raw: Protocol.Accessibility.AXNode): A11yNode {
  const text = (value: Protocol.Accessibility.AXValue | undefined): string | undefined =>
    typeof value?.value === 'string' && value.value !== '' ? value.value : undefined;
  const node: A11yNode = {
    nodeId: raw.nodeId,
    role: 'textbox',
    backendDOMNodeId: raw.backendDOMNodeId ?? 0,
  };
  const name = text(raw.name);
  const description = text(raw.description);
  const value = text(raw.value);
  if (name !== undefined) node.name = name;
  if (description !== undefined) node.description = description;
  if (value !== undefined) node.value = value;
  return node;
}

const isCard = (backendNodeId: number): boolean => backendNodeId === CARD;

void describe('secret relations of an accessibility node (#642)', () => {
  void it('lists the backend ids a name and a description come from', () => {
    assert.deepEqual(secretRelationIds(NAMED_BY_LABEL_AND_CARD), [LABEL, CARD]);
    assert.deepEqual(secretRelationIds(DESCRIBED_BY_CARD), [CARD]);
    assert.deepEqual(
      secretRelationIds({ nodeId: '1', ignored: false, role: { type: 'role', value: 'button' } }),
      []
    );
  });

  void it('replaces the part of the name a secret field contributed', () => {
    const node = maskSecretRelations(
      parsed(NAMED_BY_LABEL_AND_CARD),
      NAMED_BY_LABEL_AND_CARD,
      isCard
    );
    assert.equal(node.name, `Confirm ${MASKED_VALUE}`);
    assert.equal(node.value, 'REFVALUE8', 'the node’s own value is not a secret');
    assert.doesNotMatch(JSON.stringify(node), /4111/);
  });

  void it('replaces the whole description when a secret field describes the node', () => {
    const node = maskSecretRelations(parsed(DESCRIBED_BY_CARD), DESCRIBED_BY_CARD, isCard);
    assert.equal(node.description, MASKED_VALUE);
    assert.equal(node.value, 'DESCVALUE9');
  });

  void it('replaces the whole name when the secret contribution is not known', () => {
    const raw = labelledBy('Confirm 4111111111111111', [
      { backendDOMNodeId: LABEL, idref: 'lbl', text: 'Confirm' },
      { backendDOMNodeId: CARD, idref: 'cc' },
    ]);
    assert.equal(maskSecretRelations(parsed(raw), raw, isCard).name, MASKED_VALUE);
  });

  void it('leaves a node alone whose relations are not secret', () => {
    const raw = labelledBy('Confirm', [{ backendDOMNodeId: LABEL, idref: 'lbl', text: 'Confirm' }]);
    const node = parsed(raw);
    assert.equal(maskSecretRelations(node, raw, isCard), node);
    assert.equal(
      maskSecretRelations(parsed(DESCRIBED_BY_CARD), DESCRIBED_BY_CARD, () => false).description,
      '4111111111111111'
    );
  });
});

void describe('validation alert of a secret field (#643)', () => {
  void it('renames the alert that carries a secret field\u2019s validation message, nothing else', () => {
    const alert: A11yNode = {
      nodeId: '-1',
      role: 'alert',
      name: 'Please lengthen this text to 8 characters or more (you are currently using 5 characters). ',
    };
    const label: A11yNode = { nodeId: '2', role: 'StaticText', name: 'Nickname' };
    const root: A11yNode = {
      nodeId: '1',
      role: 'RootWebArea',
      name: 'page',
      childIds: ['-1', '2'],
    };
    const tree: A11yTree = {
      root,
      nodes: new Map([
        ['1', root],
        ['-1', alert],
        ['2', label],
      ]),
      count: 3,
    };
    maskSecretMessages(tree, new Set([(alert.name ?? '').trim()]));
    assert.equal(tree.nodes.get('-1')?.name, MASKED_VALUE);
    assert.equal(tree.nodes.get('2')?.name, 'Nickname');
    assert.doesNotMatch(JSON.stringify([...tree.nodes.values()]), /using 5 characters/);
  });
});
