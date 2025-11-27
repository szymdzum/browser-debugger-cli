import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateImageTokens,
  calculateResizeScale,
  isTallPage,
  shouldResize,
  calculateFinalDimensions,
  calculateActualDimensions,
  MAX_EDGE_PX,
  PIXELS_PER_TOKEN,
  TALL_PAGE_THRESHOLD,
} from '@/commands/dom/screenshotResize.js';

void describe('calculateImageTokens', () => {
  void it('calculates tokens using width × height / 750 formula', () => {
    assert.equal(calculateImageTokens(1092, 1092), Math.ceil((1092 * 1092) / 750));
  });

  void it('returns ~1590 tokens for Anthropic recommended 1092x1092', () => {
    const tokens = calculateImageTokens(1092, 1092);
    assert.ok(tokens >= 1589 && tokens <= 1591, `Expected ~1590, got ${tokens}`);
  });

  void it('returns ~2770 tokens for 1920x1080 viewport', () => {
    const tokens = calculateImageTokens(1920, 1080);
    assert.ok(tokens >= 2760 && tokens <= 2780, `Expected ~2770, got ${tokens}`);
  });

  void it('handles zero dimensions', () => {
    assert.equal(calculateImageTokens(0, 0), 0);
    assert.equal(calculateImageTokens(1000, 0), 0);
    assert.equal(calculateImageTokens(0, 1000), 0);
  });

  void it('rounds up (ceil) for fractional results', () => {
    const tokens = calculateImageTokens(100, 100);
    assert.equal(tokens, Math.ceil(10000 / 750));
    assert.equal(tokens, 14);
  });
});

void describe('calculateResizeScale', () => {
  void it('returns 1 when both dimensions are within limit', () => {
    assert.equal(calculateResizeScale(1000, 1000), 1);
    assert.equal(calculateResizeScale(MAX_EDGE_PX, 500), 1);
    assert.equal(calculateResizeScale(500, MAX_EDGE_PX), 1);
  });

  void it('returns 1 when exactly at max edge', () => {
    assert.equal(calculateResizeScale(MAX_EDGE_PX, MAX_EDGE_PX), 1);
  });

  void it('scales down when width exceeds limit', () => {
    const scale = calculateResizeScale(3136, 1000);
    assert.ok(scale < 1, 'Scale should be less than 1');
    assert.equal(scale, MAX_EDGE_PX / 3136);
  });

  void it('scales down when height exceeds limit', () => {
    const scale = calculateResizeScale(1000, 3136);
    assert.ok(scale < 1, 'Scale should be less than 1');
    assert.equal(scale, MAX_EDGE_PX / 3136);
  });

  void it('uses longest edge for scale calculation', () => {
    const scale1 = calculateResizeScale(3000, 2000);
    const scale2 = calculateResizeScale(2000, 3000);
    assert.equal(scale1, scale2, 'Scale should be same regardless of orientation');
    assert.equal(scale1, MAX_EDGE_PX / 3000);
  });

  void it('produces correct scale for Wikipedia-style tall page', () => {
    const scale = calculateResizeScale(1866, 37833);
    const expectedScale = MAX_EDGE_PX / 37833;
    assert.ok(Math.abs(scale - expectedScale) < 0.0001, `Expected ${expectedScale}, got ${scale}`);
  });
});

void describe('isTallPage', () => {
  void it('returns false for square pages', () => {
    assert.equal(isTallPage(1000, 1000), false);
  });

  void it('returns false for normal aspect ratios', () => {
    assert.equal(isTallPage(1920, 1080), false);
    assert.equal(isTallPage(1920, 3000), false);
    assert.equal(isTallPage(1920, 5760), false);
  });

  void it('returns true when aspect ratio exceeds threshold', () => {
    assert.equal(isTallPage(1000, 3001), true);
    assert.equal(isTallPage(1920, 6000), true);
  });

  void it('uses threshold of 3:1', () => {
    assert.equal(TALL_PAGE_THRESHOLD, 3);
    assert.equal(isTallPage(1000, 3000), false);
    assert.equal(isTallPage(1000, 3001), true);
  });

  void it('handles zero width gracefully', () => {
    assert.equal(isTallPage(0, 1000), false);
  });

  void it('detects Wikipedia-style tall pages', () => {
    assert.equal(isTallPage(1866, 37833), true);
  });
});

void describe('shouldResize', () => {
  void it('returns false when dimensions are within limit', () => {
    assert.equal(shouldResize(1000, 1000, false), false);
    assert.equal(shouldResize(MAX_EDGE_PX, MAX_EDGE_PX, false), false);
  });

  void it('returns true when width exceeds limit', () => {
    assert.equal(shouldResize(2000, 1000, false), true);
  });

  void it('returns true when height exceeds limit', () => {
    assert.equal(shouldResize(1000, 2000, false), true);
  });

  void it('respects noResize flag', () => {
    assert.equal(shouldResize(5000, 5000, true), false);
    assert.equal(shouldResize(5000, 5000, false), true);
  });

  void it('checks longest edge, not total pixels', () => {
    assert.equal(shouldResize(1568, 1568, false), false);
    assert.equal(shouldResize(1569, 1, false), true);
  });
});

void describe('calculateFinalDimensions', () => {
  void it('returns original dimensions when scale is 1', () => {
    const result = calculateFinalDimensions(1920, 1080, 1);
    assert.deepEqual(result, { width: 1920, height: 1080 });
  });

  void it('scales dimensions proportionally', () => {
    const result = calculateFinalDimensions(2000, 1000, 0.5);
    assert.deepEqual(result, { width: 1000, height: 500 });
  });

  void it('rounds to nearest integer', () => {
    const result = calculateFinalDimensions(1000, 1000, 0.333);
    assert.equal(result.width, 333);
    assert.equal(result.height, 333);
  });

  void it('produces max edge of 1568 when scaling oversized image', () => {
    const scale = calculateResizeScale(3136, 2000);
    const result = calculateFinalDimensions(3136, 2000, scale);
    assert.equal(result.width, MAX_EDGE_PX);
    assert.ok(result.height <= MAX_EDGE_PX);
  });
});

void describe('calculateActualDimensions', () => {
  void it('returns same dimensions for 1x display', () => {
    const result = calculateActualDimensions(1920, 1080, 1);
    assert.deepEqual(result, { width: 1920, height: 1080 });
  });

  void it('doubles dimensions for 2x Retina display', () => {
    const result = calculateActualDimensions(1920, 1080, 2);
    assert.deepEqual(result, { width: 3840, height: 2160 });
  });

  void it('handles fractional DPR', () => {
    const result = calculateActualDimensions(1000, 1000, 1.5);
    assert.deepEqual(result, { width: 1500, height: 1500 });
  });

  void it('rounds to nearest integer', () => {
    const result = calculateActualDimensions(100, 100, 1.333);
    assert.equal(result.width, 133);
    assert.equal(result.height, 133);
  });
});

void describe('constants', () => {
  void it('MAX_EDGE_PX matches Anthropic recommendation', () => {
    assert.equal(MAX_EDGE_PX, 1568);
  });

  void it('PIXELS_PER_TOKEN matches Claude Vision formula', () => {
    assert.equal(PIXELS_PER_TOKEN, 750);
  });

  void it('TALL_PAGE_THRESHOLD is 3:1 aspect ratio', () => {
    assert.equal(TALL_PAGE_THRESHOLD, 3);
  });
});

void describe('integration: end-to-end resize calculation', () => {
  void it('correctly handles normal page on 2x display', () => {
    const cssWidth = 1920;
    const cssHeight = 1080;
    const dpr = 2;

    const needsResize = shouldResize(cssWidth, cssHeight, false);
    assert.equal(needsResize, true);

    const scale = calculateResizeScale(cssWidth, cssHeight);
    const finalCss = calculateFinalDimensions(cssWidth, cssHeight, scale);
    const actual = calculateActualDimensions(finalCss.width, finalCss.height, dpr);
    const tokens = calculateImageTokens(actual.width, actual.height);

    assert.ok(finalCss.width <= MAX_EDGE_PX);
    assert.ok(finalCss.height <= MAX_EDGE_PX);
    assert.ok(tokens < 10000, `Tokens should be reasonable, got ${tokens}`);
  });

  void it('correctly handles tall page detection and fallback', () => {
    const cssWidth = 1866;
    const cssHeight = 37833;

    const tall = isTallPage(cssWidth, cssHeight);
    assert.equal(tall, true);

    const viewportWidth = 1400;
    const viewportHeight = 900;
    const scale = calculateResizeScale(viewportWidth, viewportHeight);
    assert.equal(scale, 1, 'Viewport within MAX_EDGE_PX should not need resize');
  });

  void it('token calculation matches expected for Anthropic sweet spot', () => {
    const tokens = calculateImageTokens(1092, 1092);
    assert.ok(tokens >= 1500 && tokens <= 1700, `Expected ~1590 tokens, got ${tokens}`);
  });
});
