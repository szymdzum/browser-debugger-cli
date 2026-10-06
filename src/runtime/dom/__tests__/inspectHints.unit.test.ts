/**
 * "This declaration has no effect" hints of `dom inspect`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InspectHint } from '@/ipc/protocol/inspectTypes.js';
import type { Declaration, Resolution } from '@/runtime/dom/inspectCascade.js';
import {
  explainUnsetVariables,
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

  void it('names the vertical margins of an inline element that do nothing', () => {
    const margin = { via: 'margin', written: '8px 12px' };
    const hints = inactiveHints(
      cascade({
        'margin-top': { value: '8px', ...margin },
        'margin-right': { value: '12px', ...margin },
        'margin-bottom': { value: '8px', ...margin },
        'margin-left': { value: '12px', ...margin },
      }),
      ctx({ display: 'inline' })
    );
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.property, 'margin');
    assert.deepEqual(hints[0]?.only, ['margin-top', 'margin-bottom']);
  });

  void it('leaves out declarations that restate a default (resets)', () => {
    assert.equal(
      inactiveHints(
        cascade({ 'vertical-align': 'baseline', 'margin-top': '0' }),
        ctx({ display: 'inline' })
      ).length,
      0
    );
    assert.equal(
      inactiveHints(cascade({ 'vertical-align': 'baseline' }), ctx({ display: 'block' })).length,
      0
    );
    assert.equal(
      inactiveHints(cascade({ 'flex-grow': '0', order: '0' }), ctx({ display: 'block' })).length,
      0
    );
  });

  void it('knows audio, inline tables and vertical writing modes', () => {
    assert.equal(
      inactiveHints(cascade({ width: '300px' }), ctx({ display: 'inline' }, undefined, true))
        .length,
      0
    );
    assert.equal(
      inactiveHints(cascade({ 'vertical-align': 'top' }), ctx({ display: 'inline-table' })).length,
      0
    );
    assert.equal(
      inactiveHints(
        cascade({ 'margin-top': '5px' }),
        ctx({ display: 'inline', 'writing-mode': 'vertical-rl' })
      ).length,
      0
    );
  });

  void it('says when a flex item blockified a declared inline display', () => {
    const [hint] = inactiveHints(cascade({ 'vertical-align': 'middle' }), {
      ...ctx({ display: 'flex' }, { display: 'flex' }),
      declaredDisplay: 'inline-flex',
    });
    assert.equal(hint?.reason, 'display is flex (inline-flex blockified: a flex item)');
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

void describe('where an unset custom property is set', () => {
  const hint: InspectHint = {
    kind: 'unset-variable',
    property: 'background-color',
    value: 'var(--bg)',
    reason: '--bg is not set',
    fix: 'define --bg or give var() a fallback (did you mean --bg2? it is set)',
    variables: ['--bg'],
    source: '.btn',
  };

  void it('says a variable set in another state is expected, without a typo suggestion', () => {
    const [explained] = explainUnsetVariables([hint], {
      '--bg': { selector: '.btn:hover', value: '#eee', matches: false },
    });
    assert.equal(explained?.reason, '--bg is set only by .btn:hover, which does not match now');
    assert.doesNotMatch(explained?.fix ?? '', /did you mean/);
  });

  void it('names keyframes and inherit values', () => {
    const [frames] = explainUnsetVariables([hint], {
      '--bg': { selector: '@keyframes pulse', value: '1', keyframes: 'pulse', matches: false },
    });
    assert.match(frames?.reason ?? '', /only in @keyframes pulse/);
    const [inherit] = explainUnsetVariables([hint], {
      '--bg': { selector: ':root', value: 'inherit', matches: true },
    });
    assert.match(inherit?.reason ?? '', /set to inherit by :root, and nothing above/);
  });

  void it('says when the rule is under a condition that does not apply, and keeps other typos', () => {
    const [media] = explainUnsetVariables([hint], {
      '--bg': {
        selector: ':root',
        value: '1',
        matches: false,
        condition: '@media (min-width: 99999px)',
      },
    });
    assert.match(
      media?.reason ?? '',
      /under @media \(min-width: 99999px\), which does not apply now/
    );
    const [both] = explainUnsetVariables([{ ...hint, variables: ['--bg', '--typo'] }], {
      '--bg': { selector: '.btn:hover', value: '#eee', matches: false },
    });
    assert.match(both?.reason ?? '', /^--bg is not set; --bg is set only by \.btn:hover/);
    assert.match(both?.fix ?? '', /did you mean/);
  });

  void it('keeps the hint when the page sets the variable nowhere', () => {
    assert.deepEqual(explainUnsetVariables([hint], {}), [hint]);
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
    assert.match(hints[0]?.fix ?? '', /did you mean --brand\? it is set/);
  });
});
