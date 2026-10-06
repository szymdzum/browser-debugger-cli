/**
 * `dom inspect`'s `--rules` rows and `--why` chain from hand-made
 * `CSS.getMatchedStylesForNode` responses.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from 'devtools-protocol';

import { buildCascadeFields } from '@/runtime/dom/inspectCascadeModel.js';

const RANGE = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 };

/**
 * A matched author rule.
 *
 * @param selector - Selector
 * @param properties - Name, value and Chrome's longhands of each property
 * @returns CDP rule match
 */
function rule(
  selector: string,
  properties: Array<[string, string, Record<string, string>?]>
): Protocol.CSS.RuleMatch {
  const cssProperties = properties.map(([name, value, longhands]) => ({
    name,
    value,
    range: RANGE,
    ...(longhands && {
      longhandProperties: Object.entries(longhands).map(([n, v]) => ({ name: n, value: v })),
    }),
  }));
  return {
    rule: {
      styleSheetId: 'sheet-1',
      selectorList: { selectors: [{ text: selector }], text: selector },
      origin: 'regular',
      style: { cssProperties, shorthandEntries: [] },
    },
    matchingSelectors: [0],
  };
}

/**
 * Cascade fields with `--rules` (and `--why` when given).
 *
 * @param rules - Matched rules, ascending
 * @param style - Computed style
 * @param why - Property for `--why`
 * @returns Fields
 */
function fields(
  rules: Protocol.CSS.RuleMatch[],
  style: Record<string, string>,
  why?: string
): ReturnType<typeof buildCascadeFields> {
  return buildCascadeFields({
    matched: { matchedCSSRules: rules },
    style: { display: 'block', ...style },
    parentStyle: { display: 'block' },
    replaced: false,
    label: (d) => d.source.selector ?? d.source.kind,
    rules: true,
    ...(why && { why }),
  });
}

void describe('cascade fields', () => {
  void it('shows a shorthand once, as written', () => {
    const padding = rule('.tag', [
      [
        'padding',
        '4px 8px',
        {
          'padding-top': '4px',
          'padding-right': '8px',
          'padding-bottom': '4px',
          'padding-left': '8px',
        },
      ],
    ]);
    const rows = fields([padding], {}).rules ?? [];
    assert.deepEqual(
      rows.map((r) => `${r.property} ${r.value}`),
      ['padding 4px 8px']
    );
  });

  void it('folds the sides a wider shorthand sets into one row', () => {
    const sides = ['top', 'right', 'bottom', 'left'];
    const longhands = Object.fromEntries(
      sides.flatMap((side) => [
        [`border-${side}-width`, '0px'],
        [`border-${side}-style`, 'solid'],
      ])
    );
    const rows = fields([rule('*', [['border', '0 solid', longhands]])], {}).rules ?? [];
    assert.deepEqual(
      rows.map((r) => `${r.property} ${r.value}`),
      ['border-width 0px', 'border-style solid']
    );
  });

  void it('adds the computed value to var() declarations, and explains --why', () => {
    const result = fields(
      [rule('.btn', [['color', 'red']]), rule('.btn-primary', [['color', 'var(--brand)']])],
      { color: 'rgb(0, 102, 204)', '--brand': '#06c' },
      'color'
    );
    const color = result.rules?.find((r) => r.property === 'color');
    assert.equal(color?.computed, '#06c');
    assert.deepEqual(color?.overrides, ['.btn']);
    const [why] = result.why ?? [];
    assert.equal(why?.computed, '#06c');
    assert.deepEqual(
      why?.chain.map((e) => `${e.status} ${e.value} ${e.resolved ?? ''}`),
      ['applied var(--brand) #06c', 'overridden red ']
    );
  });

  void it("takes a var() shorthand as written, not Chrome's initial values", () => {
    const sides = ['top', 'right', 'bottom', 'left'];
    const longhands = Object.fromEntries(
      sides.flatMap((side) => [
        [`border-${side}-width`, '2px'],
        [`border-${side}-style`, 'solid'],
        [`border-${side}-color`, 'currentcolor'],
      ])
    );
    const result = fields(
      [rule('.search', [['border', '2px solid var(--line)', longhands]])],
      { 'border-top-color': 'rgb(81, 86, 93)', '--line': '#51565d' },
      'border-top-color'
    );
    assert.deepEqual(
      result.rules?.map((r) => `${r.property} ${r.value}`),
      ['border 2px solid var(--line)']
    );
    const [why] = result.why ?? [];
    assert.equal(why?.chain[0]?.value, '2px solid var(--line)');
    assert.equal(why?.chain[0]?.via, 'border');
    assert.equal(why?.chain[0]?.resolved, '2px solid #51565d');
  });

  void it('answers --why for a shorthand once when one declaration sets it, and names where its variables are set', () => {
    const padding = rule('.btn', [
      ['--py', '.375rem'],
      ['padding', 'var(--py) 12px'],
    ]);
    const result = fields(
      [padding],
      {
        '--py': '.375rem',
        'padding-top': '6px',
        'padding-right': '12px',
        'padding-bottom': '6px',
        'padding-left': '12px',
      },
      'padding'
    );
    assert.equal(result.why?.length, 1);
    const [why] = result.why ?? [];
    assert.equal(why?.property, 'padding');
    assert.equal(why?.computed, '6 12 6 12');
    assert.deepEqual(why?.variables, [{ name: '--py', value: '.375rem', source: '.btn' }]);
  });

  void it('marks a var() of an unset custom property invalid in --why, and follows variables set from others', () => {
    const result = fields(
      [
        rule('.badge', [
          ['--size', 'var(--base)'],
          ['--base', '12px'],
          ['background-color', 'var(--accent)'],
          ['font-size', 'var(--size)'],
        ]),
      ],
      { '--size': '12px', '--base': '12px' },
      'background-color'
    );
    assert.deepEqual(result.why?.[0]?.chain[0]?.unset, ['--accent']);
    const font = fields(
      [
        rule('.badge', [
          ['--size', 'var(--base)'],
          ['--base', '12px'],
          ['font-size', 'var(--size)'],
        ]),
      ],
      { '--size': '12px', '--base': '12px', 'font-size': '12px' },
      'font-size'
    );
    assert.deepEqual(
      font.why?.[0]?.variables?.map((v) => `${v.name}: ${v.value}`),
      ['--size: var(--base)', '--base: 12px']
    );
  });

  void it('limits --rules to the --props names', () => {
    const result = buildCascadeFields({
      matched: {
        matchedCSSRules: [
          rule('.a', [
            ['color', 'red'],
            ['width', '10px'],
          ]),
        ],
      },
      style: { display: 'block' },
      parentStyle: { display: 'block' },
      replaced: false,
      label: (d) => d.source.selector ?? d.source.kind,
      rules: true,
      props: ['width'],
    });
    assert.deepEqual(
      result.rules?.map((r) => r.property),
      ['width']
    );
  });

  void it('hints at var() of an unset custom property on any property', () => {
    const hints = fields([rule('#themed', [['color', 'var(--brand-color)']])], {}).hints ?? [];
    assert.equal(hints[0]?.reason, '--brand-color is not set');
  });
});
