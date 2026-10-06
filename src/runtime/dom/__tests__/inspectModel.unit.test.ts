/**
 * Group builders of `dom inspect`: which values are kept, how they are
 * normalized and how sizing, contrast, strokes and the child tree come out.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InspectTreeNode } from '@/ipc/protocol/inspectTypes.js';
import {
  buildBox,
  buildContainer,
  containerKind,
  deriveSizing,
  type SizingInput,
} from '@/runtime/dom/inspectLayoutModel.js';
import {
  buildEffects,
  buildRadius,
  buildStrokes,
  effectiveBackground,
  renderedFont,
  textContrast,
} from '@/runtime/dom/inspectPaintModel.js';
import { groupSiblings, rowText } from '@/runtime/dom/inspectTree.js';
import { toHex } from '@/utils/color.js';
import {
  compressTracks,
  firstFontFamily,
  parseShadows,
  shadowText,
  sidesShorthand,
} from '@/utils/cssValues.js';

const sizing = (overrides: Partial<SizingInput>): SizingInput => ({
  size: 'auto',
  axis: 'w',
  display: 'block',
  position: 'static',
  float: 'none',
  flexGrow: 0,
  flexBasis: 'auto',
  alignSelf: 'auto',
  justifySelf: 'auto',
  ...overrides,
});

void describe('box group', () => {
  void it('keeps computed sides even when 0, and leaves out visible overflow', () => {
    const box = buildBox(
      {
        'padding-top': '10px',
        'padding-right': '0px',
        'padding-bottom': '10px',
        'padding-left': '0px',
        'margin-top': '0px',
        'margin-right': '0px',
        'margin-bottom': '0px',
        'margin-left': '0px',
        'border-top-width': '0px',
        'border-right-width': '0px',
        'border-bottom-width': '1px',
        'border-left-width': '0px',
        'box-sizing': 'content-box',
        'overflow-x': 'visible',
        'overflow-y': 'visible',
      },
      {}
    );
    assert.deepEqual(box.padding, [10, 0, 10, 0]);
    assert.deepEqual(box.border, [0, 0, 1, 0]);
    assert.equal(box.overflow, undefined);
    assert.equal(box.min, undefined);
  });

  void it('names the overflow per axis only when the axes differ', () => {
    assert.equal(
      buildBox({ 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, {}).overflow,
      'hidden'
    );
    assert.equal(
      buildBox({ 'overflow-x': 'hidden', 'overflow-y': 'auto' }, {}).overflow,
      'hidden auto'
    );
  });
});

void describe('layout container', () => {
  void it('recognizes flex and grid displays', () => {
    assert.equal(containerKind('inline-flex'), 'flex');
    assert.equal(containerKind('grid'), 'grid');
    assert.equal(containerKind('block'), undefined);
  });

  void it('drops no-op alignment and gap values', () => {
    assert.deepEqual(
      buildContainer({
        display: 'flex',
        'flex-direction': 'row',
        'flex-wrap': 'nowrap',
        'justify-content': 'normal',
        'align-items': 'normal',
        'row-gap': 'normal',
        'column-gap': 'normal',
      }),
      { direction: 'row' }
    );
  });

  void it('keeps set alignment and one gap when both are equal', () => {
    assert.deepEqual(
      buildContainer({
        display: 'flex',
        'flex-direction': 'column',
        'justify-content': 'center',
        'align-items': 'center',
        'row-gap': '16px',
        'column-gap': '16px',
      }),
      { direction: 'column', justify: 'center', align: 'center', gap: 16 }
    );
  });

  void it('compresses grid tracks', () => {
    const container = buildContainer({
      display: 'grid',
      'grid-template-columns': '100px 100px 100px 50px',
    });
    assert.equal(container.columns, 'repeat(3,100) 50');
  });
});

void describe('sizing (Figma hug/fill/fixed)', () => {
  void it('fills the width of a block in normal flow and hugs its height', () => {
    assert.equal(deriveSizing(sizing({})), 'fill');
    assert.equal(deriveSizing(sizing({ axis: 'h' })), 'hug');
  });

  void it('hugs inline elements and fixes explicit lengths', () => {
    assert.equal(deriveSizing(sizing({ display: 'inline' })), 'hug');
    assert.equal(deriveSizing(sizing({ size: '240px' })), 'fixed');
    assert.equal(deriveSizing(sizing({ size: '100%' })), 'fill');
  });

  void it('follows flex grow on the main axis and stretch on the cross axis', () => {
    const flex = { parentDisplay: 'flex', parentDirection: 'row' };
    assert.equal(deriveSizing(sizing({ ...flex, flexGrow: 1 })), 'fill');
    assert.equal(deriveSizing(sizing({ ...flex })), 'hug');
    assert.equal(deriveSizing(sizing({ ...flex, axis: 'h', parentAlignItems: 'normal' })), 'fill');
    assert.equal(deriveSizing(sizing({ ...flex, axis: 'h', parentAlignItems: 'center' })), 'hug');
  });

  void it('hugs absolutely positioned elements with an automatic size', () => {
    assert.equal(deriveSizing(sizing({ position: 'absolute' })), 'hug');
  });
});

void describe('text paint', () => {
  void it('composites translucent backgrounds over the nearest opaque one', () => {
    const background = effectiveBackground(
      [
        { color: 'rgba(0, 0, 0, 0)', image: false },
        { color: 'rgba(0, 0, 0, 0.5)', image: false },
        { color: 'rgb(255, 255, 255)', image: false },
      ],
      false
    );
    assert.equal(toHex(background.color), '#808080');
    assert.equal(background.inherited, true);
  });

  void it('rates contrast by WCAG size and weight', () => {
    const onWhite = {
      backgrounds: [{ color: 'rgb(255, 255, 255)', image: false }],
      canvasDark: false,
    };
    const black = textContrast(
      { color: 'rgb(0, 0, 0)', 'font-size': '16px', 'font-weight': '400' },
      onWhite
    );
    assert.equal(black?.ratio, 21);
    assert.equal(black?.level, 'AAA');
    const grey = textContrast(
      { color: 'rgb(119, 119, 119)', 'font-size': '14px', 'font-weight': '300' },
      onWhite
    );
    assert.equal(grey?.level, 'fail');
    const large = textContrast(
      { color: 'rgb(119, 119, 119)', 'font-size': '24px', 'font-weight': '400' },
      onWhite
    );
    assert.equal(large?.level, 'AA large');
  });

  void it('names the rendered font only when it is not the first family', () => {
    assert.deepEqual(
      renderedFont('Inter', [{ familyName: 'Inter', isCustomFont: true, glyphCount: 5 }]),
      {
        webfont: true,
      }
    );
    assert.deepEqual(
      renderedFont('Inter', [{ familyName: 'Arial', isCustomFont: false, glyphCount: 5 }]),
      {
        rendered: 'Arial',
      }
    );
  });
});

void describe('strokes, radius and effects', () => {
  const border = (widths: string[], color = 'rgb(237, 237, 237)'): Record<string, string> =>
    Object.fromEntries(
      ['top', 'right', 'bottom', 'left'].flatMap((side, i) => [
        [`border-${side}-width`, widths[i] ?? '0px'],
        [`border-${side}-style`, widths[i] === '0px' ? 'none' : 'solid'],
        [`border-${side}-color`, color],
      ])
    );

  void it('merges four equal sides into one stroke', () => {
    assert.deepEqual(buildStrokes(border(['1px', '1px', '1px', '1px'])), [
      { side: 'all', width: 1, style: 'solid', color: '#ededed' },
    ]);
  });

  void it('keeps a single side and drops zero-width ones', () => {
    assert.deepEqual(buildStrokes(border(['0px', '0px', '1px', '0px'])), [
      { side: 'bottom', width: 1, style: 'solid', color: '#ededed' },
    ]);
  });

  void it('leaves out a zero radius', () => {
    const corners = (value: string): Record<string, string> => ({
      'border-top-left-radius': value,
      'border-top-right-radius': value,
      'border-bottom-right-radius': value,
      'border-bottom-left-radius': value,
    });
    assert.equal(buildRadius(corners('0px')), undefined);
    assert.deepEqual(buildRadius(corners('8px')), [8, 8, 8, 8]);
  });

  void it('drops transparent and empty shadow layers (ring placeholders)', () => {
    const effects = buildEffects({
      'box-shadow':
        'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.2) 0px 1px 2px 0px',
    });
    assert.equal(effects.length, 1);
    assert.equal(effects[0]?.color, '#00000033');
  });
});

void describe('css values', () => {
  void it('writes sides the way CSS shorthands do', () => {
    assert.equal(sidesShorthand([8, 8, 8, 8]), '8');
    assert.equal(sidesShorthand([10, 0, 10, 0]), '10 0');
    assert.equal(sidesShorthand([10, 0, 1, 0]), '10 0 1');
    assert.equal(sidesShorthand([1, 2, 3, 4]), '1 2 3 4');
  });

  void it('takes the first font family without quotes', () => {
    assert.equal(firstFontFamily('"DM Sans", Arial, sans-serif'), 'DM Sans');
  });

  void it('prints shadow layers with hex colors', () => {
    const [layer] = parseShadows('rgba(0, 0, 0, 0.2) 0px 1px 2px 0px');
    assert.ok(layer);
    assert.equal(shadowText(layer), '#00000033 0 1 2 0');
  });

  void it('leaves a track list without runs alone', () => {
    assert.equal(compressTracks('none'), 'none');
    assert.equal(compressTracks('248px 1220px'), '248 1220');
  });
});

void describe('child tree', () => {
  const row = (element: string, overrides: Partial<InspectTreeNode> = {}): InspectTreeNode => ({
    element,
    w: 266,
    h: 107,
    ...overrides,
  });

  void it('groups runs of identical siblings with a count', () => {
    const rows = groupSiblings([row('li.card'), row('li.card'), row('li.card'), row('li.other')]);
    assert.deepEqual(
      rows.map((r) => [r.element, r.count]),
      [
        ['li.card', 3],
        ['li.other', undefined],
      ]
    );
  });

  void it('keeps a group text only when every member has it', () => {
    assert.equal(
      groupSiblings([row('li', { text: 'a' }), row('li', { text: 'b' })])[0]?.text,
      undefined
    );
    assert.equal(groupSiblings([row('li', { text: 'a' }), row('li', { text: 'a' })])[0]?.text, 'a');
  });

  void it('cuts long row text on a whole character', () => {
    const cut = rowText('Some quick example text to build on the card title');
    assert.ok(cut.endsWith('…'));
    assert.ok(cut.length <= 31);
  });
});
