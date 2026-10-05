/**
 * Shell Detection Unit Tests
 *
 * Tests shell quote damage detection for selectors and scripts.
 *
 * Following testing philosophy:
 * - Test the BEHAVIOR: "Detects damaged input, provides actionable suggestions"
 * - Test the PROPERTY: "Never throws, always returns valid result"
 * - No mocking needed - pure utility functions
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectSelectorQuoteDamage,
  detectScriptQuoteDamage,
  hasAttributeSelector,
} from '@/utils/shellDetection.js';

void describe('Shell Detection Utilities', () => {
  void describe('hasAttributeSelector()', () => {
    void it('returns true for attribute selectors', () => {
      assert.equal(hasAttributeSelector('[data-test=value]'), true);
      assert.equal(hasAttributeSelector('[type=submit]'), true);
      assert.equal(hasAttributeSelector('input[name=email]'), true);
    });

    void it('returns false for simple selectors', () => {
      assert.equal(hasAttributeSelector('#id'), false);
      assert.equal(hasAttributeSelector('.class'), false);
      assert.equal(hasAttributeSelector('button'), false);
      assert.equal(hasAttributeSelector('div.class#id'), false);
    });

    void it('returns true for quoted attribute selectors', () => {
      assert.equal(hasAttributeSelector('[data-test="value"]'), true);
      assert.equal(hasAttributeSelector("[type='submit']"), true);
    });
  });

  void describe('detectSelectorQuoteDamage()', () => {
    void describe('detects damaged selectors', () => {
      void it('detects unquoted attribute value', () => {
        const result = detectSelectorQuoteDamage('[data-test=value]');

        assert.equal(result.damaged, true);
        assert.equal(result.type, 'attribute-selector');
        assert.ok(result.details?.includes('data-test'));
        assert.ok(result.details?.includes('value'));
        assert.ok(result.suggestion?.includes('bdg dom query'));
      });

      void it('detects unquoted type attribute', () => {
        const result = detectSelectorQuoteDamage('[type=submit]');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('type'));
        assert.ok(result.details?.includes('submit'));
      });

      void it('detects nested selector with unquoted attribute', () => {
        const result = detectSelectorQuoteDamage('form [name=email]');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('name'));
      });
    });

    void describe('accepts valid selectors', () => {
      void it('accepts properly quoted double quotes', () => {
        const result = detectSelectorQuoteDamage('[data-test="value"]');

        assert.equal(result.damaged, false);
      });

      void it('accepts properly quoted single quotes', () => {
        const result = detectSelectorQuoteDamage("[data-test='value']");

        assert.equal(result.damaged, false);
      });

      void it('accepts simple selectors without attributes', () => {
        assert.equal(detectSelectorQuoteDamage('#id').damaged, false);
        assert.equal(detectSelectorQuoteDamage('.class').damaged, false);
        assert.equal(detectSelectorQuoteDamage('button').damaged, false);
        assert.equal(detectSelectorQuoteDamage('div > p').damaged, false);
      });

      void it('accepts empty selector', () => {
        const result = detectSelectorQuoteDamage('');

        assert.equal(result.damaged, false);
      });
    });

    void describe('suggestion quality', () => {
      void it('provides two-step discovery path', () => {
        const result = detectSelectorQuoteDamage('[data-test=value]');

        assert.ok(result.suggestion?.includes('bdg dom query'));
        assert.ok(result.suggestion?.includes('bdg dom a11y describe 0'));
      });

      void it('includes original selector in suggestion', () => {
        const selector = '[custom-attr=myvalue]';
        const result = detectSelectorQuoteDamage(selector);

        assert.ok(result.suggestion?.includes(selector));
      });
    });
  });

  void describe('detectScriptQuoteDamage()', () => {
    /**
     * Detect damage for a script that failed with `<name> is not defined`.
     *
     * @param script - Script
     * @param name - Undefined identifier
     * @returns Detection result
     */
    const undefinedName = (
      script: string,
      name: string
    ): ReturnType<typeof detectScriptQuoteDamage> =>
      detectScriptQuoteDamage(
        script,
        `ReferenceError: ${name} is not defined\n    at <anonymous>:1:1`
      );

    void describe('detects bare arguments of string-taking DOM methods', () => {
      void it('detects querySelector with bare argument', () => {
        const result = undefinedName('document.querySelector(input)', 'input');

        assert.equal(result.damaged, true);
        assert.equal(result.type, 'unquoted-argument');
        assert.ok(result.details?.includes('querySelector'));
        assert.ok(result.details?.includes('input'));
      });

      void it('detects getElementById with bare argument', () => {
        const result = undefinedName('document.getElementById(myId)', 'myId');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('getElementById'));
        assert.ok(result.details?.includes('myId'));
      });

      void it('detects closest, getAttribute, classList.add and matches', () => {
        assert.equal(undefinedName('element.closest(div)', 'div').damaged, true);
        assert.equal(undefinedName('el.getAttribute(href)', 'href').damaged, true);
        assert.equal(undefinedName('el.classList.add(active)', 'active').damaged, true);
        assert.equal(undefinedName('element.matches(button)', 'button').damaged, true);
      });

      void it('detects a hyphenated id and a compound selector', () => {
        assert.equal(undefinedName('document.getElementById(my-id)', 'my').damaged, true);
        assert.equal(
          undefinedName('document.querySelector(button.primary)', 'button').damaged,
          true
        );
      });

      void it('detects class, id and child selectors left bare', () => {
        const cases: Array<[string, string, string]> = [
          ['document.querySelector(.btn)', "SyntaxError: Unexpected token '.'", '".btn"'],
          ['el.closest(.card).id', "SyntaxError: Unexpected token '.'", 'closest(".card").id'],
          [
            'document.querySelector(#main)',
            "SyntaxError: Private field '#main' must be declared in an enclosing class",
            '"#main"',
          ],
          ['document.querySelector(#main)', 'SyntaxError: Invalid or unexpected token', '"#main"'],
          ['document.querySelector(> p)', "SyntaxError: Unexpected token '>'", '"> p"'],
          ['document.querySelector(div > p)', 'ReferenceError: div is not defined', '"div > p"'],
        ];
        for (const [script, error, fixed] of cases) {
          const result = detectScriptQuoteDamage(script, error);
          assert.equal(result.damaged, true, script);
          assert.ok(result.suggestion?.includes(fixed), `${script}: ${result.suggestion}`);
        }
      });

      void it('ignores punctuation errors outside string-taking DOM methods', () => {
        assert.equal(
          detectScriptQuoteDamage('Math.round(.5 .x)', "SyntaxError: Unexpected token '.'").damaged,
          false
        );
        assert.equal(
          detectScriptQuoteDamage(
            'document.querySelector(a).x.',
            "SyntaxError: Unexpected token '.'"
          ).damaged,
          false
        );
        assert.equal(
          detectScriptQuoteDamage('items.push(#x)', 'SyntaxError: Invalid or unexpected token')
            .damaged,
          false
        );
      });

      void it('detects a selector of several words from missing )', () => {
        const result = detectScriptQuoteDamage(
          'document.querySelector(div p).textContent',
          'SyntaxError: missing ) after argument list'
        );

        assert.equal(result.damaged, true);
        assert.ok(result.suggestion?.includes('document.querySelector("div p").textContent'));
        assert.equal(
          detectScriptQuoteDamage('Math.max(a b)', 'SyntaxError: missing ) after argument list')
            .damaged,
          false
        );
      });

      void it('detects a selector of several words from Unexpected identifier', () => {
        const result = detectScriptQuoteDamage(
          'document.querySelector(div p)',
          "SyntaxError: Unexpected identifier 'p'"
        );

        assert.equal(result.damaged, true);
        assert.ok(result.suggestion?.includes('document.querySelector("div p")'));
      });
    });

    void describe('stays quiet when stripped quotes do not explain the error', () => {
      void it('ignores a redeclaration error (Math.round(x) false positive)', () => {
        const script = 'const x = 2.5; Math.round(x)';

        assert.equal(
          detectScriptQuoteDamage(script, "SyntaxError: Identifier 'x' has already been declared")
            .damaged,
          false
        );
        assert.equal(
          detectScriptQuoteDamage(
            'const a = 1; const a = 2; document.querySelector(a)',
            "SyntaxError: Identifier 'a' has already been declared"
          ).damaged,
          false
        );
      });

      void it('ignores a method that does not take a string', () => {
        assert.equal(undefinedName('Math.round(x)', 'x').damaged, false);
        assert.equal(undefinedName('items.push(item)', 'item').damaged, false);
      });

      void it('ignores an error about another identifier', () => {
        assert.equal(undefinedName('foo.bar; document.querySelector(input)', 'foo').damaged, false);
        assert.equal(undefinedName('document.querySelector(inputs)', 'input').damaged, false);
      });

      void it('ignores a name the script declares', () => {
        assert.equal(
          undefinedName('document.querySelector(sel); let sel = "a"', 'sel').damaged,
          false
        );
      });

      void it('ignores errors stripped quotes do not cause', () => {
        assert.equal(
          detectScriptQuoteDamage('document.querySelector(input)', 'TypeError: x is not a function')
            .damaged,
          false
        );
        assert.equal(
          detectScriptQuoteDamage(
            'document.querySelector(new Foo)',
            "SyntaxError: Unexpected identifier 'Foo'"
          ).damaged,
          false
        );
      });

      void it('ignores quoted and numeric arguments', () => {
        assert.equal(undefinedName('document.querySelector("input")', 'input').damaged, false);
        assert.equal(undefinedName("document.querySelector('input')", 'input').damaged, false);
        assert.equal(undefinedName('array.slice(0, 5)', 'array').damaged, false);
        assert.equal(undefinedName('', 'x').damaged, false);
      });
    });

    void describe('suggestion quality', () => {
      void it('provides corrected full expression', () => {
        const result = undefinedName('document.querySelector(input).value', 'input');

        assert.ok(result.suggestion?.includes('document.querySelector("input").value'));
      });

      void it('preserves context around damaged part', () => {
        const result = undefinedName('element.closest(div).textContent', 'div');

        assert.ok(result.suggestion?.includes('element.closest("div").textContent'));
      });

      void it('includes bdg dom eval command', () => {
        const result = undefinedName('el.getAttribute(arg)', 'arg');

        assert.ok(result.suggestion?.includes('bdg dom eval'));
      });
    });
  });

  void describe('Type safety and edge cases', () => {
    void it('never throws for any string input', () => {
      const edgeCases = [
        '',
        ' ',
        '[]',
        '()',
        '[=]',
        'func()',
        '[[nested]]',
        'a'.repeat(1000),
        '🚀',
        '\n\t',
        'null',
        'undefined',
      ];

      for (const input of edgeCases) {
        assert.doesNotThrow(
          () => {
            detectSelectorQuoteDamage(input);
            detectScriptQuoteDamage(input, `ReferenceError: ${input} is not defined`);
            hasAttributeSelector(input);
          },
          `Should not throw for input: ${JSON.stringify(input)}`
        );
      }
    });

    void it('always returns valid ShellDamageResult structure', () => {
      const inputs = ['[test=value]', '#simple', 'func(arg)', 'valid()'];

      for (const input of inputs) {
        const selectorResult = detectSelectorQuoteDamage(input);
        const scriptResult = detectScriptQuoteDamage(input, 'ReferenceError: arg is not defined');

        assert.equal(typeof selectorResult.damaged, 'boolean');
        assert.equal(typeof scriptResult.damaged, 'boolean');

        if (selectorResult.damaged) {
          assert.equal(typeof selectorResult.details, 'string');
          assert.equal(typeof selectorResult.suggestion, 'string');
        }

        if (scriptResult.damaged) {
          assert.equal(typeof scriptResult.details, 'string');
          assert.equal(typeof scriptResult.suggestion, 'string');
        }
      }
    });

    void it('handles special regex characters safely', () => {
      const specialChars = ['[test.value]', '[test*=value]', '[test^=value]', 'func(a|b)'];

      for (const input of specialChars) {
        assert.doesNotThrow(() => {
          detectSelectorQuoteDamage(input);
          detectScriptQuoteDamage(input, "SyntaxError: Unexpected identifier 'b'");
        });
      }
    });
  });
});
