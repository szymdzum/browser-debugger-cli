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
  buildFills,
  buildStrokes,
  buildSvgPaint,
  buildText,
  effectiveBackground,
  renderedFont,
  textContrast,
} from '@/runtime/dom/inspectPaintModel.js';
import { groupSiblings, rowText } from '@/runtime/dom/inspectTree.js';
import { toHex } from '@/utils/color.js';
import {
  compressTracks,
  firstFontFamily,
  normalizeCssValue,
  parseShadows,
  readableTransform,
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

  void it('hugs replaced elements with an automatic size, also when display is block', () => {
    assert.equal(deriveSizing(sizing({ replaced: true })), 'hug');
    assert.equal(deriveSizing(sizing({ replaced: true, axis: 'h' })), 'hug');
    const flexItem = { replaced: true, parentDisplay: 'flex', parentDirection: 'row' };
    assert.equal(
      deriveSizing(sizing({ ...flexItem, axis: 'h', parentAlignItems: 'normal' })),
      'hug'
    );
    assert.equal(deriveSizing(sizing({ ...flexItem, flexGrow: 1 })), 'fill');
    assert.equal(deriveSizing(sizing({ ...flexItem, axis: 'h', alignSelf: 'stretch' })), 'fill');
    assert.equal(deriveSizing(sizing({ replaced: true, size: '100%' })), 'fill');
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

  void it('fades the text by the opacity of the element and its ancestors', () => {
    const style = { color: 'rgb(0, 0, 0)', 'font-size': '16px', 'font-weight': '400' };
    const faded = textContrast(style, {
      backgrounds: [{ color: 'rgba(0, 0, 0, 0)', image: false, opacity: 0.25 }],
      canvasDark: false,
      opacity: 0.25,
    });
    assert.ok(faded && faded.ratio < 3, `ratio ${faded?.ratio}`);
    assert.equal(faded?.level, 'fail');
    assert.equal(faded?.opacity, 0.25);
    const onWhite = {
      backgrounds: [{ color: 'rgb(255, 255, 255)', image: false }],
      canvasDark: false,
    };
    assert.equal(textContrast(style, { ...onWhite, opacity: 1 })?.opacity, undefined);
  });

  void it('fades the background of a translucent ancestor along with the text', () => {
    const white = { color: 'rgb(255, 255, 255)', 'font-size': '16px', 'font-weight': '400' };
    const contrast = textContrast(white, {
      backgrounds: [
        { color: 'rgba(0, 0, 0, 0)', image: false },
        { color: 'rgb(0, 0, 0)', image: false, opacity: 0.5 },
        { color: 'rgb(255, 255, 255)', image: false },
      ],
      canvasDark: false,
      opacity: 0.5,
    });
    assert.equal(contrast?.background, '#808080');
    assert.ok(contrast && contrast.ratio > 3.9 && contrast.ratio < 4, `ratio ${contrast?.ratio}`);
    assert.equal(contrast?.level, 'fail');
  });

  void it('says why a ratio is approximate', () => {
    const style = { color: 'rgb(0, 0, 0)', 'font-size': '16px', 'font-weight': '400' };
    const contrast = textContrast(style, {
      backgrounds: [{ color: 'rgb(255, 255, 255)', image: false }],
      canvasDark: false,
      paintRisks: ['mix-blend-mode hard-light on h1', 'canvas behind'],
    });
    assert.deepEqual(contrast?.approximate, ['mix-blend-mode hard-light on h1', 'canvas behind']);
  });

  void it('never calls a loaded web font a fallback, and names what a generic family resolved to', () => {
    const klim = [{ familyName: 'Copyright Klim Type Foundry', isCustomFont: true, glyphCount: 9 }];
    assert.deepEqual(renderedFont('sohne-var', klim, true), { webfont: true });
    const local = [{ familyName: 'Menlo', isCustomFont: false, glyphCount: 9 }];
    assert.deepEqual(renderedFont('Brand Sans', local, true), {});
    const system = [{ familyName: 'Helvetica', isCustomFont: false, glyphCount: 9 }];
    assert.deepEqual(renderedFont('sans-serif', system), { resolved: 'Helvetica' });
    assert.deepEqual(renderedFont('Brand Sans', system), { rendered: 'Helvetica' });
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

  const font = (color: string, family = 'Georgia'): Record<string, string> => ({
    color,
    'font-family': family,
    'font-size': '16px',
    'font-weight': '400',
  });
  const onGrey = {
    backgrounds: [{ color: 'rgb(221, 221, 221)', image: false }],
    canvasDark: false,
    rendered: true,
    hasText: true,
  };

  void it('describes the text of the descendant that draws it, and names it', () => {
    const text = buildText(
      { style: font('rgb(253, 120, 101)'), holderStyle: font('rgb(234, 236, 240)') },
      { ...onGrey, textual: true, textHolder: 'abbr' },
      []
    );
    assert.equal(text?.holder, 'abbr');
    assert.equal(text?.color, '#eaecf0');
    assert.equal(text?.contrast?.level, 'fail');
    const own = buildText({ style: font('rgb(0, 0, 0)') }, { ...onGrey, textual: true }, []);
    assert.equal(own?.holder, undefined);
    assert.equal(own?.color, '#000');
  });

  void it('gives no contrast for text not rendered, and no text group without text', () => {
    const gone = buildText(
      { style: font('rgb(0, 0, 0)') },
      { ...onGrey, textual: true, rendered: false },
      []
    );
    assert.equal(gone?.contrast, undefined);
    const parentStyle = font('rgb(0, 0, 0)', 'Georgia');
    const icon = buildText(
      { style: font('rgb(0, 0, 0)', 'Arial'), parentStyle },
      { ...onGrey, textual: false, hasText: false },
      []
    );
    assert.equal(icon, undefined);
  });

  void it("keeps a container's rendered font only when its text has the container's family", () => {
    const parentStyle = font('rgb(0, 0, 0)', 'Georgia');
    const fallback = [{ familyName: 'Times', isCustomFont: false, glyphCount: 9 }];
    const raw = { ...onGrey, textual: false };
    const same = buildText(
      {
        style: font('rgb(0, 0, 0)', 'Brand'),
        parentStyle,
        holderStyle: font('rgb(0, 0, 0)', 'Brand'),
      },
      raw,
      fallback
    );
    assert.equal(same?.rendered, 'Times');
    const other = buildText(
      {
        style: font('rgb(0, 0, 0)', 'Brand'),
        parentStyle,
        holderStyle: font('rgb(0, 0, 0)', 'Mono'),
      },
      raw,
      fallback
    );
    assert.equal(other?.family, 'Brand');
    assert.equal(other?.rendered, undefined);
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

  void it('keeps px inside calc() and url(), and drops it elsewhere', () => {
    assert.equal(normalizeCssValue('calc(100% - 9px) 50%'), 'calc(100% - 9px) 50%');
    assert.equal(normalizeCssValue('url(img/hero-1920px.jpg) 10px'), 'url(img/hero-1920px.jpg) 10');
    assert.equal(normalizeCssValue('min(10px, 2vw) 3px'), 'min(10px, 2vw) 3');
  });

  void it('writes a mirrored transform as a negative scale, not a rotation', () => {
    assert.equal(readableTransform('matrix(-1, 0, 0, 1, 0, 0)'), 'scale(-1,1)');
    assert.equal(readableTransform('matrix(1, 0, 0, -1, 0, 0)'), 'scale(1,-1)');
    assert.equal(readableTransform('matrix(0, 1, -1, 0, 0, 0)'), 'rotate(90deg)');
  });
});

void describe('fills and SVG paint', () => {
  void it('gives each background layer its own size and position', () => {
    const fills = buildFills({
      'background-image': 'url("a.png"), url("b.png")',
      'background-size': '16px 12px, 18px 18px',
      'background-position-x': 'calc(100% - 12px), calc(100% - 36px)',
      'background-position-y': '50%, 50%',
      'background-color': 'rgb(255, 255, 255)',
    });
    assert.deepEqual(fills, [
      { type: 'image', value: 'url(a.png)', size: '16 12', position: 'calc(100% - 12px) 50%' },
      { type: 'image', value: 'url(b.png)', size: '18 18', position: 'calc(100% - 36px) 50%' },
      { type: 'solid', color: '#fff' },
    ]);
  });

  void it('paints SVG elements with fill and stroke only', () => {
    assert.deepEqual(
      buildSvgPaint(
        { fill: 'rgb(255, 0, 0)', stroke: 'rgb(0, 0, 0)', 'stroke-width': '2px' },
        { svg: true }
      ),
      { fill: '#f00', stroke: '#000', strokeWidth: 2 }
    );
    assert.equal(buildSvgPaint({ fill: 'rgb(0, 0, 0)' }, { svg: false }), undefined);
  });
});

void describe('child tree', () => {
  const row = (element: string, overrides: Partial<InspectTreeNode> = {}): InspectTreeNode => ({
    element,
    x: 0,
    y: 0,
    w: 266,
    h: 107,
    ...overrides,
  });

  void it('keeps rows reached through different slots or wrappers apart', () => {
    const rows = groupSiblings([row('p', { via: 'div.wrap (contents)' }), row('p')]);
    assert.equal(rows.length, 2);
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
