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
    void describe('detects bare function arguments', () => {
      void it('detects querySelector with bare argument', () => {
        const result = detectScriptQuoteDamage('document.querySelector(input)');

        assert.equal(result.damaged, true);
        assert.equal(result.type, 'unquoted-argument');
        assert.ok(result.details?.includes('querySelector'));
        assert.ok(result.details?.includes('input'));
      });

      void it('detects getElementById with bare argument', () => {
        const result = detectScriptQuoteDamage('document.getElementById(myId)');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('getElementById'));
        assert.ok(result.details?.includes('myId'));
      });

      void it('detects closest with bare argument', () => {
        const result = detectScriptQuoteDamage('element.closest(div)');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('closest'));
        assert.ok(result.details?.includes('div'));
      });

      void it('detects getAttribute with bare argument', () => {
        const result = detectScriptQuoteDamage('el.getAttribute(href)');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('getAttribute'));
        assert.ok(result.details?.includes('href'));
      });

      void it('detects classList.add with bare argument', () => {
        const result = detectScriptQuoteDamage('el.classList.add(active)');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('add'));
        assert.ok(result.details?.includes('active'));
      });

      void it('detects matches with bare argument', () => {
        const result = detectScriptQuoteDamage('element.matches(button)');

        assert.equal(result.damaged, true);
        assert.ok(result.details?.includes('matches'));
      });
    });

    void describe('accepts valid scripts', () => {
      void it('accepts properly quoted strings', () => {
        assert.equal(detectScriptQuoteDamage('document.querySelector("input")').damaged, false);
        assert.equal(detectScriptQuoteDamage("document.querySelector('input')").damaged, false);
        assert.equal(detectScriptQuoteDamage('el.getAttribute("href")').damaged, false);
      });

      void it('accepts scripts without function calls', () => {
        assert.equal(detectScriptQuoteDamage('document.title').damaged, false);
        assert.equal(detectScriptQuoteDamage('window.location.href').damaged, false);
        assert.equal(detectScriptQuoteDamage('1 + 2').damaged, false);
      });

      void it('accepts numeric arguments', () => {
        assert.equal(detectScriptQuoteDamage('array.slice(0, 5)').damaged, false);
        assert.equal(detectScriptQuoteDamage('Math.max(1, 2, 3)').damaged, false);
      });

      void it('accepts empty script', () => {
        const result = detectScriptQuoteDamage('');

        assert.equal(result.damaged, false);
      });
    });

    void describe('suggestion quality', () => {
      void it('provides corrected full expression', () => {
        const result = detectScriptQuoteDamage('document.querySelector(input).value');

        assert.ok(result.suggestion?.includes('document.querySelector("input").value'));
      });

      void it('preserves context around damaged part', () => {
        const result = detectScriptQuoteDamage('element.closest(div).textContent');

        assert.ok(result.suggestion?.includes('element.closest("div").textContent'));
      });

      void it('includes bdg dom eval command', () => {
        const result = detectScriptQuoteDamage('func(arg)');

        assert.ok(result.suggestion?.includes('bdg dom eval'));
      });
    });

    void describe('unexpected identifier fallback', () => {
      void it('detects unexpected identifier error pattern', () => {
        const result = detectScriptQuoteDamage("Unexpected identifier 'foo'");

        assert.equal(result.damaged, true);
        assert.ok(result.suggestion?.includes('single quotes'));
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
            detectScriptQuoteDamage(input);
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
        const scriptResult = detectScriptQuoteDamage(input);

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
          detectScriptQuoteDamage(input);
        });
      }
    });
  });
});
