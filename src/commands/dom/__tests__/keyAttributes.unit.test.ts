/**
 * Key attributes by element type (#346): what `dom query`, `dom get` and
 * their JSON report about images, links, fields, selects, iframes and forms.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { keyAttributes } from '@/commands/dom/helpers/keyAttributes.js';
import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';

void describe('keyAttributes', () => {
  void it('reads src and alt of an image, href of a link, src of an iframe', () => {
    assert.deepEqual(keyAttributes('img', { src: '/static/a.jpg', alt: 'A', class: 'x' }), {
      src: '/static/a.jpg',
      alt: 'A',
    });
    assert.deepEqual(keyAttributes('a', { href: '/cart', id: 'c' }), { href: '/cart' });
    assert.deepEqual(keyAttributes('iframe', { src: 'https://pay.example/x' }), {
      src: 'https://pay.example/x',
    });
  });

  void it('reads action and method of a form', () => {
    assert.deepEqual(keyAttributes('form', { action: '/post', method: 'post' }), {
      action: '/post',
      method: 'post',
    });
  });

  void it("reads a field's live type and value, masking passwords", () => {
    assert.deepEqual(
      keyAttributes(
        'input',
        { name: 'user', placeholder: 'Username' },
        { type: 'text', value: 'ada' }
      ),
      { type: 'text', name: 'user', placeholder: 'Username', value: 'ada' }
    );
    assert.deepEqual(
      keyAttributes(
        'input',
        { name: 'pw', type: 'password' },
        { type: 'password', value: 'secret' }
      ),
      { type: 'password', name: 'pw', value: MASKED_VALUE }
    );
  });

  void it('leaves out empty values', () => {
    assert.deepEqual(
      keyAttributes('input', { name: 'q', placeholder: '' }, { type: 'search', value: '' }),
      { type: 'search', name: 'q' }
    );
    assert.equal(keyAttributes('img', { alt: '' }), undefined);
  });

  void it('reports checked and the value attribute of checkboxes and radios', () => {
    assert.deepEqual(
      keyAttributes('input', { name: 'size' }, { type: 'radio', checked: true, value: 'medium' }),
      { type: 'radio', name: 'size', value: 'medium', checked: true }
    );
    assert.deepEqual(keyAttributes('input', {}, { type: 'checkbox', checked: false, value: '' }), {
      type: 'checkbox',
      checked: false,
    });
  });

  void it("reads a button's type and a select's selected options", () => {
    assert.deepEqual(keyAttributes('button', {}, { type: 'submit' }), { type: 'submit' });
    assert.deepEqual(
      keyAttributes('select', { name: 'sort' }, { selected: 'Price (low to high)' }),
      {
        name: 'sort',
        selected: 'Price (low to high)',
      }
    );
  });

  void it('has nothing for other elements', () => {
    assert.equal(keyAttributes('div', { id: 'x', title: 'y' }), undefined);
  });
});

void describe('keyAttributes secrets', () => {
  void it("never reports a hidden input's value", () => {
    assert.deepEqual(
      keyAttributes('input', { name: 'csrf', value: 'token' }, { type: 'hidden', value: 'token' }),
      { type: 'hidden', name: 'csrf' }
    );
  });

  void it('masks the value and selected option of a field the page marked sensitive', () => {
    assert.deepEqual(
      keyAttributes('input', { name: 'card' }, { type: 'text', value: '4111', sensitive: true }),
      { type: 'text', name: 'card', value: MASKED_VALUE }
    );
    assert.deepEqual(keyAttributes('select', {}, { selected: '12', sensitive: true }), {
      selected: MASKED_VALUE,
    });
  });

  void it('shows a shadow part name, on any element', () => {
    assert.deepEqual(keyAttributes('div', { part: 'base' }), { part: 'base' });
    assert.deepEqual(keyAttributes('input', { part: 'input', name: 'q' }), {
      part: 'input',
      name: 'q',
    });
  });
});
