/**
 * `--viewport` and `--color-scheme` at start (#332): parsing, the window of a
 * launched Chrome, and how `bdg status` shows them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseColorScheme, parseViewport } from '@/commands/start.js';
import { windowSizeFlags } from '@/daemon/session/chromeConnection.js';
import { CommandError } from '@/errors/index.js';
import { viewportOverride } from '@/runtime/page/emulation.js';
import { appearanceLines } from '@/ui/formatters/status.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Assert that a parse fails with 81 and a suggestion.
 *
 * @param parse - Parse call
 * @param suggestion - Expected suggestion text
 */
function assertInvalid(parse: () => unknown, suggestion: RegExp): void {
  assert.throws(parse, (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(String(error.metadata['suggestion']), suggestion);
    return true;
  });
}

void describe('parseViewport', () => {
  void it('reads width x height in several spellings', () => {
    for (const value of ['1280x800', '1280X800', '1280×800', '1280,800', ' 1280 x 800 ']) {
      assert.deepEqual(parseViewport(value), { width: 1280, height: 800 }, value);
    }
  });

  void it('rejects other values and sides outside 1-10000 with 81', () => {
    for (const value of ['1280', '1280x', 'x800', 'wide', '0x800', '1280x20000', '12.5x800']) {
      assertInvalid(() => parseViewport(value), /e\.g\. --viewport 1280x800/);
    }
  });
});

void describe('parseColorScheme', () => {
  void it('accepts light and dark in any case', () => {
    assert.equal(parseColorScheme('dark'), 'dark');
    assert.equal(parseColorScheme('LIGHT'), 'light');
  });

  void it('suggests the closest scheme for a typo', () => {
    assertInvalid(() => parseColorScheme('drak'), /Did you mean: dark\?/);
    assertInvalid(() => parseColorScheme('sepia'), /light, dark/);
  });
});

void describe('viewport emulation', () => {
  void it('sizes the window of a launched Chrome, before the user flags', () => {
    const base = { url: 'http://x/', port: 9222 };
    assert.deepEqual(windowSizeFlags({ ...base, viewport: { width: 1280, height: 800 } }), [
      '--window-size=1280,800',
    ]);
    assert.deepEqual(
      windowSizeFlags({
        ...base,
        viewport: { width: 1280, height: 800 },
        chromeFlags: ['--window-size=800,600'],
      }),
      ['--window-size=1280,800', '--window-size=800,600']
    );
    assert.equal(windowSizeFlags(base), undefined);
  });

  void it('overrides a desktop viewport at the display pixel ratio', () => {
    assert.deepEqual(viewportOverride({ width: 1280, height: 800 }), {
      width: 1280,
      height: 800,
      deviceScaleFactor: 0,
      mobile: false,
    });
  });
});

void describe('status appearance lines', () => {
  const page = { url: 'http://x/', title: 'x' };

  void it('shows what the page renders with (without scrollbars) and where it comes from', () => {
    assert.deepEqual(
      appearanceLines({}, { ...page, viewport: { width: 1905, height: 993 }, colorScheme: 'dark' }),
      [
        ['Viewport', '1905×993'],
        ['Color scheme', 'dark (system setting)'],
      ]
    );
    assert.deepEqual(
      appearanceLines(
        { viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
        { ...page, viewport: { width: 1265, height: 800 }, colorScheme: 'light' }
      ),
      [
        ['Viewport', '1265×800 (--viewport 1280x800)'],
        ['Color scheme', 'light (--color-scheme)'],
      ]
    );
  });

  void it('falls back to the start options when the page did not answer', () => {
    assert.deepEqual(appearanceLines({ colorScheme: 'dark' }, page), [
      ['Color scheme', 'dark (--color-scheme)'],
    ]);
    assert.deepEqual(appearanceLines({}, page), []);
  });
});
