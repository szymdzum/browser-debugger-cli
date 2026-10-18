/**
 * Fixture pages for `bdg debug log` on bundles with source maps (#848,
 * part 2), served by the fixture server. Maps are built by
 * `sourceMapBuilder.ts` from where each original line starts in the
 * generated text.
 *
 * - `/source-maps`: buttons wired by `/sm/dist/app.js` (external map
 *   `app.js.map`, sources `../src/cart.ts` and `../src/main.ts`),
 *   `/sm/dist/min.js` (one line, external map, two functions of
 *   `src/pair.ts`), `/sm/dist/inline.js` (inline `data:` map, source
 *   `src/inline.ts`), and three scripts whose maps cannot be used:
 *   `broken.js` (map 404), `bad.js` (map is not JSON) and `sections.js`
 *   (an indexed map).
 * - The lines the tests bind are numbered in {@link CART_LINES},
 *   {@link PAIR_LINES} and {@link INLINE_LINES} (original lines, 1-based).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';
import {
  anchorSegments,
  buildSourceMap,
  inlineMapComment,
  type Anchor,
} from '@/__testutils__/sourceMapBuilder.js';

/** Lines of `src/cart.ts` (original) */
export const CART_LINES = {
  /** `type Item = ...`: compiles to nothing */
  typeOnly: 1,
  /** `const discount = 0.5;` */
  discount: 5,
  /** `return total;`: `total` is 25 and `discount` 0.5 when it runs */
  returnTotal: 7,
} as const;

/** Lines of `src/pair.ts` (original) */
export const PAIR_LINES = {
  /** `const doubled = a * 2;` in `first` */
  inFirst: 2,
  /** `const tripled = a * 3;` in `second` */
  inSecond: 6,
} as const;

/** Lines of `src/inline.ts` (original) */
export const INLINE_LINES = {
  /** `const sum = a + b;` */
  sum: 2,
} as const;

/** Generated `dist/app.js`, by line */
const APP_JS = [
  '"use strict";',
  '// generated from src/cart.ts and src/main.ts',
  'function computeTotal(items) {',
  '  var subtotal = 0;',
  '  items.forEach(function (item) { subtotal += item.price; });',
  '  var discount = 0.5;',
  '  var total = subtotal - discount;',
  '  return total;',
  '}',
  "document.getElementById('checkout').addEventListener('click', function () {",
  "  document.getElementById('out').textContent = 'Total: ' + computeTotal([{ price: 10 }, { price: 15.5 }]);",
  '});',
  '//# sourceMappingURL=app.js.map',
];

const APP_MAP = buildSourceMap({
  sources: ['../src/cart.ts', '../src/main.ts'],
  segments: anchorSegments(APP_JS, [
    { genLine: 2, needle: 'function', source: 0, origLine: 2 },
    { genLine: 3, needle: 'var', source: 0, origLine: 3, origColumn: 2 },
    { genLine: 4, needle: 'items.forEach', source: 0, origLine: 4, origColumn: 2 },
    { genLine: 4, needle: 'subtotal +=', source: 0, origLine: 4, origColumn: 30 },
    { genLine: 5, needle: 'var discount', source: 0, origLine: 5, origColumn: 2 },
    { genLine: 6, needle: 'var total', source: 0, origLine: 6, origColumn: 2 },
    { genLine: 7, needle: 'return', source: 0, origLine: 7, origColumn: 2 },
    { genLine: 8, needle: '}', source: 0, origLine: 8 },
    { genLine: 9, needle: 'document', source: 1, origLine: 1 },
    { genLine: 10, needle: 'document', source: 1, origLine: 2, origColumn: 2 },
  ]),
});

/** Generated `dist/min.js`: everything on the first line */
const MIN_JS = [
  'function first(a){var d=a*2;return d}function second(a){var t=a*3;return t}' +
    'document.getElementById("first").onclick=function(){first(2)};' +
    'document.getElementById("second").onclick=function(){second(5)};',
  '//# sourceMappingURL=min.js.map',
];

const MIN_ANCHORS: Anchor[] = [
  { genLine: 0, needle: 'function first', source: 0, origLine: 1 },
  { genLine: 0, needle: 'var d', source: 0, origLine: 2, origColumn: 2 },
  { genLine: 0, needle: 'return d', source: 0, origLine: 3, origColumn: 2 },
  { genLine: 0, needle: 'function second', source: 0, origLine: 5 },
  { genLine: 0, needle: 'var t', source: 0, origLine: 6, origColumn: 2 },
  { genLine: 0, needle: 'return t', source: 0, origLine: 7, origColumn: 2 },
];

const MIN_MAP = buildSourceMap({
  sources: ['../src/pair.ts'],
  segments: anchorSegments(MIN_JS, MIN_ANCHORS),
});

const INLINE_BODY = [
  'function addInline(a, b) {',
  '  var sum = a + b;',
  '  return sum;',
  '}',
  "document.getElementById('inline').addEventListener('click', function () { addInline(3, 4); });",
];

const INLINE_MAP = buildSourceMap({
  sources: ['src/inline.ts'],
  segments: anchorSegments(INLINE_BODY, [
    { genLine: 0, needle: 'function', source: 0, origLine: 1 },
    { genLine: 1, needle: 'var sum', source: 0, origLine: 2, origColumn: 2 },
    { genLine: 2, needle: 'return', source: 0, origLine: 3, origColumn: 2 },
    { genLine: 3, needle: '}', source: 0, origLine: 4 },
  ]),
});

/** An indexed map (`sections`), which bdg does not read */
const SECTIONS_MAP = JSON.stringify({
  version: 3,
  sections: [{ offset: { line: 0, column: 0 }, map: JSON.parse(INLINE_MAP) as unknown }],
});

/** The page */
const SOURCE_MAPS_HTML = `<!doctype html><html><head><title>source maps</title></head><body>
<button id="checkout">Checkout</button>
<button id="first">First</button>
<button id="second">Second</button>
<button id="inline">Inline</button>
<p id="out"></p>
<script src="/sm/dist/app.js"></script>
<script src="/sm/dist/min.js"></script>
<script src="/sm/dist/inline.js"></script>
<script src="/sm/dist/broken.js"></script>
<script src="/sm/dist/bad.js"></script>
<script src="/sm/dist/sections.js"></script>
</body></html>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/source-maps': SOURCE_MAPS_HTML,
  '/sm/dist/app.js': APP_JS.join('\n'),
  '/sm/dist/app.js.map': APP_MAP,
  '/sm/dist/min.js': MIN_JS.join('\n'),
  '/sm/dist/min.js.map': MIN_MAP,
  '/sm/dist/inline.js': [...INLINE_BODY, inlineMapComment(INLINE_MAP)].join('\n'),
  '/sm/dist/broken.js': 'window.broken = 1;\n//# sourceMappingURL=missing.js.map',
  '/sm/dist/bad.js': 'window.bad = 1;\n//# sourceMappingURL=bad.js.map',
  '/sm/dist/bad.js.map': 'this is not json',
  '/sm/dist/sections.js': 'window.sections = 1;\n//# sourceMappingURL=sections.js.map',
  '/sm/dist/sections.js.map': SECTIONS_MAP,
};
