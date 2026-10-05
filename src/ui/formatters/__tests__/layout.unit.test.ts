/**
 * Human output of `bdg dom layout`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ElementLayout } from '@/ipc/protocol/domTypes.js';
import { OFF_SCREEN_REASONS } from '@/runtime/dom/elementGeometry.js';
import { formatLayout, layoutLine } from '@/ui/formatters/layout.js';
import { scrollLockedReason } from '@/ui/messages/commands.js';

const PAGE = {
  viewport: { width: 1280, height: 720 },
  scroll: { x: 0, y: 0 },
  document: { width: 1280, height: 2400 },
};

/**
 * An element layout with defaults for the fields a test does not care about.
 *
 * @param overrides - Fields to set
 * @returns Element layout
 */
function layout(overrides: Partial<ElementLayout> = {}): ElementLayout {
  return {
    index: 0,
    tag: 'button',
    element: 'button#save',
    text: 'Save',
    bounds: { x: 420, y: 1180, width: 120, height: 40 },
    viewport: { x: 420, y: 1180 },
    inViewport: 'below',
    scrollBy: { x: 0, y: 500 },
    computed: {
      display: 'inline-block',
      visibility: 'visible',
      position: 'static',
      opacity: '1',
      zIndex: 'auto',
    },
    ...overrides,
  };
}

void describe('layoutLine', () => {
  void it('shows position, size and how far to scroll for an element below the fold', () => {
    assert.equal(
      layoutLine(layout()),
      '[0] button#save "Save"  420,1180 120×40  below fold (scroll down 500px to centre it)'
    );
  });

  void it('does not promise to centre an element larger than the viewport', () => {
    const tall = layout({ bounds: { x: 0, y: 1180, width: 300, height: 900 } });
    assert.match(
      layoutLine(tall, PAGE.viewport),
      /below fold \(scroll down 500px to bring it into view\)$/
    );
    assert.match(layoutLine(layout(), PAGE.viewport), /to centre it\)$/);
  });

  void it('says that page scrolling is locked rather than calling in-flow content fixed', () => {
    const { scrollBy: _scrollBy, ...rest } = layout();
    assert.equal(
      layoutLine({
        ...rest,
        offScreenReason: scrollLockedReason('overflow: hidden on body', 'div#consent'),
      }),
      '[0] button#save "Save"  420,1180 120×40  below fold; page scrolling is locked (overflow: hidden on body), likely by dialog div#consent'
    );
    assert.match(
      layoutLine({ ...rest, offScreenReason: scrollLockedReason('overflow: hidden on body') }),
      /below fold; page scrolling is locked \(overflow: hidden on body\)$/
    );
  });

  void it('shows the visible share, what covers it and where it lives', () => {
    const line = layoutLine(
      layout({
        inViewport: 'partly',
        percentVisible: 40,
        scrollBy: { x: -20, y: 0 },
        coveredBy: 'div#overlay.backdrop',
        context: 'iframe#pay',
      })
    );
    assert.equal(
      line,
      '[0] button#save "Save"  420,1180 120×40  partly visible (40%); scroll left 20px to see all of it  covered by div#overlay.backdrop  in iframe#pay'
    );
  });

  void it('says why a hidden element is hidden, without its meaningless box, and leaves out missing text', () => {
    const { text: _text, scrollBy: _scrollBy, ...rest } = layout();
    const line = layoutLine({ ...rest, inViewport: 'hidden', hiddenReason: 'display: none' });
    assert.equal(line, '[0] button#save  hidden (display: none)');
  });

  void it('does not repeat the iframe that clips an element as its context', () => {
    const { scrollBy: _scrollBy, ...rest } = layout();
    assert.equal(
      layoutLine({ ...rest, clippedBy: 'iframe#f1', context: 'iframe#f1' }),
      '[0] button#save "Save"  420,1180 120×40  out of view in iframe#f1 (below)'
    );
    assert.match(
      layoutLine({ ...rest, clippedBy: 'ul#list', context: 'iframe#f1' }),
      /out of view in ul#list \(below\) {2}in iframe#f1$/
    );
  });

  void it('names the container an element is scrolled out of, and notes inert elements', () => {
    const { scrollBy: _scrollBy, ...rest } = layout();
    assert.equal(
      layoutLine({ ...rest, clippedBy: 'ul#list', inert: true }),
      '[0] button#save "Save"  420,1180 120×40  out of view in ul#list (below)  inert'
    );
    assert.match(
      layoutLine({ ...rest, inViewport: 'partly', percentVisible: 30, clippedBy: 'ul#list' }),
      /partly visible \(30%, clipped by ul#list\)$/
    );
  });

  void it('says why page scroll cannot bring an off-screen element into view', () => {
    const { scrollBy: _scrollBy, ...rest } = layout();
    assert.equal(
      layoutLine({
        ...rest,
        inViewport: 'left',
        offScreenReason: 'fixed position, page scroll does not move it',
      }),
      '[0] button#save "Save"  420,1180 120×40  left of viewport (off-screen: fixed position, page scroll does not move it)'
    );
  });

  void it('tells how to see all of a partly visible element, or why scrolling does not', () => {
    const partly = layout({ inViewport: 'partly', percentVisible: 24, scrollBy: { x: 0, y: 302 } });
    assert.match(layoutLine(partly), /partly visible \(24%\); scroll down 302px to see all of it$/);
    const tall = layout({
      inViewport: 'partly',
      percentVisible: 60,
      bounds: { x: 0, y: 0, width: 100, height: 2000 },
    });
    assert.match(
      layoutLine(tall, PAGE.viewport),
      /partly visible \(60%\); scroll down 500px to show it from its start$/
    );
    const { scrollBy: _scrollBy, ...rest } = layout();
    for (const reason of Object.values({
      fixed: OFF_SCREEN_REASONS.fixed,
      sticky: OFF_SCREEN_REASONS.sticky,
    })) {
      assert.match(
        layoutLine({ ...rest, inViewport: 'partly', percentVisible: 40, offScreenReason: reason }),
        new RegExp(`partly visible \\(40%\\); ${reason}$`)
      );
    }
    assert.match(
      layoutLine({ ...rest, inViewport: 'above', offScreenReason: OFF_SCREEN_REASONS.sticky }),
      /above viewport \(off-screen: sticky position, page scroll moves it only until it sticks\)$/
    );
  });

  void it('says why a rendered element is invisible (opacity on it or an ancestor, clip-path)', () => {
    assert.match(
      layoutLine(layout({ inViewport: 'visible', invisible: 'opacity: 0 on div#menu' })),
      /visible {2}opacity: 0 on div#menu$/
    );
    assert.match(
      layoutLine(layout({ inViewport: 'visible', invisible: 'clip-path: inset(50%)' })),
      /visible {2}clip-path: inset\(50%\)$/
    );
  });
});

void describe('formatLayout', () => {
  void it('shows the page once, then at most 20 elements and how many more there are', () => {
    const elements = Array.from({ length: 25 }, (_, index) => layout({ index }));
    const output = formatLayout({ selector: 'li', count: 130, page: PAGE, elements, omitted: 105 });
    assert.match(output, /^Page: viewport 1280×720, scrolled to 0,0, document 1280×2400$/m);
    assert.match(output, /^130 elements match "li" \(page x,y and size in CSS px\):$/m);
    assert.match(output, /\[19\] button#save/);
    assert.doesNotMatch(output, /\[20\]/);
    assert.match(output, /\.\.\. and 110 more \(--json lists the first 25\)$/m);
  });

  void it('names the color scheme the page sees when known', () => {
    const output = formatLayout({
      selector: 'li',
      count: 1,
      page: { ...PAGE, colorScheme: 'dark' },
      elements: [layout()],
    });
    assert.match(output, /document 1280×2400, prefers-color-scheme: dark$/m);
  });

  void it('points to --json for the rest when JSON lists every match', () => {
    const elements = Array.from({ length: 25 }, (_, index) => layout({ index }));
    const output = formatLayout({ selector: 'li', count: 25, page: PAGE, elements });
    assert.match(output, /\.\.\. and 5 more \(use --json for all\)$/m);
  });

  void it('says which share of the matches --index picked', () => {
    const output = formatLayout({ selector: 'li', count: 4, page: PAGE, elements: [layout()] });
    assert.match(output, /^1 of 4 elements matching "li" /m);
  });
});
