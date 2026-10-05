/**
 * Fixture pages for frame order, promise rejections and framework
 * listeners, served by the fixture server: `/frame-order` has iframes whose
 * frame tree order differs from their document order (one in an open shadow
 * root, one cross-origin and out of process) and `addFirst()` inserts one
 * before them; `/rejections` rejects promises for `dom eval` and, from a
 * timer, without a handler; `/nested-react` mounts a React-like root inside
 * another (stub fibers); `/preact-listeners` has handlers behind a
 * Preact-like event proxy.
 */

/** Same-origin iframe content of `/frame-order` */
const FRAME_ORDER_CHILD_HTML = '<!doctype html><p>child</p>';

/**
 * Iframes in document order `shadowed`, `cross`, `last`; `last` is parsed
 * first, the others are added by the script, so Chrome's frame tree has
 * `last` first and the cross-origin one in its own session.
 */
const FRAME_ORDER_HTML = `<!doctype html><title>frame order</title>
<div id="slot"></div>
<div id="host"></div>
<span id="cross-slot"></span>
<iframe name="last" src="/frame-order-child"></iframe>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
    '<iframe name="shadowed" src="/frame-order-child"></iframe>';
  const cross = document.createElement('iframe');
  cross.name = 'cross';
  cross.src = 'http://localhost:' + location.port + '/frame-child';
  document.getElementById('cross-slot').replaceWith(cross);
  window.addFirst = () => new Promise((resolve) => {
    const first = document.createElement('iframe');
    first.name = 'first';
    first.onload = resolve;
    first.src = '/frame-order-child';
    document.getElementById('slot').append(first);
  });
</script>`;

/** Page with a function that returns a rejected promise */
const REJECTIONS_HTML = `<!doctype html><title>rejections</title>
<script>window.later = () => Promise.reject(new Error('page later'));</script>`;

/**
 * Stub of React 18 with nested roots: `#inner-btn` is rendered by a root
 * mounted on `#mount`, which the outer root renders inside
 * `section#outer-section` (with `onClick` and `onMouseEnter` props).
 */
const NESTED_REACT_HTML = `<!doctype html><title>nested react</title>
<div id="outer"><section id="outer-section"><div id="mount"><button id="inner-btn">Inner</button></div></section></div>
<script>
  const outer = document.getElementById('outer');
  const section = document.getElementById('outer-section');
  const mount = document.getElementById('mount');
  const button = document.getElementById('inner-btn');
  const outerRoot = { tag: 3, stateNode: { containerInfo: outer }, return: null };
  const sectionFiber = { type: 'section', stateNode: section, return: outerRoot };
  const mountFiber = { type: 'div', stateNode: mount, return: sectionFiber };
  const innerRoot = { tag: 3, stateNode: { containerInfo: mount }, return: null };
  outer.__reactContainer$o = outerRoot;
  mount.__reactContainer$i = innerRoot;
  section.__reactFiber$o = sectionFiber;
  section.__reactProps$o = { onClick: function outerClick() {}, onMouseEnter: function outerEnter() {} };
  mount.__reactFiber$o = mountFiber;
  button.__reactFiber$i = { type: 'button', stateNode: button, return: innerRoot };
  button.__reactProps$i = { onClick: function innerClick() {} };
</script>`;

/**
 * Handlers set like Preact 10 does: kept on the element under `l` by type
 * and capture flag, run by a shared proxy listener.
 */
const PREACT_LISTENERS_HTML = `<!doctype html><title>preact</title>
<div id="wrap"><button id="save">Save</button></div>
<script>
  window.ran = [];
  const proxy = (capture) => function (u) { if (this.l) { var t = this.l[u.type + capture]; return t(u); } };
  const bubble = proxy(false);
  const capturing = proxy(true);
  const save = document.getElementById('save');
  const wrap = document.getElementById('wrap');
  save.l = { clickfalse: function preactSave() { ran.push('save'); } };
  save.addEventListener('click', bubble, false);
  wrap.l = { clicktrue: function wrapCapture() { ran.push('wrap'); } };
  wrap.addEventListener('click', capturing, true);
</script>`;

/** Pages by path */
export const KNOWN_LIMIT_ROUTES: Record<string, string> = {
  '/frame-order': FRAME_ORDER_HTML,
  '/frame-order-child': FRAME_ORDER_CHILD_HTML,
  '/rejections': REJECTIONS_HTML,
  '/nested-react': NESTED_REACT_HTML,
  '/preact-listeners': PREACT_LISTENERS_HTML,
};
