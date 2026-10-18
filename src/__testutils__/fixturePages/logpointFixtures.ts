/**
 * Fixture pages for `bdg debug log` (logpoints, #848), served by the fixture
 * server.
 *
 * - `/logpoints`: buttons wired by `/logpoints/app.js` (a checkout whose
 *   total ignores that the discount is a fraction, a loop of 10000
 *   iterations, a function with a `debugger;` statement), a button that runs
 *   no code of `app.js` (`#noop`) and a button (`#load-late`) that loads the
 *   script named by the `late` query parameter, which the test serves and
 *   holds back.
 * - `/logpoint-utils`: two scripts named `util.js` in different directories,
 *   both run by `#both`; `UTIL_JS_LINE` is the line they return `which` on.
 * - `/logpoints/app.js`: the script, served like any page (the lines the
 *   tests bind are numbered in {@link APP_JS_LINES}).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Lines of `/logpoints/app.js`, 1-based as `bdg debug log` counts them */
export const APP_JS_LINES = {
  /** `var discount = 0.5;` */
  discount: 6,
  /** `return total;`: `total` is 25 and `discount` 0.5 when it runs */
  returnTotal: 8,
  /** `sum += n;`: runs 10000 times */
  loopBody: 18,
  /** Lines with code, enough for more logpoints than a session allows */
  codeLines: [2, 3, 4, 6, 7, 8, 11, 12, 13, 16, 17, 18],
  /** Last line of the file */
  last: 28,
} as const;

/** Line of `return which;` in both `util.js` */
export const UTIL_JS_LINE = 3;

/** The script the page loads */
const APP_JS = `function computeTotal(cart) {
  var subtotal = 0;
  cart.items.forEach(function (item) {
    subtotal += item.price;
  });
  var discount = 0.5;
  var total = subtotal - discount;
  return total;
}
function checkout() {
  var cart = { items: [{ price: 10 }, { price: 15.5 }] };
  var shown = computeTotal(cart);
  document.getElementById('out').textContent = 'Total: ' + shown;
}
function sumLoop() {
  var sum = 0;
  for (var n = 0; n < 10000; n++) {
    sum += n;
  }
  document.getElementById('out').textContent = 'Sum: ' + sum;
}
function pauseHere() {
  debugger;
  document.getElementById('out').textContent = 'Resumed';
}
document.getElementById('checkout').addEventListener('click', checkout);
document.getElementById('loop').addEventListener('click', sumLoop);
document.getElementById('pause').addEventListener('click', pauseHere);
`;

/** The page */
const LOGPOINTS_HTML = `<!doctype html><html><head><title>logpoints</title></head><body>
<button id="checkout">Checkout</button>
<button id="noop" onclick="document.getElementById('out').textContent = 'Nothing'">No-op</button>
<button id="loop">Loop</button>
<button id="pause">Pause</button>
<a id="open-tab" href="/logpoints" target="_blank">Open</a>
<button id="load-late" onclick="var s = document.createElement('script'); s.src = new URLSearchParams(location.search).get('late'); document.head.appendChild(s)">Load late</button>
<p id="out"></p>
<script src="/logpoints/app.js"></script>
</body></html>`;

/**
 * A `util.js` that returns its own name.
 *
 * @param name - `a` or `b`
 * @returns Script source
 */
function utilJs(name: string): string {
  return `function run${name.toUpperCase()}() {
  var which = '${name}';
  return which;
}
`;
}

/** The page with the two `util.js` */
const UTILS_HTML = `<!doctype html><html><head><title>logpoint utils</title></head><body>
<button id="both" onclick="runA(); runB()">Both</button>
<script src="/logpoints/a/util.js"></script>
<script src="/logpoints/b/util.js"></script>
</body></html>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/logpoints': LOGPOINTS_HTML,
  '/logpoints/app.js': APP_JS,
  '/logpoint-utils': UTILS_HTML,
  '/logpoints/a/util.js': utilJs('a'),
  '/logpoints/b/util.js': utilJs('b'),
};
