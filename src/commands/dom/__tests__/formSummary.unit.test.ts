/**
 * `bdg dom form` counts choice groups once, is ready only when the required
 * fields are filled and something is, and picks the button that submits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateSummary, primaryButtonIndex } from '@/commands/dom/formSummary.js';
import type { FormButton, FormField, RawButton } from '@/runtime/dom/formTypes.js';
import { formReadinessMessage, requiredFieldsEmptyMessage } from '@/ui/messages/commands.js';

let nextIndex = 0;

/**
 * Build a discovered field.
 *
 * @param label - Field label
 * @param fields - Fields to set
 * @returns Field
 */
function field(label: string, fields: Partial<FormField> = {}): FormField {
  const index = nextIndex++;
  return {
    index,
    formIndex: 0,
    selector: `#f${index}`,
    type: 'text',
    label,
    name: null,
    required: false,
    disabled: false,
    readOnly: false,
    hidden: false,
    native: true,
    state: 'empty',
    value: '',
    validation: { valid: true, confidence: 'high' },
    command: `bdg dom fill ${index} "<value>"`,
    selectorCommand: '',
    ...fields,
  };
}

/**
 * Build a radio or checkbox option of a named group.
 *
 * @param type - radio or checkbox
 * @param name - Group name
 * @param label - Option label
 * @param checked - Whether it is checked
 * @returns Field
 */
function option(
  type: 'radio' | 'checkbox',
  name: string,
  label: string,
  checked = false
): FormField {
  return field(label, {
    type,
    inputType: type,
    name,
    groupLabel: `Pizza ${name}`,
    state: checked ? 'checked' : 'unchecked',
    value: checked,
  });
}

/**
 * Build a raw button.
 *
 * @param label - Button label
 * @param fields - Fields to set
 * @returns Button
 */
function rawButton(label: string, fields: Partial<RawButton> = {}): RawButton {
  return {
    index: nextIndex++,
    selector: `#b${label}`,
    label,
    type: 'submit',
    disabled: false,
    explicitSubmit: false,
    formDefault: true,
    primaryClass: false,
    ...fields,
  };
}

const submit: FormButton = {
  index: 99,
  selector: '#go',
  label: 'Go',
  type: 'submit',
  primary: true,
  enabled: true,
  command: 'bdg dom click 99',
};

void describe('calculateSummary counting', () => {
  void it('counts a radio group and a checkbox group once each', () => {
    const summary = calculateSummary(
      [
        field('Name', { state: 'filled', value: 'Ada' }),
        option('radio', 'size', 'Small'),
        option('radio', 'size', 'Medium', true),
        option('radio', 'size', 'Large'),
        option('checkbox', 'topping', 'Bacon'),
        option('checkbox', 'topping', 'Onion'),
      ],
      [submit]
    );
    assert.equal(summary.totalFields, 3);
    assert.equal(summary.filledFields, 2);
    assert.deepEqual(summary.emptyFieldLabels, ['Pizza topping']);
  });

  void it('leaves hidden, disabled and read-only fields out', () => {
    const summary = calculateSummary(
      [
        field('Name', { state: 'filled', value: 'Ada' }),
        field('Hidden', { hidden: true }),
        field('Off', { disabled: true }),
        field('Locked', { readOnly: true }),
      ],
      []
    );
    assert.equal(summary.totalFields, 1);
  });
});

void describe('calculateSummary readiness', () => {
  void it('is not ready while a required field is empty, and names it', () => {
    const summary = calculateSummary(
      [
        field('First Name', { state: 'filled', value: 'Ada', required: true }),
        field('Last Name', { required: true }),
        field('Zip', { required: true }),
      ],
      [submit]
    );
    assert.equal(summary.readyToSubmit, false);
    assert.equal(summary.requiredRemaining, 2);
    assert.deepEqual(
      summary.blockers.map((b) => b.label),
      ['Last Name', 'Zip']
    );
    assert.equal(
      requiredFieldsEmptyMessage(['Last Name', 'Zip']),
      '2 required fields empty: Last Name, Zip'
    );
  });

  void it('treats a required radio group as filled once any option is checked', () => {
    const size = [option('radio', 'size', 'Small'), option('radio', 'size', 'Large')].map((f) => ({
      ...f,
      required: true,
    }));
    assert.equal(calculateSummary(size, [submit]).blockers[0]?.label, 'Pizza size');
    size[1] = { ...(size[1] as FormField), state: 'checked', value: true };
    assert.equal(calculateSummary(size, [submit]).readyToSubmit, true);
  });

  void it('is not ready when nothing is filled, and ready for a form without fields', () => {
    const untouched = calculateSummary([field('Name'), field('Email')], [submit]);
    assert.equal(untouched.readyToSubmit, false);
    assert.equal(formReadinessMessage(untouched), 'NOT ready (no fields filled)');
    assert.equal(calculateSummary([], [submit]).readyToSubmit, true);
  });

  void it('says when it is ready only because no field is marked required', () => {
    const summary = calculateSummary(
      [field('First Name', { state: 'filled', value: 'Ada' }), field('Last Name')],
      [submit]
    );
    assert.equal(summary.readyToSubmit, true);
    assert.equal(
      formReadinessMessage(summary),
      'READY to submit (no field is marked required; empty: Last Name)'
    );
  });

  void it('is blocked by a disabled submit button', () => {
    const summary = calculateSummary(
      [field('Name', { state: 'filled', value: 'Ada' })],
      [{ ...submit, enabled: false }]
    );
    assert.equal(summary.readyToSubmit, false);
  });
});

void describe('primaryButtonIndex', () => {
  void it('never picks Cancel, Reset or Back, even as the form default button', () => {
    const cancel = rawButton('Cancel');
    const proceed = rawButton('Continue', {
      explicitSubmit: true,
      formDefault: false,
      primaryClass: true,
    });
    assert.equal(primaryButtonIndex([cancel, proceed]), proceed.index);
    assert.equal(
      primaryButtonIndex([rawButton('Back'), rawButton('Reset', { type: 'reset' })]),
      undefined
    );
    assert.equal(primaryButtonIndex([rawButton('Delete')]), undefined);
  });

  void it('knows cancel and back in other languages', () => {
    for (const label of [
      'Abbrechen',
      'Zurück',
      'Annuler',
      'Retour',
      'Cancelar',
      'Volver',
      'Annulla',
      'Indietro',
      'Anuluj',
      'Wstecz',
    ]) {
      assert.equal(primaryButtonIndex([rawButton(label)]), undefined, label);
    }
  });

  void it('takes the last untyped form button, or the one styled as primary', () => {
    const draft = rawButton('Save draft');
    const send = rawButton('Send');
    assert.equal(primaryButtonIndex([draft, send]), send.index);
    const styled = rawButton('Order', { primaryClass: true });
    assert.equal(primaryButtonIndex([styled, rawButton('Later')]), styled.index);
  });

  void it('ignores a button outside a form unless it is styled as primary', () => {
    assert.equal(primaryButtonIndex([rawButton('Toggle', { formDefault: false })]), undefined);
  });

  void it('prefers an explicit submit button, then the form default, then a primary style', () => {
    const styled = rawButton('Save', { type: 'button', formDefault: false, primaryClass: true });
    const implicit = rawButton('Send');
    const explicit = rawButton('Order', { explicitSubmit: true, formDefault: false });
    assert.equal(primaryButtonIndex([styled, implicit, explicit]), explicit.index);
    assert.equal(primaryButtonIndex([styled, implicit]), implicit.index);
    assert.equal(
      primaryButtonIndex([styled, rawButton('Help', { type: 'button', formDefault: false })]),
      styled.index
    );
  });
});
