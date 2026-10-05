/**
 * Human output of `bdg dom layout`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ElementLayout } from '@/ipc/protocol/domTypes.js';
import { formatLayout, layoutLine } from '@/ui/formatters/layout.js';

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
      '[0] button#save "Save"  420,1180 120×40  below fold (scroll down 500px)'
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
      '[0] button#save "Save"  420,1180 120×40  partly visible (40%) (scroll left 20px)  covered by div#overlay.backdrop  in iframe#pay'
    );
  });

  void it('says why a hidden element is hidden and leaves out missing text', () => {
    const { text: _text, scrollBy: _scrollBy, ...rest } = layout();
    const line = layoutLine({ ...rest, inViewport: 'hidden', hiddenReason: 'display: none' });
    assert.equal(line, '[0] button#save  420,1180 120×40  hidden (display: none)');
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

  void it('mentions a fully transparent element', () => {
    const line = layoutLine(
      layout({ inViewport: 'visible', computed: { ...layout().computed, opacity: '0' } })
    );
    assert.match(line, /visible {2}opacity: 0$/);
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
    assert.match(output, /\.\.\. and 110 more/);
  });

  void it('says which share of the matches --index picked', () => {
    const output = formatLayout({ selector: 'li', count: 4, page: PAGE, elements: [layout()] });
    assert.match(output, /^1 of 4 elements matching "li" /m);
  });
});
