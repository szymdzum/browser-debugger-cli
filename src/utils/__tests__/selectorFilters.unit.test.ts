/**
 * Splitting selectors into CSS and Playwright-style filters
 * (`:has-text()`, `:text-is()`, `:visible`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError } from '@/errors/index.js';
import { invalidSelectorError } from '@/errors/messages.js';
import { selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  parseSelectorFilters,
  splitSelectorList,
  withoutVisibleFilters,
} from '@/utils/selectorFilters.js';

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

  void it('takes filters out of the middle of a compound', () => {
    assert.deepEqual(parseSelectorFilters('a:visible.active'), [
      { css: 'a.active', filters: [{ kind: 'visible' }] },
    ]);
    assert.deepEqual(parseSelectorFilters('a:has-text("x")[href]'), [
      { css: 'a[href]', filters: [{ kind: 'has-text', text: 'x' }] },
    ]);
  });

  void it('scopes the rest of the selector under a filtered compound (descendant)', () => {
    assert.deepEqual(parseSelectorFilters('li:has-text("Write report") .toggle'), [
      {
        css: 'li',
        filters: [{ kind: 'has-text', text: 'write report' }],
        steps: [{ combinator: ' ', css: '.toggle', filters: [] }],
      },
    ]);
    assert.deepEqual(parseSelectorFilters('#form label:has-text("Customer name") input'), [
      {
        css: '#form label',
        filters: [{ kind: 'has-text', text: 'customer name' }],
        steps: [{ combinator: ' ', css: 'input', filters: [] }],
      },
    ]);
  });

  void it('scopes under a filtered compound with a child combinator', () => {
    assert.deepEqual(parseSelectorFilters('tr:text-is("Ada") > td button'), [
      {
        css: 'tr',
        filters: [{ kind: 'text-is', text: 'Ada' }],
        steps: [{ combinator: '>', css: 'td button', filters: [] }],
      },
    ]);
    assert.deepEqual(parseSelectorFilters('ul>li:visible>a'), [
      {
        css: 'ul > li',
        filters: [{ kind: 'visible' }],
        steps: [{ combinator: '>', css: 'a', filters: [] }],
      },
    ]);
  });

  void it('chains several filtered compounds into steps', () => {
    assert.deepEqual(
      parseSelectorFilters('section:has-text("A") li:has-text("B") > .toggle:visible'),
      [
        {
          css: 'section',
          filters: [{ kind: 'has-text', text: 'a' }],
          steps: [
            { combinator: ' ', css: 'li', filters: [{ kind: 'has-text', text: 'b' }] },
            { combinator: '>', css: '.toggle', filters: [{ kind: 'visible' }] },
          ],
        },
      ]
    );
    assert.deepEqual(parseSelectorFilters('li:visible :has-text("x")'), [
      {
        css: 'li',
        filters: [{ kind: 'visible' }],
        steps: [{ combinator: ' ', css: '*', filters: [{ kind: 'has-text', text: 'x' }] }],
      },
    ]);
  });

  void it('keeps sibling combinators before a filtered compound in its CSS', () => {
    assert.deepEqual(parseSelectorFilters('h2 + p:has-text("x") a'), [
      {
        css: 'h2 + p',
        filters: [{ kind: 'has-text', text: 'x' }],
        steps: [{ combinator: ' ', css: 'a', filters: [] }],
      },
    ]);
    assert.deepEqual(parseSelectorFilters('a ~ b:visible'), [
      { css: 'a ~ b', filters: [{ kind: 'visible' }] },
    ]);
  });

  void it('scopes each selector of a list separately', () => {
    assert.deepEqual(parseSelectorFilters('li:has-text("x") a, button:visible'), [
      {
        css: 'li',
        filters: [{ kind: 'has-text', text: 'x' }],
        steps: [{ combinator: ' ', css: 'a', filters: [] }],
      },
      { css: 'button', filters: [{ kind: 'visible' }] },
    ]);
  });

  void it('reads filters inside :has() as a test of what an element contains', () => {
    assert.deepEqual(parseSelectorFilters('li:has(label:text-is("Write report")) .toggle'), [
      {
        css: 'li',
        filters: [
          {
            kind: 'has',
            selectors: [
              [
                {
                  combinator: ' ',
                  css: 'label',
                  filters: [{ kind: 'text-is', text: 'Write report' }],
                },
              ],
            ],
          },
        ],
        steps: [{ combinator: ' ', css: '.toggle', filters: [] }],
      },
    ]);
    assert.deepEqual(parseSelectorFilters('li.todo:has(> label:visible, b span:has-text(x))'), [
      {
        css: 'li.todo',
        filters: [
          {
            kind: 'has',
            selectors: [
              [{ combinator: '>', css: 'label', filters: [{ kind: 'visible' }] }],
              [{ combinator: ' ', css: 'b span', filters: [{ kind: 'has-text', text: 'x' }] }],
            ],
          },
        ],
      },
    ]);
    assert.deepEqual(parseSelectorFilters('div:has(:text-is("x"))'), [
      {
        css: 'div',
        filters: [
          {
            kind: 'has',
            selectors: [[{ combinator: ' ', css: '*', filters: [{ kind: 'text-is', text: 'x' }] }]],
          },
        ],
      },
    ]);
  });

  void it('keeps a :has() without filters as CSS, next to other filters', () => {
    assert.deepEqual(parseSelectorFilters('li:has(> input:checked):has-text("x")'), [
      { css: 'li:has(> input:checked)', filters: [{ kind: 'has-text', text: 'x' }] },
    ]);
    assert.deepEqual(parseSelectorFilters('div:has([title=":visible"]) a:visible'), [
      { css: 'div:has([title=":visible"]) a', filters: [{ kind: 'visible' }] },
    ]);
  });

  void it('rejects sibling combinators after a filtered compound', () => {
    assertRejected('li:visible + li', /descendant \(space\) or child \(>\) combinator .* not "\+"/);
    assertRejected('h2:has-text("x") ~ p', /not "~"/);
    assertRejected('li:has(+ a:visible)', /not "\+"/);
    assertRejected('li:has(~ a:has-text("x"))', /not "~"/);
  });

  void it('rejects filters inside pseudo-classes other than :has()', () => {
    assertRejected(
      ':not(:visible)',
      /:visible can only be used on an element .* or inside :has\(\)/
    );
    assertRejected('a:is(.x:has-text("y"))', /:has-text\("y"\) can only be used/);
    assertRejected('li:has(a:not(:visible))', /:visible can only be used/);
  });

  void it('rejects an empty selector in a list or a dangling combinator without leaking rewritten CSS', () => {
    assertRejected(
      'button:has-text("x"), a, ',
      /Invalid CSS selector: button:has-text\("x"\), a, +\(a selector in the list is empty\)/
    );
    assertRejected('li:visible >', /ends with a combinator/);
    assertRejected('> li:visible', /starts with the combinator ">"/);
  });

  void it('rejects :has-text() with empty text, which would match everything', () => {
    assertRejected('p:has-text()', /:has-text\(\) needs the text to look for/);
    assertRejected('p:has-text("")', /needs the text to look for/);
    assertRejected("p:has-text('  ')", /needs the text to look for/);
    assert.deepEqual(parseSelectorFilters('p:text-is("")'), [
      { css: 'p', filters: [{ kind: 'text-is', text: '' }] },
    ]);
  });

  void it('rejects text filters without their text', () => {
    assertRejected('a:has-text', /:has-text needs its text/);
    assertRejected('a:has-text("x"', /:has-text needs its text/);
    assertRejected('a:text-is("x', /:text-is needs its text/);
    assertRejected('a:text-is("x" y)', /:text-is needs its text/);
    assertRejected('a:has-text(x', /:has-text needs its text/);
  });
});

void describe('withoutVisibleFilters', () => {
  void it('drops :visible everywhere (steps and :has()) and keeps the other filters', () => {
    const parts = parseSelectorFilters('li:visible:has(a:visible) b:has-text("x"):visible') ?? [];
    assert.deepEqual(withoutVisibleFilters(parts), [
      {
        css: 'li',
        filters: [{ kind: 'has', selectors: [[{ combinator: ' ', css: 'a', filters: [] }]] }],
        steps: [{ combinator: ' ', css: 'b', filters: [{ kind: 'has-text', text: 'x' }] }],
      },
    ]);
  });

  void it('returns null when nothing uses :visible', () => {
    assert.equal(withoutVisibleFilters(parseSelectorFilters('a:has-text("x") b') ?? []), null);
  });
});

void describe('invalidSelectorError', () => {
  void it('points Playwright-only syntax to the supported filters and a11y query', () => {
    for (const selector of ['button:text("Save")', 'text=Save', 'div >> button', 'a:near(.b)']) {
      const { suggestion } = invalidSelectorError(selector);
      assert.match(suggestion, /:has-text\("…"\), :text-is\("…"\) and :visible/, selector);
      assert.match(suggestion, /li:has-text\("Buy milk"\) \.toggle/, selector);
      assert.match(suggestion, /bdg dom a11y query 'name=…'/, selector);
    }
  });

  void it('keeps the plain syntax hint for other invalid selectors', () => {
    assert.match(invalidSelectorError('a[').suggestion, /Check the selector syntax/);
  });
});

void describe('selectorArgsJS', () => {
  void it('rejects an empty or blank selector with exit 81 before any page script runs', () => {
    for (const selector of ['', '   ']) {
      assert.throws(
        () => selectorArgsJS(selector),
        (error: unknown) =>
          error instanceof CommandError &&
          error.exitCode === EXIT_CODES.INVALID_ARGUMENTS &&
          /The provided selector is empty/.test(error.message),
        JSON.stringify(selector)
      );
    }
  });

  void it('passes plain CSS unchanged', () => {
    assert.equal(selectorArgsJS('a.b'), '"a.b", null');
  });
});
