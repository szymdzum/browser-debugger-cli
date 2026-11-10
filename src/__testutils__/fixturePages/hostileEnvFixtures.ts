/**
 * Fixture pages for the hostile-environment smoke tests, served by the
 * fixture server.
 *
 * - `/hostile?case=NAME&perturb=NAME`: one page per action with a known
 *   outcome (`CASES` in the script: `click-sync`, `fill-keep`, `wait-text`,
 *   ...), run under a perturbation of the page's own runtime. The page keeps
 *   its own behaviour on the real timers (`later`) while the perturbation
 *   replaces `window.setTimeout` and `window.setInterval`: `none` (the
 *   control), `frozenTimers` (as fake timers freeze them) and `slowTimers`
 *   (every timer fires 1 s late, as in a throttled background tab).
 * - `/hostile-api`: what `click-fetch` loads (`Loaded 456`).
 * - `/hostile-done`: where `click-nav` and the submit cases navigate to.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Page script: the cases, the perturbations and the wiring chosen by the query */
const HOSTILE_SCRIPT = `
const params = new URLSearchParams(location.search);
const realST = window.setTimeout.bind(window);
const realSI = window.setInterval.bind(window);
const later = (fn, ms) => realST(fn, ms);
const add = (id, text) => {
  const p = document.createElement('p');
  p.id = id;
  p.textContent = text;
  document.body.appendChild(p);
};
const PERTURBATIONS = {
  none: () => {},
  frozenTimers: () => {
    window.setTimeout = () => 0;
    window.setInterval = () => 0;
  },
  slowTimers: () => {
    window.setTimeout = (fn, ms, ...args) => realST(fn, (ms || 0) + 1000, ...args);
    window.setInterval = (fn, ms, ...args) => realSI(fn, Math.max(ms || 0, 1000), ...args);
  },
};
const CASES = {
  'fill-keep': { body: '<input id="f">', setup: () => {} },
  'fill-replace': {
    body: '<input id="f">',
    setup: (f) => f.addEventListener('input', () => later(() => { f.value = 'draft-9f3ac2'; }, 300)),
  },
  'fill-restore': {
    body: '<input id="f" value="old value">',
    setup: (f) => f.addEventListener('input', () => later(() => { f.value = 'old value'; }, 300)),
  },
  'fill-reject-sync': {
    body: '<input id="f">',
    setup: (f) => f.addEventListener('input', () => { f.value = ''; }),
  },
  'click-sync': { body: '<button id="b">Save</button>', setup: (f, b) => { b.onclick = () => add('r', 'Saved 123'); } },
  'click-noop': { body: '<button id="b">Save</button>', setup: () => {} },
  'click-late': { body: '<button id="b">Save</button>', setup: (f, b) => { b.onclick = () => later(() => add('r', 'Saved 123'), 250); } },
  'click-value': {
    body: '<button id="b">Set</button><input id="f">',
    setup: (f, b) => { b.onclick = () => { f.value = 'set by click'; }; },
  },
  'click-fetch': {
    body: '<button id="b">Load</button>',
    setup: (f, b) => { b.onclick = () => fetch('/hostile-api').then((r) => r.text()).then((t) => add('r', t)); },
  },
  'click-nav': { body: '<a id="b" href="/hostile-done">Go</a>', setup: () => {} },
  'press-enter': {
    body: '<input id="f">',
    setup: (f) => f.addEventListener('keydown', (e) => { if (e.key === 'Enter') add('r', 'Entered'); }),
  },
  'submit-ok': {
    body: '<form action="/hostile-done"><input name="q" value="x"><button id="s" type="submit">Send</button></form>',
    setup: () => {},
  },
  'submit-blocked': {
    body: '<form action="/hostile-done"><input name="q" required><button id="s" type="submit">Send</button></form>',
    setup: () => {},
  },
  'wait-appears': { body: '<p>start</p>', setup: () => later(() => add('late', 'here'), 600) },
  'wait-text': {
    body: '<p id="s">Loading</p>',
    setup: () => later(() => { document.getElementById('s').textContent = 'Ready'; }, 600),
  },
  'wait-never': { body: '<p>start</p>', setup: () => {} },
};
const chosen = CASES[params.get('case')];
document.title = 'hostile ' + params.get('case') + ' ' + params.get('perturb');
document.body.innerHTML = chosen.body;
PERTURBATIONS[params.get('perturb')]();
chosen.setup(document.getElementById('f'), document.getElementById('b'));
`;

/** Hostile-environment pages by path */
export const ROUTES: FixtureRoutes = {
  '/hostile': `<!doctype html><title>hostile</title><body></body><script>(() => {${HOSTILE_SCRIPT}})();</script>`,
  '/hostile-api': 'Loaded 456',
  '/hostile-done': '<!doctype html><title>done</title><p>done</p>',
};
