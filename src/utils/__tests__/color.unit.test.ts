/**
 * Color parsing, hex output and contrast math of `dom inspect`.
 *
 * Expected sRGB bytes for the modern color functions were read back from
 * Chrome itself (a 1×1 canvas filled with the color), so the conversion
 * matches what Chrome paints, within one step per channel.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composite,
  contrastLevel,
  contrastRatio,
  hexColor,
  hexColorsIn,
  parseColor,
  toHex,
  type Rgba,
} from '@/utils/color.js';

/**
 * Assert a parsed color matches Chrome's painted bytes within one step.
 *
 * @param value - CSS color
 * @param bytes - Expected r, g, b (0-255) and alpha (0-1)
 */
function assertPaints(value: string, bytes: [number, number, number, number?]): void {
  const color = parseColor(value);
  assert.ok(color, `${value} parses`);
  const actual = [color.r, color.g, color.b].map((c) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
  );
  actual.forEach((byte, i) => {
    assert.ok(
      Math.abs(byte - (bytes[i] ?? 0)) <= 1,
      `${value}: channel ${i} ${byte} vs ${bytes[i]}`
    );
  });
  assert.ok(Math.abs(color.a - (bytes[3] ?? 1)) < 0.01, `${value}: alpha ${color.a}`);
}

void describe('parseColor', () => {
  void it('parses rgb() and rgba() as Chrome computes them', () => {
    assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 1, g: 0, b: 0, a: 1 });
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.2)'), { r: 0, g: 0, b: 0, a: 0.2 });
    assert.deepEqual(parseColor('rgb(255 255 255 / 50%)'), { r: 1, g: 1, b: 1, a: 0.5 });
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
  });

  void it('parses hex and transparent', () => {
    assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1, a: 1 });
    assert.equal(parseColor('#00000080')?.a.toFixed(2), '0.50');
    assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  });

  void it('converts lab() and lch() like Chrome paints them', () => {
    assertPaints('lab(30 10 -40)', [50, 68, 134]);
    assertPaints('lab(52.2 40 59)', [198, 93, 11]);
    assertPaints('lab(29.2345 39.3825 20.0664)', [125, 35, 41]);
    assertPaints('lch(50 30 120)', [105, 126, 73]);
  });

  void it('converts oklab() and oklch(), Tailwind v4 palette included', () => {
    assertPaints('oklch(0.55 0.2 260)', [28, 105, 227]);
    assertPaints('oklch(0.373 0.034 259.733)', [54, 65, 83]);
    assertPaints('oklch(37.3% 0.034 259.733)', [54, 65, 83]);
    assertPaints('oklch(0.623 0.214 259.815)', [43, 127, 255]);
    assertPaints('oklab(0.5 0.1 -0.1)', [129, 69, 154]);
  });

  void it('clips colors outside the sRGB gamut as Chrome does', () => {
    assertPaints('oklch(0.9 0.3 140)', [75, 255, 0]);
    assertPaints('color(display-p3 1 0 0)', [255, 0, 0]);
  });

  void it('converts color() spaces', () => {
    assertPaints('color(display-p3 0.2 0.5 0.8)', [0, 130, 210]);
    assertPaints('color(srgb-linear 0.5 0.2 0.1)', [188, 124, 89]);
    assertPaints('color(rec2020 0.3 0.6 0.2)', [0, 170, 42]);
    assertPaints('color(xyz-d65 0.2 0.3 0.4)', [0, 167, 164]);
    assertPaints('color(xyz-d50 0.2 0.3 0.4)', [0, 168, 189]);
    assertPaints('color(a98-rgb 0.4 0.6 0.2)', [67, 154, 34]);
    assertPaints('color(prophoto-rgb 0.4 0.6 0.2)', [82, 178, 5]);
    assertPaints('color(srgb 1 0.5 0)', [255, 128, 0]);
  });

  void it('keeps the alpha of modern color functions', () => {
    assertPaints('oklch(0.7 0.15 30 / 0.5)', [237, 118, 102, 0.5]);
    assertPaints('lab(30 10 -40 / 25%)', [50, 68, 134, 0.25]);
    assertPaints('color(display-p3 0.2 0.5 0.8 / 0.4)', [0, 130, 210, 0.4]);
  });

  void it('treats none as zero', () => {
    assertPaints('oklch(0.5 none none)', [99, 99, 99]);
  });

  void it('returns null for what is not a color', () => {
    assert.equal(parseColor('currentcolor'), null);
    assert.equal(parseColor('linear-gradient(red, blue)'), null);
    assert.equal(parseColor('color(unknown 1 2 3)'), null);
    assert.equal(parseColor('#12'), null);
  });
});

void describe('toHex and hexColor', () => {
  void it('prints short hex when the digits repeat', () => {
    assert.equal(hexColor('rgb(255, 255, 255)'), '#fff');
    assert.equal(hexColor('rgb(54, 65, 83)'), '#364153');
    assert.equal(hexColor('oklch(0.373 0.034 259.733)'), '#364153');
  });

  void it('prints 8-digit hex for translucent colors and transparent at alpha 0', () => {
    assert.equal(hexColor('rgba(0, 0, 0, 0.2)'), '#00000033');
    assert.equal(hexColor('rgba(255, 255, 255, 0.15)'), '#ffffff26');
    assert.equal(hexColor('rgba(0, 0, 0, 0)'), 'transparent');
    assert.equal(toHex({ r: 2, g: -1, b: 0.5, a: 1 }), '#ff0080');
  });

  void it('leaves values that are not colors unchanged', () => {
    assert.equal(hexColor('currentcolor'), 'currentcolor');
  });

  void it('replaces the colors inside shadows and gradients', () => {
    assert.equal(
      hexColorsIn('rgba(0, 0, 0, 0.2) 0px 1px 2px 0px, oklch(0.373 0.034 259.733) 0px 0px 0px 1px'),
      '#00000033 0px 1px 2px 0px, #364153 0px 0px 0px 1px'
    );
    assert.equal(
      hexColorsIn('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'),
      'linear-gradient(#f00, #00f)'
    );
  });
});

void describe('contrast', () => {
  const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };
  const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };

  void it('computes WCAG ratios', () => {
    assert.equal(contrastRatio(black, white), 21);
    assert.equal(contrastRatio(white, white), 1);
    const gray = parseColor('#777') as Rgba;
    assert.equal(contrastRatio(gray, white).toFixed(2), '4.48');
  });

  void it('composites translucent text over the background', () => {
    const halfBlack = { ...black, a: 0.5 };
    const ratio = contrastRatio(halfBlack, white);
    assert.ok(ratio > 3.9 && ratio < 4.1, String(ratio));
  });

  void it('composites translucent layers', () => {
    const over = composite({ r: 0, g: 0, b: 0, a: 0.5 }, white);
    assert.equal(toHex(over), '#808080');
    assert.deepEqual(composite({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }), {
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  void it('rates levels with the large-text thresholds', () => {
    assert.equal(contrastLevel(7.1, 14, 400), 'AAA');
    assert.equal(contrastLevel(4.6, 14, 400), 'AA');
    assert.equal(contrastLevel(4.48, 14, 300), 'fail');
    assert.equal(contrastLevel(4.6, 24, 400), 'AAA');
    assert.equal(contrastLevel(3.2, 18.67, 700), 'AA large');
    assert.equal(contrastLevel(3.2, 18.67, 400), 'fail');
  });
});
