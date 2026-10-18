/**
 * Fixture page for source maps written by esbuild (#848, part 2), served by
 * the fixture server: the bundle and map are what
 * `esbuild --bundle --minify-whitespace --minify-syntax --sourcemap` wrote for
 * three TypeScript files (`src/cart.ts`, `src/discount.ts`, `src/main.ts`),
 * one line of minified code, copied as they came.
 *
 * - `/sm-esbuild/shop`: a checkout button and a coupon button (`#coupon`).
 *   `discountFor` returns 0 without a coupon (`if(!cart2.coupon)return 0;`)
 *   and the next statement, `let rate=...`, starts where that `return` ends.
 * - {@link DISCOUNT_LINES} numbers the original lines of `src/discount.ts`.
 * - `/sm-esbuild/lone`: another esbuild bundle (same flags) of `src/lone.ts`,
 *   functions whose only statement is a `return` (`single`, `triple`), one
 *   that esbuild folds into a conditional (`twice`); {@link LONE_LINES}
 *   numbers its original lines.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Lines of `src/discount.ts` (original, 1-based) */
export const DISCOUNT_LINES = {
  /** `if (!cart.coupon) return 0;` */
  guard: 4,
  /** `const rate = cart.coupon.percent / 10;`: runs only with a coupon */
  rate: 5,
  /** `return subtotal * rate;` */
  result: 6,
} as const;

/** Lines of `src/lone.ts` (original, 1-based) */
export const LONE_LINES = {
  /** `return d * 3;`, the only statement of `triple` */
  triple: 2,
  /** `return d * 2;` in `twice`, folded into `d>1?1:d*2` */
  twice: 14,
  /** `}` closing `twice`: compiled to nothing of its own */
  closeTwice: 15,
  /** `return d * 3;`, the only statement of `single` */
  single: 19,
} as const;

const BUNDLE =
  '(()=>{function lineTotal(item){return item.price*item.qty}function subtotalOf(cart2){let subtotal=0;for(let item of cart2.items)subtotal+=lineTotal(item);return subtotal}function discountFor(cart2,subtotal){if(!cart2.coupon)return 0;let rate=cart2.coupon.percent/10;return subtotal*rate}var cart={items:[],shipping:0,coupon:null};function computeTotal(current){let subtotal=subtotalOf(current),discount=discountFor(current,subtotal),total=subtotal-discount+current.shipping;return Math.round(total*100)/100}fetch("cart.json").then(r=>r.json()).then(data=>{cart={...cart,...data}});document.getElementById("coupon").addEventListener("click",()=>{cart.coupon={code:"SAVE10",percent:10}});document.getElementById("checkout").addEventListener("click",()=>{document.getElementById("total").textContent=computeTotal(cart).toFixed(2)});})();\n//# sourceMappingURL=app.js.map\n';

const MAP =
  '{\n  "version": 3,\n  "sources": ["../../../private/tmp/s23-sm/src/cart.ts", "../../../private/tmp/s23-sm/src/discount.ts", "../../../private/tmp/s23-sm/src/main.ts"],\n  "sourcesContent": ["export interface Item { name: string; price: number; qty: number }\\nexport interface Cart { items: Item[]; shipping: number; coupon: Coupon | null }\\nexport interface Coupon { code: string; percent: number }\\n\\nexport function lineTotal(item: Item): number {\\n  const price = item.price * item.qty;\\n  return price;\\n}\\n\\nexport function subtotalOf(cart: Cart): number {\\n  let subtotal = 0;\\n  for (const item of cart.items) subtotal += lineTotal(item);\\n  return subtotal;\\n}\\n", "import type { Cart } from \'./cart\';\\n\\nexport function discountFor(cart: Cart, subtotal: number): number {\\n  if (!cart.coupon) return 0;\\n  const rate = cart.coupon.percent / 10;\\n  return subtotal * rate;\\n}\\n", "import { type Cart, subtotalOf } from \'./cart\';\\nimport { discountFor } from \'./discount\';\\n\\nlet cart: Cart = { items: [], shipping: 0, coupon: null };\\n\\nfunction computeTotal(current: Cart): number {\\n  const subtotal = subtotalOf(current);\\n  const discount = discountFor(current, subtotal);\\n  const total = subtotal - discount + current.shipping;\\n  return Math.round(total * 100) / 100;\\n}\\n\\nfetch(\'cart.json\')\\n  .then((r) => r.json())\\n  .then((data: Partial<Cart>) => {\\n    cart = { ...cart, ...data };\\n  });\\n\\ndocument.getElementById(\'coupon\')!.addEventListener(\'click\', () => {\\n  cart.coupon = { code: \'SAVE10\', percent: 10 };\\n});\\ndocument.getElementById(\'checkout\')!.addEventListener(\'click\', () => {\\n  document.getElementById(\'total\')!.textContent = computeTotal(cart).toFixed(2);\\n});\\n"],\n  "mappings": "MAIO,SAAS,UAAU,KAAoB,CAE5C,OADc,KAAK,MAAQ,KAAK,GAElC,CAEO,SAAS,WAAWA,MAAoB,CAC7C,IAAI,SAAW,EACf,QAAW,QAAQA,MAAK,MAAO,UAAY,UAAU,IAAI,EACzD,OAAO,QACT,CCXO,SAAS,YAAYC,MAAY,SAA0B,CAChE,GAAI,CAACA,MAAK,OAAQ,MAAO,GACzB,IAAM,KAAOA,MAAK,OAAO,QAAU,GACnC,OAAO,SAAW,IACpB,CCHA,IAAI,KAAa,CAAE,MAAO,CAAC,EAAG,SAAU,EAAG,OAAQ,IAAK,EAExD,SAAS,aAAa,QAAuB,CAC3C,IAAM,SAAW,WAAW,OAAO,EAC7B,SAAW,YAAY,QAAS,QAAQ,EACxC,MAAQ,SAAW,SAAW,QAAQ,SAC5C,OAAO,KAAK,MAAM,MAAQ,GAAG,EAAI,GACnC,CAEA,MAAM,WAAW,EACd,KAAM,GAAM,EAAE,KAAK,CAAC,EACpB,KAAM,MAAwB,CAC7B,KAAO,CAAE,GAAG,KAAM,GAAG,IAAK,CAC5B,CAAC,EAEH,SAAS,eAAe,QAAQ,EAAG,iBAAiB,QAAS,IAAM,CACjE,KAAK,OAAS,CAAE,KAAM,SAAU,QAAS,EAAG,CAC9C,CAAC,EACD,SAAS,eAAe,UAAU,EAAG,iBAAiB,QAAS,IAAM,CACnE,SAAS,eAAe,OAAO,EAAG,YAAc,aAAa,IAAI,EAAE,QAAQ,CAAC,CAC9E,CAAC",\n  "names": ["cart", "cart"]\n}\n';

const CART =
  '{"items":[{"name":"Mug","price":12.5,"qty":2},{"name":"Tea","price":4.25,"qty":3}],"shipping":499}\n';

const SHOP_HTML = `<!doctype html><title>Shop</title>
<h1>Cart</h1><p>2 x Mug (12.50), 3 x Tea (4.25)</p>
<p>Total: <span id="total">-</span></p>
<button id="checkout">Checkout</button> <button id="coupon">Apply coupon SAVE10</button>
<script src="dist/app.js?v=7"></script>`;

const LONE_BUNDLE =
  '(()=>{function triple(d){return d*3}var arrow=d=>d*3,K=class{m(d){return d*3}};function twice(d){return d>1?1:d*2}function single(d){return d*3}window.fns=[triple,arrow,K,twice,single];})();\n//# sourceMappingURL=lone.js.map\n';

const LONE_MAP =
  '{\n  "version": 3,\n  "sources": ["../src/lone.ts"],\n  "sourcesContent": ["export function triple(d: number): number {\\n  return d * 3;\\n}\\nexport const arrow = (d: number): number => {\\n  return d * 3;\\n};\\nexport class K {\\n  m(d: number): number {\\n    return d * 3;\\n  }\\n}\\nexport function twice(d: number): number {\\n  if (d > 1) return 1;\\n  return d * 2;\\n}\\nexport function single(d: number): number {\\n\\n  // comment\\n  return d * 3;\\n}\\n(window as any).fns = [triple, arrow, K, twice, single];\\n"],\n  "mappings": "MAAO,SAAS,OAAO,EAAmB,CACxC,OAAO,EAAI,CACb,CACO,IAAM,MAAS,GACb,EAAI,EAEA,EAAN,KAAQ,CACb,EAAE,EAAmB,CACnB,OAAO,EAAI,CACb,CACF,EACO,SAAS,MAAM,EAAmB,CACvC,OAAI,EAAI,EAAU,EACX,EAAI,CACb,CACO,SAAS,OAAO,EAAmB,CAGxC,OAAO,EAAI,CACb,CACC,OAAe,IAAM,CAAC,OAAQ,MAAO,EAAG,MAAO,MAAM",\n  "names": []\n}\n';

const LONE_HTML = `<!doctype html><title>Lone returns</title>
<button id="triple" onclick="window.fns[0](5)">triple</button>
<button id="twice" onclick="window.fns[3](1)">twice</button>
<button id="single" onclick="window.fns[4](7)">single</button>
<script src="dist/lone.js"></script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/sm-esbuild/shop': SHOP_HTML,
  '/sm-esbuild/dist/app.js': BUNDLE,
  '/sm-esbuild/dist/app.js.map': MAP,
  '/sm-esbuild/cart.json': CART,
  '/sm-esbuild/lone': LONE_HTML,
  '/sm-esbuild/dist/lone.js': LONE_BUNDLE,
  '/sm-esbuild/dist/lone.js.map': LONE_MAP,
};
