/**
 * A field is secret by its accessible label too (#633): the shared secret
 * name rule is applied to a text-like control's `aria-label`, the text of
 * its `aria-labelledby` targets, its `<label for>` or wrapping label, its
 * placeholder and title, never to a checkbox, radio, button or
 * contenteditable element (a "Show password" checkbox is not masked) and
 * never to the control's own text.
 *
 * The rule runs here in an isolated VM context on element-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { SENSITIVE_FIELD_JS } from '@/runtime/dom/elementInfo.js';

/** A text node as the rule reads it */
interface FakeText {
  nodeType: 3;
  data: string;
}

/** An element as the rule reads it */
interface FakeElement {
  nodeType: 1;
  localName: string;
  type: string;
  id: string;
  isContentEditable: boolean;
  labels: FakeElement[] | null;
  childNodes: Array<FakeText | FakeElement>;
  getAttribute: (name: string) => string | null;
  getRootNode: () => { getElementById: (id: string) => FakeElement | null };
  ownerDocument: { defaultView: { getComputedStyle: () => { getPropertyValue: () => string } } };
}

/** What a fake element is built from */
interface ElementSpec {
  localName?: string;
  type?: string;
  id?: string;
  contentEditable?: boolean;
  attributes?: Record<string, string>;
  labels?: FakeElement[];
  childNodes?: Array<FakeText | FakeElement>;
  byId?: Record<string, FakeElement>;
}

/**
 * A text node.
 *
 * @param data - Its text
 * @returns The node
 */
function text(data: string): FakeText {
  return { nodeType: 3, data };
}

/**
 * An element-like object with what the rule reads.
 *
 * @param spec - Element
 * @returns The element
 */
function element(spec: ElementSpec): FakeElement {
  const attributes = spec.attributes ?? {};
  const byId = spec.byId ?? {};
  return {
    nodeType: 1,
    localName: spec.localName ?? 'input',
    type: spec.type ?? (spec.localName === undefined || spec.localName === 'input' ? 'text' : ''),
    id: spec.id ?? '',
    isContentEditable: spec.contentEditable ?? false,
    labels: spec.labels ?? [],
    childNodes: spec.childNodes ?? [],
    getAttribute: (name) => attributes[name] ?? null,
    getRootNode: () => ({ getElementById: (id) => byId[id] ?? null }),
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ getPropertyValue: () => 'none' }) },
    },
  };
}

/**
 * A label (or any element) holding text, as a `labels` entry or an
 * `aria-labelledby` target.
 *
 * @param nodes - Its child nodes
 * @returns The element
 */
function label(...nodes: Array<FakeText | FakeElement>): FakeElement {
  return element({ localName: 'label', childNodes: nodes });
}

const isSensitive = vm.runInNewContext(`(${SENSITIVE_FIELD_JS})`) as (el: FakeElement) => boolean;

/** Fields and whether the label rule makes them secret */
const CASES: ReadonlyArray<readonly [kind: string, field: FakeElement, secret: boolean]> = [
  ['text with aria-label "Password"', element({ attributes: { 'aria-label': 'Password' } }), true],
  ['text with <label for> "Password"', element({ labels: [label(text('Password'))] }), true],
  [
    'text wrapped in <label>Password …',
    element({ labels: [label(text('Password '), element({}))] }),
    true,
  ],
  [
    'text with aria-labelledby → "Token"',
    element({
      attributes: { 'aria-labelledby': 'tok' },
      byId: { tok: element({ localName: 'span', childNodes: [text('Token')] }) },
    }),
    true,
  ],
  [
    'text with aria-labelledby → "Security code" (two targets)',
    element({
      attributes: { 'aria-labelledby': 'intro csc' },
      byId: {
        intro: element({ localName: 'span', childNodes: [text('Card')] }),
        csc: element({ localName: 'span', childNodes: [text('Security code')] }),
      },
    }),
    true,
  ],
  ['text with placeholder "API key"', element({ attributes: { placeholder: 'API key' } }), true],
  ['text with title "Enter your PIN"', element({ attributes: { title: 'Enter your PIN' } }), true],
  [
    'email input with aria-label "Token"',
    element({ type: 'email', attributes: { 'aria-label': 'Token' } }),
    true,
  ],
  ['number input labelled "PIN"', element({ type: 'number', labels: [label(text('PIN'))] }), true],
  [
    'textarea labelled "Signature"',
    element({ localName: 'textarea', labels: [label(text('Signature'))] }),
    true,
  ],
  [
    'select labelled "Password"',
    element({ localName: 'select', labels: [label(text('Password'))] }),
    true,
  ],
  [
    'contenteditable with aria-label "Password" (its text is not masked anywhere)',
    element({ localName: 'div', contentEditable: true, attributes: { 'aria-label': 'Password' } }),
    false,
  ],
  [
    'checkbox labelled "Show password"',
    element({ type: 'checkbox', labels: [label(text(' Show password'))] }),
    false,
  ],
  [
    'radio labelled "Password"',
    element({ type: 'radio', labels: [label(text('Password'))] }),
    false,
  ],
  [
    'button with aria-label "Password"',
    element({ localName: 'button', type: 'button', attributes: { 'aria-label': 'Password' } }),
    false,
  ],
  [
    'submit input labelled "Show password"',
    element({ type: 'submit', labels: [label(text('Show password'))] }),
    false,
  ],
  [
    'date input labelled "Password"',
    element({ type: 'date', labels: [label(text('Password'))] }),
    false,
  ],
  ['text labelled "Passport"', element({ labels: [label(text('Passport'))] }), false],
  ['text labelled "Email"', element({ labels: [label(text('Email'))] }), false],
  ['text with placeholder "Search"', element({ attributes: { placeholder: 'Search' } }), false],
  [
    'textarea whose own text says password, labelled "Notes"',
    element({
      localName: 'textarea',
      childNodes: [text('my password is hunter2')],
      labels: [label(text('Notes'))],
    }),
    false,
  ],
  [
    'textarea wrapped in <label>Notes …, whose own text says password',
    (() => {
      const area = element({ localName: 'textarea', childNodes: [text('my password is hunter2')] });
      area.labels = [label(text('Notes '), area)];
      return area;
    })(),
    false,
  ],
  [
    'text wrapped in <label>Pick … with a select whose option says Password',
    element({
      labels: [
        label(
          text('Pick '),
          element({
            localName: 'select',
            childNodes: [element({ localName: 'option', childNodes: [text('Password')] })],
          })
        ),
      ],
    }),
    false,
  ],
];

void describe('SENSITIVE_FIELD_JS label rule (#633)', () => {
  for (const [kind, field, secret] of CASES) {
    void it(`${kind}: ${secret ? 'secret' : 'shown'}`, () => {
      assert.equal(isSensitive(field), secret);
    });
  }
});
