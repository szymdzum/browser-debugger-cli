/**
 * Chrome Issues in output: the `bdg console` Issues block (capped, with the
 * elements or file:line), `console --json` `issues`, the `peek` count and
 * the form errors of `dom form`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ISSUES_SHOWN } from '@/constants.js';
import type { BdgOutput, DiscoveredForm, FormField, PageIssue } from '@/types.js';
import { buildConsoleJsonOutput, formatConsole } from '@/ui/formatters/console.js';
import { formatFormDiscovery } from '@/ui/formatters/form.js';
import { formatPreview } from '@/ui/formatters/preview.js';

const QUIRKS: PageIssue = {
  code: 'QuirksModeIssue',
  text: 'Page is in quirks mode (no <!doctype html>): layout differs from standards mode',
  source: { url: 'http://localhost/quirks' },
};

const DUPLICATE_IDS: PageIssue = {
  code: 'GenericIssue',
  type: 'FormDuplicateIdForInputError',
  text: 'Duplicate id on form fields: labels and autofill reach only the first',
  nodes: [
    { backendNodeId: 11, description: 'input#pet' },
    { backendNodeId: 12, description: 'input#pet' },
  ],
  count: 2,
};

const FAILED_IMPORT: PageIssue = {
  code: 'StylesheetLoadingIssue',
  type: 'RequestFailed',
  text: 'Stylesheet failed to load: http://localhost/missing.css (net::ERR_ABORTED)',
  source: { url: 'http://localhost/pages/import', line: 3, column: 1 },
};

/**
 * Issues of distinct stylesheets.
 *
 * @param count - How many
 * @returns Issues
 */
function manyIssues(count: number): PageIssue[] {
  return Array.from({ length: count }, (_, i) => ({ ...FAILED_IMPORT, text: `sheet ${i}` }));
}

/**
 * The Issues block of a console text.
 *
 * @param output - Console output
 * @returns Lines from the block's heading on
 */
function issuesBlock(output: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.startsWith('Issues ('));
  return start === -1 ? [] : lines.slice(start).filter((line) => line !== '');
}

void describe('console Issues block', () => {
  void it('lists each issue on one line with the elements or file:line', () => {
    const block = issuesBlock(
      formatConsole([], { issues: [QUIRKS, DUPLICATE_IDS, FAILED_IMPORT] })
    );
    assert.deepEqual(block.slice(2), [
      `• ${QUIRKS.text} → http://localhost/quirks`,
      `• ${DUPLICATE_IDS.text} → input#pet, input#pet`,
      `• ${FAILED_IMPORT.text} → import:3:1`,
    ]);
    assert.equal(block[0], 'Issues (3)');
  });

  void it(`shows at most ${ISSUES_SHOWN} and says how many more there are`, () => {
    const block = issuesBlock(formatConsole([], { issues: manyIssues(12), issuesDropped: 4 }));
    assert.equal(block[0], 'Issues (16)');
    assert.equal(block.filter((line) => line.startsWith('• ')).length, ISSUES_SHOWN);
    assert.match(block.at(-1) ?? '', /\+4 more; bdg console --json lists them; 4 more not kept/);
    assert.ok(block.length <= ISSUES_SHOWN + 3, 'stays short');
  });

  void it('names a few elements and counts the rest', () => {
    const issue: PageIssue = {
      ...DUPLICATE_IDS,
      nodes: Array.from({ length: 5 }, (_, i) => ({ backendNodeId: i, description: 'label' })),
      count: 30,
    };
    assert.match(formatConsole([], { issues: [issue] }), /→ label, label, label \+27 more\n/);
  });

  void it('shows nothing when the page has no issues', () => {
    assert.doesNotMatch(formatConsole([], { issues: [] }), /Issues/);
  });

  void it('follows the list, but not a --level filter', () => {
    assert.equal(issuesBlock(formatConsole([], { list: true, issues: [QUIRKS] })).length, 3);
    assert.deepEqual(issuesBlock(formatConsole([], { level: 'error', issues: [QUIRKS] })), []);
  });
});

void describe('console --json issues', () => {
  void it('has every kept issue and how many were not kept', () => {
    const output = buildConsoleJsonOutput([], { issues: manyIssues(12), issuesDropped: 4 });
    assert.equal(output.issues?.length, 12);
    assert.equal(output.issuesDropped, 4);
  });
});

void describe('peek issue count', () => {
  const preview = (totals: NonNullable<BdgOutput['totals']>): BdgOutput => ({
    version: '0.0.0',
    success: true,
    timestamp: new Date().toISOString(),
    duration: 0,
    target: { url: 'test', title: 'test' },
    data: { network: [], console: [] },
    totals,
  });

  void it('counts the issues of the page', () => {
    const output = formatPreview(preview({ network: 0, console: 0, issues: 2 }), { last: 10 });
    assert.match(output, /ISSUES: 2 \(bdg console lists them\)/);
    const verbose = formatPreview(preview({ network: 0, console: 0, issues: 2 }), {
      last: 10,
      verbose: true,
    });
    assert.match(verbose, /ISSUES: 2/);
  });

  void it('says nothing without issues', () => {
    const output = formatPreview(preview({ network: 0, console: 0, issues: 0 }), { last: 10 });
    assert.doesNotMatch(output, /ISSUES/);
  });
});

void describe('dom form issues', () => {
  const field: FormField = {
    index: 0,
    formIndex: 0,
    selector: '#pet',
    type: 'text',
    label: 'Pet',
    name: 'pet',
    required: false,
    disabled: false,
    readOnly: false,
    hidden: false,
    native: true,
    state: 'empty',
    value: '',
    validation: { valid: true, confidence: 'high' },
    issues: [DUPLICATE_IDS.text],
    command: 'bdg dom fill 0 "<value>"',
    selectorCommand: 'bdg dom fill "#pet" "<value>"',
  };
  const form: DiscoveredForm = {
    index: 0,
    name: 'Pets',
    action: null,
    method: 'GET',
    relevanceScore: 0,
    hidden: false,
    inDialog: false,
    fields: [field],
    buttons: [],
    summary: {
      totalFields: 1,
      filledFields: 0,
      emptyFields: 1,
      validFields: 1,
      invalidFields: 0,
      requiredTotal: 0,
      requiredFilled: 0,
      requiredRemaining: 0,
      emptyFieldLabels: ['Pet'],
      readyToSubmit: false,
      blockers: [],
    },
  };

  void it('puts a field error under the field and the others in their own list', () => {
    const output = formatFormDiscovery({
      formCount: 1,
      selectedForm: 0,
      forms: [form],
      formIssues: [
        { text: "Label's for attribute matches no element id", elements: ['label[for="x"]'] },
      ],
    });
    assert.match(output, /Pet .*\n {6}⚠ Duplicate id on form fields/);
    assert.match(
      output,
      /Form markup issues \(Chrome\):\n {2}• Label's for attribute matches no element id → label\[for="x"\]/
    );
  });

  void it('names the form of an error in a form not shown', () => {
    const output = formatFormDiscovery({
      formCount: 2,
      selectedForm: 0,
      forms: [form],
      formIssues: [
        { text: 'Duplicate id', elements: ['Second pet [4]'], form: { index: 1, hidden: true } },
      ],
    });
    assert.match(output, /• Duplicate id → Second pet \[4\] \(in form 1, hidden; --all lists it\)/);
  });

  void it('shows field errors in --brief too', () => {
    const output = formatFormDiscovery({
      formCount: 1,
      selectedForm: 0,
      forms: [form],
      brief: true,
    });
    assert.match(output, /⚠ Duplicate id on form fields/);
  });
});
