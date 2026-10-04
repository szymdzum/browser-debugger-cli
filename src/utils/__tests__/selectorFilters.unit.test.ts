/**
 * Splitting selectors into CSS and Playwright-style filters
 * (`:has-text()`, `:text-is()`, `:visible`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError } from '@/errors/index.js';
import { invalidSelectorError } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parseSelectorFilters, splitSelectorList } from '@/utils/selectorFilters.js';

/**
 * Assert that parsing fails with exit 81 and a message matching `pattern`.
 *
 * @param selector - Selector to parse
 * @param pattern - Expected message
 */
function assertRejected(selector: string, pattern: RegExp): void {
  assert.throws(
    () => parseSelectorFilters(selector),
    (error: unknown) =>
      error instanceof CommandError &&
      error.exitCode === EXIT_CODES.INVALID_ARGUMENTS &&
      pattern.test(error.message),
    selector
  );
}

void describe('splitSelectorList', () => {
  void it('splits at top-level commas', () => {
    assert.deepEqual(splitSelectorList('a, b,c'), ['a', ' b', 'c']);
  });

  void it('keeps commas inside parentheses, attribute brackets and quotes', () => {
    assert.deepEqual(splitSelectorList(':is(a, b), [title="x,y"], [data-a=\'1,2\'] , c'), [
      ':is(a, b)',
      ' [title="x,y"]',
      " [data-a='1,2'] ",
      ' c',
    ]);
  });

  void it('keeps commas inside filter texts and escaped quotes', () => {
    assert.deepEqual(splitSelectorList('a:has-text("x, \\"y, z"), b:has-text(c, d)'), [
      'a:has-text("x, \\"y, z")',
      ' b:has-text(c, d)',
    ]);
  });

  void it('treats an escaped comma as part of the selector', () => {
    assert.deepEqual(splitSelectorList('.a\\,b, c'), ['.a\\,b', ' c']);
  });
});

void describe('parseSelectorFilters', () => {
  void it('returns null for plain CSS, which runs unchanged', () => {
    for (const selector of [
      'button.primary',
      'a, b',
      'li:hover > a:visited',
      'div:has(> button)',
      '[title=":visible"]',
      '[data-x=\':has-text("x")\']',
      '.md\\:visible',
      'input:not(:visited)',
    ]) {
      assert.equal(parseSelectorFilters(selector), null, selector);
    }
  });

  void it('strips trailing filters off the CSS', () => {
    assert.deepEqual(parseSelectorFilters('button:has-text("Save")'), [
      { css: 'button', filters: [{ kind: 'has-text', text: 'save' }] },
    ]);
    assert.deepEqual(parseSelectorFilters('li:visible'), [
      { css: 'li', filters: [{ kind: 'visible' }] },
    ]);
    assert.deepEqual(parseSelectorFilters('a:text-is("Home")'), [
      { css: 'a', filters: [{ kind: 'text-is', text: 'Home' }] },
    ]);
  });

  void it('combines repeated filters', () => {
    assert.deepEqual(parseSelectorFilters('.item:has-text(\'x\'):visible:text-is("X y")'), [
      {
        css: '.item',
        filters: [
          { kind: 'has-text', text: 'x' },
          { kind: 'visible' },
          { kind: 'text-is', text: 'X y' },
        ],
      },
    ]);
  });

  void it('parses each selector of a list', () => {
    assert.deepEqual(parseSelectorFilters('a:has-text("x"), button:visible, p'), [
      { css: 'a', filters: [{ kind: 'has-text', text: 'x' }] },
      { css: 'button', filters: [{ kind: 'visible' }] },
      { css: 'p', filters: [] },
    ]);
  });

  void it('keeps the CSS before the last compound (combinators, :has, :not, attributes)', () => {
    assert.deepEqual(
      parseSelectorFilters('form > div:has(> input[name="a,b"]) button:not(.x):has-text("Go")'),
      [
        {
          css: 'form > div:has(> input[name="a,b"]) button:not(.x)',
          filters: [{ kind: 'has-text', text: 'go' }],
        },
      ]
    );
  });

  void it('uses * for filters without an element selector', () => {
    assert.deepEqual(parseSelectorFilters(':visible'), [
      { css: '*', filters: [{ kind: 'visible' }] },
    ]);
    assert.deepEqual(parseSelectorFilters('nav :has-text("x"), ul > :visible'), [
      { css: 'nav *', filters: [{ kind: 'has-text', text: 'x' }] },
      { css: 'ul > *', filters: [{ kind: 'visible' }] },
    ]);
  });

  void it('reads quoted, escaped and unquoted texts', () => {
    const texts = (selector: string): string[] =>
      (parseSelectorFilters(selector) ?? []).flatMap((part) =>
        part.filters.map((filter) => ('text' in filter ? filter.text : filter.kind))
      );
    assert.deepEqual(texts('a:text-is("say \\"hi\\"")'), ['say "hi"']);
    assert.deepEqual(texts("a:text-is('it\\'s')"), ["it's"]);
    assert.deepEqual(texts('a:text-is( "x" )'), ['x']);
    assert.deepEqual(texts('a:text-is("a ) b")'), ['a ) b']);
    assert.deepEqual(texts('a:text-is("  Two\n  words ")'), ['Two words']);
    assert.deepEqual(texts('a:has-text(Sign In)'), ['sign in']);
    assert.deepEqual(texts('a:text-is(f(x))'), ['f(x)']);
    assert.deepEqual(texts('a:HAS-TEXT("X"):Visible'), ['x', 'visible']);
  });

  void it('rejects filters that are not at the end', () => {
    assertRejected('div:has-text("x") > button', /:has-text\("x"\) must come last/);
    assertRejected('li:visible a', /:visible must come last/);
    assertRejected('a:visible.active', /:visible must come last/);
    assertRejected('a:visible[href]', /:visible must come last/);
    assertRejected(':not(:visible)', /:visible must come last/);
    assertRejected('div:has(:text-is("x"))', /:text-is\("x"\) must come last/);
    assertRejected('a, div:has-text("x") p', /:has-text\("x"\) must come last/);
    assertRejected('li:visible :has-text("x")', /:visible must come last/);
  });

  void it('rejects text filters without their text', () => {
    assertRejected('a:has-text', /:has-text needs its text/);
    assertRejected('a:has-text("x"', /:has-text needs its text/);
    assertRejected('a:text-is("x', /:text-is needs its text/);
    assertRejected('a:text-is("x" y)', /:text-is needs its text/);
    assertRejected('a:has-text(x', /:has-text needs its text/);
  });
});

void describe('invalidSelectorError', () => {
  void it('points Playwright-only syntax to the supported filters and a11y query', () => {
    for (const selector of ['button:text("Save")', 'text=Save', 'div >> button', 'a:near(.b)']) {
      const { suggestion } = invalidSelectorError(selector);
      assert.match(suggestion, /:has-text\("…"\), :text-is\("…"\) and :visible/, selector);
      assert.match(suggestion, /bdg dom a11y query name=/, selector);
    }
  });

  void it('keeps the plain syntax hint for other invalid selectors', () => {
    assert.match(invalidSelectorError('a[').suggestion, /Check the selector syntax/);
  });
});
