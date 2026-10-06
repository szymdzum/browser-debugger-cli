/**
 * The CSS cascade of `dom inspect`, on hand-made `CSS.getMatchedStylesForNode`
 * responses: order, `!important`, layers, the style attribute, shorthands,
 * logical properties and inheritance.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from 'devtools-protocol';

import { physicalName, resolveCascade, ruleField } from '@/runtime/dom/inspectCascade.js';

const RANGE = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 };

/**
 * A CDP property as written in a stylesheet.
 *
 * @param name - Property
 * @param value - Value
 * @param extra - More fields (important, longhands, disabled)
 * @returns CDP property
 */
function prop(
  name: string,
  value: string,
  extra: Partial<Protocol.CSS.CSSProperty> = {}
): Protocol.CSS.CSSProperty {
  return { name, value, range: RANGE, ...extra };
}

/**
 * A matched rule.
 *
 * @param selector - Selector
 * @param properties - Its properties
 * @param extra - Origin, layers, media
 * @returns CDP rule match
 */
function rule(
  selector: string,
  properties: Protocol.CSS.CSSProperty[],
  extra: Partial<Protocol.CSS.CSSRule> = {}
): Protocol.CSS.RuleMatch {
  return {
    rule: {
      styleSheetId: 'sheet-1',
      selectorList: { selectors: [{ text: selector }], text: selector },
      origin: 'regular',
      style: { cssProperties: properties, shorthandEntries: [] },
      ...extra,
    },
    matchingSelectors: [0],
  };
}

/**
 * A matched-styles response.
 *
 * @param rules - Matched rules, ascending
 * @param extra - Inline style, inherited entries
 * @returns Response
 */
function matched(
  rules: Protocol.CSS.RuleMatch[],
  extra: Partial<Protocol.CSS.GetMatchedStylesForNodeResponse> = {}
): Protocol.CSS.GetMatchedStylesForNodeResponse {
  return { matchedCSSRules: rules, ...extra };
}

void describe('cascade', () => {
  void it('lets the later rule win and lists what it overrides', () => {
    const result = resolveCascade(
      matched([
        rule('.btn', [prop('background-color', 'blue')]),
        rule('.btn-primary', [prop('background-color', 'red')]),
      ]),
      ['background-color']
    ).get('background-color');
    assert.equal(result?.winner?.source.selector, '.btn-primary');
    assert.equal(result?.winner?.value, 'red');
    assert.deepEqual(
      result?.overridden.map((d) => d.source.selector),
      ['.btn']
    );
  });

  void it('lets !important beat a later normal declaration, and the style attribute beat rules', () => {
    const important = resolveCascade(
      matched([
        rule('.a', [prop('color', 'green', { important: true })]),
        rule('.b', [prop('color', 'red')]),
      ]),
      ['color']
    ).get('color');
    assert.equal(important?.winner?.source.selector, '.a');

    const inline = resolveCascade(
      matched([rule('.b', [prop('color', 'red')])], {
        inlineStyle: { cssProperties: [prop('color', 'blue')], shorthandEntries: [] },
      }),
      ['color']
    ).get('color');
    assert.equal(inline?.winner?.source.kind, 'inline');
  });

  void it('orders layers: unlayered beats layered normally, earlier layers win among important', () => {
    const base = { layers: [{ text: 'base' }] };
    const utilities = { layers: [{ text: 'utilities' }] };
    const normal = resolveCascade(
      matched([
        rule('.l1', [prop('color', 'a')], base),
        rule('.l2', [prop('color', 'b')], utilities),
        rule('.plain', [prop('color', 'c')]),
      ]),
      ['color']
    ).get('color');
    assert.equal(normal?.winner?.source.selector, '.plain');

    const important = resolveCascade(
      matched([
        rule('.l1', [prop('color', 'a', { important: true })], base),
        rule('.l2', [prop('color', 'b', { important: true })], utilities),
        rule('.plain', [prop('color', 'c', { important: true })]),
      ]),
      ['color']
    ).get('color');
    assert.equal(important?.winner?.source.selector, '.l1');
  });

  void it('lets layered author rules beat the browser stylesheet, which wins among important', () => {
    const ua = { origin: 'user-agent' as const };
    const normal = resolveCascade(
      matched([
        rule('h1', [prop('font-size', '2em')], ua),
        rule('.text-4xl', [prop('font-size', '2.25rem')], { layers: [{ text: 'utilities' }] }),
      ]),
      ['font-size']
    ).get('font-size');
    assert.equal(normal?.winner?.source.selector, '.text-4xl');

    const important = resolveCascade(
      matched([
        rule('input', [prop('color', 'black', { important: true })], ua),
        rule('.x', [prop('color', 'red', { important: true })]),
      ]),
      ['color']
    ).get('color');
    assert.equal(important?.winner?.source.selector, 'input');
  });

  void it('puts presentational attributes below every layer', () => {
    const result = resolveCascade(
      matched([rule('.w', [prop('width', '10px')], { layers: [{ text: 'base' }] })], {
        attributesStyle: { cssProperties: [prop('width', '300px')], shorthandEntries: [] },
      }),
      ['width']
    ).get('width');
    assert.equal(result?.winner?.source.selector, '.w');
  });

  void it('expands shorthands, also with var() that Chrome leaves unexpanded', () => {
    const viaChrome = resolveCascade(
      matched([
        rule('.box', [
          prop('padding', '12px 24px', {
            longhandProperties: [
              { name: 'padding-top', value: '12px' },
              { name: 'padding-right', value: '24px' },
              { name: 'padding-bottom', value: '12px' },
              { name: 'padding-left', value: '24px' },
            ],
          }),
        ]),
      ]),
      ['padding-left']
    ).get('padding-left');
    assert.equal(viaChrome?.winner?.value, '24px');
    assert.equal(viaChrome?.winner?.via, 'padding');

    const withVar = resolveCascade(matched([rule('.box', [prop('margin', 'var(--gap)')])]), [
      'margin-top',
    ]).get('margin-top');
    assert.equal(withVar?.winner?.value, 'var(--gap)');

    const logicalVar = resolveCascade(
      matched([
        rule('.a', [prop('margin-left', '4px')]),
        rule('.b', [prop('margin-inline', 'var(--x)')]),
      ]),
      ['margin-left']
    ).get('margin-left');
    assert.equal(logicalVar?.winner?.source.selector, '.b');
  });

  void it('maps logical properties to physical ones', () => {
    assert.equal(physicalName('margin-inline-start'), 'margin-left');
    assert.equal(physicalName('padding-block-end'), 'padding-bottom');
    assert.equal(physicalName('border-inline-end-width'), 'border-right-width');
    assert.equal(physicalName('inline-size'), 'width');
    const result = resolveCascade(matched([rule('.x', [prop('padding-inline-start', '8px')])]), [
      'padding-left',
    ]).get('padding-left');
    assert.equal(result?.winner?.via, 'padding-inline-start');
  });

  void it('skips disabled and invalid declarations and unranged duplicates', () => {
    const result = resolveCascade(
      matched([
        rule('.a', [
          prop('color', 'red'),
          prop('color', 'blue', { disabled: true }),
          prop('color', 'banana', { parsedOk: false }),
          { name: 'color', value: 'green' },
        ]),
      ]),
      ['color']
    ).get('color');
    assert.equal(result?.winner?.value, 'red');
    assert.equal(result?.overridden.length, 0);
  });

  void it('inherits only inherited properties, from the nearest ancestor that sets them', () => {
    const response = matched([], {
      inherited: [
        { matchedCSSRules: [] },
        { matchedCSSRules: [rule('body', [prop('color', '#111'), prop('padding-top', '8px')])] },
      ],
    });
    const resolved = resolveCascade(response, ['color', 'padding-top']);
    assert.equal(resolved.get('color')?.winner?.ancestor, 2);
    assert.equal(resolved.get('color')?.overridden.length, 0);
    assert.equal(resolved.get('padding-top')?.winner, undefined);
  });

  void it('keeps the media condition and layer of the winning rule', () => {
    const result = resolveCascade(
      matched([
        rule('.xl\\:text-8xl', [prop('font-size', '6rem')], {
          media: [{ text: '(min-width: 80rem)', source: 'mediaRule' }],
          layers: [{ text: 'utilities' }],
        }),
      ]),
      ['font-size']
    ).get('font-size');
    assert.equal(result?.winner?.source.condition, '(min-width: 80rem)');
    assert.equal(result?.winner?.source.layer, 'utilities');
  });

  void it('keeps the specificity and shortens not-all media conditions', () => {
    const match = rule('.card .btn', [prop('color', 'red')], {
      media: [{ text: 'not all and (min-width: 64rem)', source: 'mediaRule' }],
    });
    const selector = match.rule.selectorList.selectors[0];
    if (selector) selector.specificity = { a: 0, b: 2, c: 0 };
    const result = resolveCascade(matched([match]), ['color']).get('color');
    assert.deepEqual(result?.winner?.source.specificity, [0, 2, 0]);
    assert.equal(result?.winner?.source.condition, 'not (min-width: 64rem)');
  });

  void it('keeps the rule as written, cutting a long one to the declaration', () => {
    const short = rule('.tag', [prop('color', 'red')]);
    short.rule.style.cssText = 'color: red;';
    const shortWinner = resolveCascade(matched([short]), ['color']).get('color')?.winner;
    assert.deepEqual(shortWinner && ruleField(shortWinner), { rule: '.tag { color: red; }' });

    const long = rule('.btn', [prop('background-color', 'var(--bg)')]);
    long.rule.style.cssText = `${'--x:1;'.repeat(80)}background-color:var(--bg);display:block`;
    const longWinner = resolveCascade(matched([long]), ['background-color']).get(
      'background-color'
    )?.winner;
    assert.deepEqual(longWinner && ruleField(longWinner), {
      rule: '.btn { … background-color:var(--bg); … }',
    });
  });

  void it('cuts a long rule to the last declaration, keeping semicolons inside values', () => {
    const excerpt = (cssText: string, name: string): string | undefined => {
      const match = rule('.x', [prop(name, 'v')]);
      match.rule.style.cssText = `${'--pad:1;'.repeat(60)}${cssText}`;
      const winner = resolveCascade(matched([match]), [name]).get(name)?.winner;
      return winner ? ruleField(winner).rule : undefined;
    };
    assert.equal(
      excerpt('display:-webkit-box;display:flex', 'display'),
      '.x { … display:flex; … }'
    );
    assert.equal(
      excerpt('background-image:url(data:image/png;base64,AAAA);color:red', 'background-image'),
      '.x { … background-image:url(data:image/png;base64,AAAA); … }'
    );
    assert.equal(excerpt('--Brand:red;--brand:blue', '--Brand'), '.x { … --Brand:red; … }');
  });

  void it('leaves out the rules of the browser and of extensions', () => {
    for (const origin of ['user-agent', 'injected'] as const) {
      const match = rule('p', [prop('color', 'red')], { origin });
      match.rule.style.cssText = 'color: red;';
      const winner = resolveCascade(matched([match]), ['color']).get('color')?.winner;
      assert.deepEqual(winner && ruleField(winner), {});
    }
  });

  void it('names nested layers outermost first, as CDP lists them', () => {
    const result = resolveCascade(
      matched([rule('.x', [prop('color', 'red')], { layers: [{ text: 'a' }, { text: 'b' }] })]),
      ['color']
    ).get('color');
    assert.equal(result?.winner?.source.layer, 'a.b');
  });
});
