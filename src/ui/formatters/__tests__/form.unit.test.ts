/**
 * Form discovery formatter: where a form is (shadow root) and components
 * whose closed shadow roots hold fields.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DiscoveredForm, FormDiscoveryResult } from '@/types.js';
import { formatFormDiscovery } from '@/ui/formatters/form.js';

/**
 * A form without fields or buttons.
 *
 * @param overrides - Properties to set
 * @returns The form
 */
function form(overrides: Partial<DiscoveredForm> = {}): DiscoveredForm {
  return {
    index: 0,
    name: 'Login',
    action: null,
    method: 'GET',
    relevanceScore: 0,
    hidden: false,
    inDialog: false,
    fields: [],
    buttons: [],
    summary: {
      totalFields: 0,
      filledFields: 0,
      emptyFields: 0,
      validFields: 0,
      invalidFields: 0,
      requiredTotal: 0,
      requiredFilled: 0,
      requiredRemaining: 0,
      emptyFieldLabels: [],
      readyToSubmit: true,
      blockers: [],
    },
    ...overrides,
  };
}

/**
 * Discovery result of the given forms.
 *
 * @param forms - Forms shown
 * @param extra - Other result properties
 * @returns The result
 */
function result(
  forms: DiscoveredForm[],
  extra: Partial<FormDiscoveryResult> = {}
): FormDiscoveryResult {
  return { formCount: forms.length, selectedForm: 0, forms, ...extra };
}

void describe('formatFormDiscovery shadow roots', () => {
  void it('marks a form in a shadow root with its host', () => {
    const output = formatFormDiscovery(result([form({ shadowHost: 'x-login' })]));
    assert.match(output, /^Form: "Login" \(in shadow root of <x-login>\)$/m);
  });

  void it('puts the shadow root after the dialog marker', () => {
    const output = formatFormDiscovery(
      result([form({ name: 'Search', inDialog: true, shadowHost: 'mdn-search-modal#mdn-search' })])
    );
    assert.match(
      output,
      /^Form: "Search" \(in dialog\) \(in shadow root of <mdn-search-modal#mdn-search>\)$/m
    );
  });

  void it('marks other forms in shadow roots', () => {
    const output = formatFormDiscovery(
      result([form()], {
        otherForms: [
          {
            index: 1,
            name: 'Newsletter',
            fieldCount: 2,
            hidden: false,
            inDialog: false,
            shadowHost: 'x-inner',
          },
        ],
      })
    );
    assert.match(output, /Form 1: "Newsletter" \(in shadow root of <x-inner>\) - 2 field\(s\)/);
  });

  void it('leaves light DOM forms unmarked', () => {
    assert.doesNotMatch(formatFormDiscovery(result([form()])), /shadow root/);
  });

  void it('names components whose closed shadow roots hold fields', () => {
    const output = formatFormDiscovery(
      result([form()], { closedShadowHosts: ['x-vault', 'pay-card#card'] })
    );
    assert.match(output, /<x-vault> has a closed shadow root with form fields/);
    assert.match(output, /<pay-card#card> has a closed shadow root with form fields/);
  });
});
