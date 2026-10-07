/**
 * `dom audit` findings from hand-made page walks.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAudit, imageFinding, requiredRatio } from '@/runtime/dom/auditModel.js';
import type { RawAudit, RawAuditText } from '@/runtime/dom/auditScripts.js';

const BASE: RawAudit = {
  viewport: { width: 1280, height: 800 },
  pixelRatio: 1,
  pageWidth: 1280,
  canvasDark: false,
  walked: 10,
  capped: false,
};

const text = (label: string, color: string, size = '16px', weight = '400'): RawAuditText => ({
  label,
  text: label,
  color,
  fontSize: size,
  fontWeight: weight,
  backgrounds: [{ color: 'rgb(255, 255, 255)', image: false }],
  opacity: 1,
  risks: [],
  inView: true,
});

void describe('dom audit', () => {
  void it('lists text below the level, weakest first, and counts the rest', () => {
    const result = buildAudit(
      {
        ...BASE,
        texts: [
          text('p.ok', 'rgb(0, 0, 0)'),
          text('p.grey', 'rgb(150, 150, 150)'),
          text('p.pale', 'rgb(220, 220, 220)'),
          text('h1.large', 'rgb(140, 140, 140)', '32px'),
        ],
      },
      { checks: ['contrast'], level: 'AA', limit: 1 }
    );
    assert.equal(result.contrast?.checked, 4);
    assert.equal(result.contrast?.failing, 2);
    assert.deepEqual(
      result.contrast?.items.map((item) => item.element),
      ['p.pale']
    );
  });

  void it('asks less of large text and more at AAA', () => {
    assert.equal(requiredRatio({ size: 16, weight: 400 }, 'AA'), 4.5);
    assert.equal(requiredRatio({ size: 24, weight: 400 }, 'AA'), 3);
    assert.equal(requiredRatio({ size: 19, weight: 700 }, 'AA'), 3);
    assert.equal(requiredRatio({ size: 16, weight: 400 }, 'AAA'), 7);
  });

  void it('says what makes the page scroll sideways, farthest first, and groups repeats', () => {
    const result = buildAudit(
      {
        ...BASE,
        pageWidth: 1600,
        wide: [
          { label: 'div.a', right: 1400, width: 300 },
          { label: 'div.hero', right: 1600, width: 1600 },
        ],
        truncated: [
          { label: 'span.title', text: 'Long', kind: 'ellipsis' },
          { label: 'span.title', text: 'Long', kind: 'ellipsis' },
        ],
        images: [],
      },
      { checks: ['overflow'], level: 'AA', limit: 20 }
    );
    assert.equal(result.overflow?.scrollsSideways, true);
    assert.equal(result.overflow?.wide[0]?.element, 'div.hero');
    assert.deepEqual(result.overflow?.truncated, [
      { element: 'span.title', text: 'Long', kind: 'ellipsis', count: 2 },
    ]);
  });

  void it('flags upscaled images by the pixel ratio and distorted ones unless object-fit crops', () => {
    const image = (w: number, h: number, objectFit = 'fill') => ({
      label: 'img',
      natural: { w: 200, h: 100 },
      rendered: { w, h },
      objectFit,
    });
    assert.equal(imageFinding(image(200, 100)), undefined);
    assert.equal(imageFinding(image(400, 200))?.upscaled, true);
    assert.equal(imageFinding(image(200, 100), 2)?.scale, 2);
    assert.equal(imageFinding(image(100, 100))?.distorted, true);
    assert.equal(imageFinding(image(100, 100, 'cover')), undefined);
    assert.equal(imageFinding(image(400, 100, 'contain')), undefined);
    assert.equal(imageFinding(image(800, 800, 'none')), undefined);
  });

  void it('counts text it cannot measure apart from the failing list, and counts canvas elements', () => {
    const result = buildAudit(
      {
        ...BASE,
        texts: [
          {
            ...text('p#low', 'rgb(255, 255, 255)'),
            inView: false,
            risks: ['only its ancestors were checked'],
          },
          text('p.pale', 'rgb(220, 220, 220)'),
        ],
        animations: [],
        canvases: 2,
      },
      { checks: ['contrast', 'animations'], level: 'AA', limit: 20 }
    );
    assert.deepEqual(
      result.contrast?.items.map((item) => item.element),
      ['p.pale']
    );
    assert.equal(result.contrast?.failing, 1);
    assert.equal(result.contrast?.uncertain, 1);
    assert.equal(result.canvases, 2);
    assert.equal(
      buildAudit(
        { ...BASE, animations: [], canvases: 0 },
        { checks: ['animations'], level: 'AA', limit: 20 }
      ).canvases,
      undefined
    );
  });
});
