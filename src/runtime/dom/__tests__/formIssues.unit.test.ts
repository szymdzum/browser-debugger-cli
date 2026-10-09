/**
 * `dom form` and Chrome's form errors: an error goes next to each listed
 * field at fault, the rest (e.g. a label that labels nothing) in a list.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RawField, RawFormData } from '@/ipc/protocol/domTypes.js';
import { withFormIssues } from '@/runtime/dom/formIssues.js';
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
  nodes: [{ backendNodeId: 7, description: 'label[for="missing"]' }, { backendNodeId: 8 }],
  count: 2,
};

void describe('withFormIssues', () => {
  void it('puts an error on each listed field at fault', () => {
    const fields = withFormIssues(DATA, [DUPLICATE_IDS]).forms[0]?.fields;
    assert.deepEqual(
      fields?.map((f) => f.issues),
      [['Duplicate id'], ['Duplicate id'], undefined]
    );
  });

  void it('lists errors of elements that are no listed field on their own', () => {
    const data = withFormIssues(DATA, [DUPLICATE_IDS, LABEL_FOR_MISSING]);
    assert.deepEqual(data.formIssues, [
      { text: 'Label labels nothing', elements: ['label[for="missing"]', 'node 8'] },
    ]);
  });

  void it('leaves other issues and pages without form errors alone', () => {
    const quirks: PageIssue = { code: 'QuirksModeIssue', text: 'quirks' };
    assert.equal(withFormIssues(DATA, [quirks]), DATA);
  });
});
