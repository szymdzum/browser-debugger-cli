/**
 * Label cleanup in the injected form discovery script.
 *
 * The helper lives inside FORM_DISCOVERY_SCRIPT (a string evaluated in the
 * page), so it is extracted from the script source and run in an isolated
 * VM context, like the page would.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { FORM_DISCOVERY_SCRIPT } from '@/runtime/dom/formDiscovery.js';

/**
 * Extract `cleanLabelText` from the injected script.
 *
 * @returns The page-side label cleanup function
 */
function loadCleanLabelText(): (text: string) => string {
  const start = FORM_DISCOVERY_SCRIPT.indexOf('function cleanLabelText(text) {');
  const end = FORM_DISCOVERY_SCRIPT.indexOf('function extractLabel(', start);
  assert.ok(start >= 0 && end > start, 'cleanLabelText not found in FORM_DISCOVERY_SCRIPT');
  const source = FORM_DISCOVERY_SCRIPT.slice(start, end);
  return vm.runInNewContext(`${source}; cleanLabelText`) as (text: string) => string;
}

const cleanLabelText = loadCleanLabelText();

void describe('cleanLabelText', () => {
  void it('keeps words that merely contain or are navigation words', () => {
    assert.equal(cleanLabelText('Feedback'), 'Feedback');
    assert.equal(cleanLabelText('Backup email'), 'Backup email');
    assert.equal(cleanLabelText('Forwarding address'), 'Forwarding address');
    assert.equal(cleanLabelText('Next of kin'), 'Next of kin');
  });

  void it('strips arrow glyphs and arrow words', () => {
    assert.equal(cleanLabelText('Next →'), 'Next');
    assert.equal(cleanLabelText('Search chevron'), 'Search');
    assert.equal(cleanLabelText('Email ▼'), 'Email');
  });
});

/**
 * Extract `labelMarksRequired` from the injected script.
 *
 * @returns The page-side required-star check
 */
function loadLabelMarksRequired(): (text: string) => boolean {
  const start = FORM_DISCOVERY_SCRIPT.indexOf('function labelMarksRequired(text) {');
  const end = FORM_DISCOVERY_SCRIPT.indexOf('// Required by attribute', start);
  assert.ok(start >= 0 && end > start, 'labelMarksRequired not found in FORM_DISCOVERY_SCRIPT');
  const source = FORM_DISCOVERY_SCRIPT.slice(start, end);
  return vm.runInNewContext(`${source}; labelMarksRequired`) as (text: string) => boolean;
}

const labelMarksRequired = loadLabelMarksRequired();

void describe('labelMarksRequired', () => {
  void it('takes a standalone star before or after the label as required', () => {
    assert.equal(labelMarksRequired('First Name *'), true);
    assert.equal(labelMarksRequired('First Name *:'), true);
    assert.equal(labelMarksRequired('* First Name'), true);
    assert.equal(labelMarksRequired('  Zip\n  *  '), true);
  });

  void it('ignores footnote stars and stars inside the text', () => {
    assert.equal(labelMarksRequired('Terms*'), false);
    assert.equal(labelMarksRequired('*Terms'), false);
    assert.equal(labelMarksRequired('Rate * 2'), false);
    assert.equal(labelMarksRequired('Name'), false);
  });
});

void describe('cleanLabelText stars', () => {
  void it('drops a standalone required star but keeps a footnote star', () => {
    assert.equal(cleanLabelText('Last Name *'), 'Last Name');
    assert.equal(cleanLabelText('Last Name *:'), 'Last Name:');
    assert.equal(cleanLabelText('Terms*'), 'Terms*');
  });
});
