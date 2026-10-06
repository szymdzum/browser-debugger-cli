/**
 * "This declaration has no effect" hints of `dom inspect`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Declaration, Resolution } from '@/runtime/dom/inspectCascade.js';
import {
  formControlFontHints,
  inactiveHints,
  undefinedVariableHints,
} from '@/runtime/dom/inspectHints.js';
import { substituteVariables, unsetVariables } from '@/runtime/dom/inspectVariables.js';

/**
 * A cascade where each property is set by one rule.
 *
 * @param declarations - Property → value (or a full declaration)
 * @returns Cascade map
 */
function cascade(
  declarations: Record<string, string | Partial<Declaration>>
): Map<string, Resolution> {
  return new Map(
    Object.entries(declarations).map(([property, entry]) => {
      const extra = typeof entry === 'string' ? { value: entry } : entry;
      const winner: Declaration = {
        property,
        value: '',
        important: false,
        source: { kind: 'rule', selector: '.x', origin: 'regular' },
        ...extra,
      };
      return [property, { winner, overridden: [] }];
    })
  );
}

const ctx = (
  style: Record<string, string>,
  parentStyle: Record<string, string> = { display: 'block' },
  replaced = false
): { style: Record<string, string>; parentStyle: Record<string, string>; replaced: boolean } => ({
  style,
  parentStyle,
  replaced,
});

void describe('inactive CSS hints', () => {
  void it('flags flex alignment on a block element, with a fix', () => {
    const hints = inactiveHints(
      cascade({ 'justify-content': 'center' }),
      ctx({ display: 'block' })
    );
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.reason, 'display is block');
    assert.match(hints[0]?.fix ?? '', /display: flex or grid/);
  });

  void it('does not flag it on a flex container', () => {
    assert.equal(
      inactiveHints(cascade({ 'justify-content': 'center' }), ctx({ display: 'flex' })).length,
      0
    );
  });

  void it('flags item properties when the parent is not flex or grid', () => {
    const hints = inactiveHints(
      cascade({ 'flex-grow': '1' }),
      ctx({ display: 'block' }, { display: 'block' })
    );
    assert.match(hints[0]?.reason ?? '', /parent's display is block/);
    assert.equal(
      inactiveHints(cascade({ 'flex-grow': '1' }), ctx({ display: 'block' }, { display: 'flex' }))
        .length,
      0
    );
  });

  void it('flags offsets on a static element and sizes on an inline one, but not on replaced elements', () => {
    assert.equal(
      inactiveHints(cascade({ top: '10px' }), ctx({ display: 'block', position: 'static' }))[0]
        ?.reason,
      'position is static'
    );
    assert.equal(
      inactiveHints(cascade({ width: '100px' }), ctx({ display: 'inline' }))[0]?.reason,
      'display is inline'
    );
    assert.equal(
      inactiveHints(cascade({ width: '100px' }), ctx({ display: 'inline' }, {}, true)).length,
      0
    );
  });

  void it('names the shorthand as written once, and ignores the browser and ancestors', () => {
    const hints = inactiveHints(
      cascade({
        'row-gap': { value: '16px', via: 'gap' },
        'column-gap': { value: '16px', via: 'gap' },
      }),
      ctx({ display: 'block' })
    );
    assert.deepEqual(
      hints.map((h) => h.property),
      ['gap']
    );
    const ua = cascade({
      'justify-content': { value: 'center', source: { kind: 'rule', origin: 'user-agent' } },
    });
    assert.equal(inactiveHints(ua, ctx({ display: 'block' })).length, 0);
    const inherited = cascade({ 'justify-content': { value: 'center', ancestor: 1 } });
    assert.equal(inactiveHints(inherited, ctx({ display: 'block' })).length, 0);
  });

  void it('does not flag a shorthand that still sets something', () => {
    const margin = { via: 'margin', written: '0 4px' };
    const inlineMargins = cascade({
      'margin-top': { value: '0', ...margin },
      'margin-right': { value: '4px', ...margin },
      'margin-bottom': { value: '0', ...margin },
      'margin-left': { value: '4px', ...margin },
    });
    assert.equal(inactiveHints(inlineMargins, ctx({ display: 'inline' })).length, 0);

    const gap = cascade({
      'row-gap': { value: '2rem', via: 'gap' },
      'column-gap': { value: '2rem', via: 'gap' },
    });
    assert.equal(inactiveHints(gap, ctx({ display: 'block', 'column-count': '3' })).length, 0);
  });

  void it('flags align-content on a single-line flex container', () => {
    const hints = inactiveHints(
      cascade({ 'align-content': 'center' }),
      ctx({ display: 'flex', 'flex-wrap': 'nowrap' })
    );
    assert.match(hints[0]?.fix ?? '', /flex-wrap: wrap/);
  });
});

void describe('form control fonts', () => {
  void it('flags a control drawn in the browser font while its parent uses another', () => {
    const uaFont = cascade({
      'font-family': { value: 'system-ui', source: { kind: 'rule', origin: 'user-agent' } },
    });
    const control = {
      style: { display: 'inline-block', 'font-family': 'Arial' },
      parentStyle: { display: 'block', 'font-family': 'Inter, sans-serif' },
      replaced: true,
      formControl: true,
    };
    assert.match(formControlFontHints(uaFont, control)[0]?.fix ?? '', /font: inherit/);
    const authored = cascade({ 'font-family': 'inherit' });
    assert.equal(formControlFontHints(authored, control).length, 0);
  });
});

void describe('undefined custom properties', () => {
  void it('flags var() of a custom property that is not set', () => {
    const hints = undefinedVariableHints(cascade({ color: 'var(--brand)' }), { '--other': '1' });
    assert.equal(hints[0]?.reason, '--brand is not set');
    assert.equal(
      undefinedVariableHints(cascade({ color: 'var(--brand)' }), { '--brand': 'red' }).length,
      0
    );
  });

  void it('checks a fallback only when it is used', () => {
    assert.deepEqual(unsetVariables('var(--a, var(--b))', { '--a': '1' }), []);
    assert.deepEqual(unsetVariables('var(--a, var(--b))', {}), ['--b']);
    assert.deepEqual(unsetVariables('var(--a, red)', {}), []);
    assert.deepEqual(unsetVariables('calc(var(--x) * 2) var(--y)', { '--y': '1' }), ['--x']);
  });

  void it('substitutes custom properties, fallbacks when unset', () => {
    assert.equal(
      substituteVariables('var(--y) var(--x, 4px)', { '--y': ' .375rem' }),
      '.375rem 4px'
    );
    assert.equal(substituteVariables('var(--nope)', {}), 'var(--nope)');
  });

  void it('names a similar custom property that is set', () => {
    const hints = undefinedVariableHints(cascade({ background: 'var(--brand-accent)' }), {
      '--brand': '#5b3df5',
    });
    assert.match(hints[0]?.fix ?? '', /set here: --brand/);
  });
});
