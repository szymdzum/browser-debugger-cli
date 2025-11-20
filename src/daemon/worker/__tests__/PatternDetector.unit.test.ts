/**
 * Unit tests for PatternDetector.
 *
 * Tests the contract of pattern detection behavior:
 * - Hint display after threshold
 * - Per-pattern threshold respect
 * - Max shows limit
 * - Pattern matching logic
 */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import { PatternDetector } from '@/daemon/patternDetector.js';

describe('PatternDetector', () => {
  describe('threshold-based hint display', () => {
    test('does not show hint below threshold', () => {
      const detector = new PatternDetector();

      const result1 = detector.trackCommand('Runtime.evaluate');

      assert.strictEqual(result1.shouldShow, false);
      assert.strictEqual(result1.pattern, undefined);
    });

    test('shows hint when threshold is reached', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      const result2 = detector.trackCommand('Runtime.evaluate');

      assert.strictEqual(result2.shouldShow, true);
      assert.ok(result2.pattern);
      assert.ok(result2.pattern.alternative.includes('bdg dom query'));
    });

    test('continues showing hint after threshold until max shows', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Runtime.evaluate');

      const result3 = detector.trackCommand('Runtime.evaluate');
      assert.strictEqual(result3.shouldShow, true);
    });
  });

  describe('per-pattern threshold configuration', () => {
    test('respects threshold of 1 for screenshot pattern', () => {
      const detector = new PatternDetector();

      const result = detector.trackCommand('Page.captureScreenshot');

      assert.strictEqual(result.shouldShow, true);
      assert.ok(result.pattern?.alternative.includes('bdg dom screenshot'));
    });

    test('respects threshold of 1 for cookies pattern', () => {
      const detector = new PatternDetector();

      const result1 = detector.trackCommand('Network.getCookies');

      assert.strictEqual(result1.shouldShow, true);
      assert.ok(result1.pattern?.alternative.includes('bdg network getCookies'));
    });

    test('respects threshold of 3 for network body pattern', () => {
      const detector = new PatternDetector();

      const result1 = detector.trackCommand('Network.getResponseBody');
      const result2 = detector.trackCommand('Network.getResponseBody');

      assert.strictEqual(result1.shouldShow, false);
      assert.strictEqual(result2.shouldShow, false);

      const result3 = detector.trackCommand('Network.getResponseBody');
      assert.strictEqual(result3.shouldShow, true);
      assert.ok(result3.pattern?.alternative.includes('bdg details network'));
    });

    test('respects threshold of 4 for multiple runtime evaluations', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Runtime.evaluate');

      const result4 = detector.trackCommand('Runtime.evaluate');

      assert.strictEqual(result4.shouldShow, true);
      assert.ok(result4.pattern?.alternative.includes('bdg dom eval'));
    });
  });

  describe('max shows limit', () => {
    test('stops showing hint after max shows limit reached', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Runtime.evaluate');

      let lastResult;
      for (let i = 0; i < 10; i++) {
        lastResult = detector.trackCommand('Runtime.evaluate');
      }

      assert.strictEqual(lastResult?.shouldShow, false);
    });

    test('tracks hint count per pattern independently', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Runtime.evaluate');

      for (let i = 0; i < 10; i++) {
        detector.trackCommand('Runtime.evaluate');
      }

      const screenshotResult = detector.trackCommand('Page.captureScreenshot');
      assert.strictEqual(screenshotResult.shouldShow, true);
    });
  });

  describe('pattern matching', () => {
    test('matches multiple CDP methods to same pattern', () => {
      const detector = new PatternDetector();

      const result1 = detector.trackCommand('Network.getCookies');
      const result2 = detector.trackCommand('Network.getAllCookies');

      assert.strictEqual(result1.shouldShow, true);
      assert.strictEqual(result2.shouldShow, false);
      assert.strictEqual(result1.pattern?.name, result2.pattern?.name);
    });

    test('returns undefined pattern for unmatched commands', () => {
      const detector = new PatternDetector();

      const result = detector.trackCommand('DOM.getDocument');

      assert.strictEqual(result.shouldShow, false);
      assert.strictEqual(result.pattern, undefined);
    });

    test('handles case-insensitive method names', () => {
      const detector = new PatternDetector();

      detector.trackCommand('runtime.evaluate');
      const result = detector.trackCommand('RUNTIME.EVALUATE');

      assert.strictEqual(result.shouldShow, true);
      assert.ok(result.pattern?.alternative.includes('bdg dom query'));
    });
  });

  describe('state persistence', () => {
    test('maintains count across multiple method calls', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Page.captureScreenshot');
      const result = detector.trackCommand('Runtime.evaluate');

      assert.strictEqual(result.shouldShow, true);
    });

    test('tracks separate counts for different patterns', () => {
      const detector = new PatternDetector();

      detector.trackCommand('Runtime.evaluate');
      detector.trackCommand('Network.getResponseBody');
      detector.trackCommand('Runtime.evaluate');

      const evalResult = detector.trackCommand('Runtime.evaluate');
      assert.strictEqual(evalResult.shouldShow, false);

      detector.trackCommand('Network.getResponseBody');
      const bodyResult = detector.trackCommand('Network.getResponseBody');
      assert.strictEqual(bodyResult.shouldShow, true);
    });
  });
});
