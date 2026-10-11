/**
 * Fixture page for the check that a mouse press reached the clicked element
 * (#582), served by the fixture server: `/press-check` has buttons in
 * closed shadow roots, which the page's window never sees in an event path:
 * `Deep` two closed roots deep (`<x-deep>` → `<x-deep-inner>`), `Swap`,
 * whose root re-renders itself on `pointerdown` (the button is gone before
 * `mousedown`, so the browser sends no `click`; the press is noted in
 * `window.clicks` as `Swap pressed`), and `Guarded`, whose host's presses the page stops in a
 * capture listener on `document`; `Open` in an open root; and buttons that a
 * shield covers as the mouse moves onto them, so the press lands on the
 * shield, which reacts to it (counts it in `window.shieldPresses` and adds
 * text to the page): `Shielded`, covered by `div#inner-shield` inside its
 * closed root (`<x-shield>`), `Nested`, in `<x-nest-inner>`'s closed root
 * inside `<x-nest>`'s and covered by `div#nest-shield` in the outer root,
 * `Under`, in `<x-under>`'s closed root and
 * covered by `div#outer-shield` in the document, and the light `#light`,
 * covered by `div#light-shield`. `#rerender` (`Rerender`) replaces itself right after its click
 * ran, so a click that arrived must still count as clicked (#641). `#gone-pointerdown`, `#gone-mousedown` and `#gone-pointerup` remove themselves on that event, and `#option` inserts a `picked` span and removes itself on `pointerdown`: handlers that ran and unmounted, which are no replacement (#641). `#item-1` removes itself on `pointerdown` while its sibling `Item 10` slides under the mouse, and `#follow` is replaced on `pointerdown` by a `Following` button: label-changing cases that are not reported. `Swap` re-renders an identical button, as a React remount does. `#park` is a corner to rest the mouse on
 * before the page loads again, so no shield appears before a click moves
 * the mouse. Every button counts its clicks in `window.clicks`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Buttons in closed, nested and open roots, and ones a shield covers on mouse over */
const PRESS_CHECK_HTML = `<!doctype html><title>press check</title>
<style>
  body { margin: 0; }
  #park { position: fixed; left: 0; top: 0; width: 20px; height: 20px; }
  main { position: absolute; left: 100px; top: 100px; display: grid; grid-template-columns: repeat(4, 160px); gap: 40px; }
  #outer-shield, #light-shield { position: fixed; background: rgba(0, 0, 0, 0.2); }
</style>
<div id="park"></div>
<main>
  <x-deep></x-deep>
  <x-swap></x-swap>
  <x-guarded></x-guarded>
  <x-open></x-open>
  <x-shield></x-shield>
  <x-nest></x-nest>
  <x-under></x-under>
  <button id="light">Light</button>
  <div id="rerender-host"><button id="rerender">Rerender</button></div>
  <div id="unmounts">
    <button id="gone-pointerdown">GonePointerdown</button>
    <button id="gone-mousedown">GoneMousedown</button>
    <button id="gone-pointerup">GonePointerup</button>
    <button id="item-1">Item 1</button>
    <button id="item-10">Item 10</button>
    <button id="follow">Follow</button>
    <ul id="options"><li><button id="option">Option</button></li></ul>
  </div>
</main>
<p id="log"></p>
<script>
  window.clicks = [];
  window.shieldPresses = 0;
  const count = (button) => button.addEventListener('click', () => window.clicks.push(button.textContent));
  const noteShieldPress = () => {
    window.shieldPresses++;
    document.getElementById('log').textContent += 'shield pressed. ';
  };
  const cover = (target, shield) => {
    const rect = target.getBoundingClientRect();
    Object.assign(shield.style, {
      left: rect.left - 10 + 'px', top: rect.top - 10 + 'px',
      width: rect.width + 20 + 'px', height: rect.height + 20 + 'px'
    });
    shield.addEventListener('mousedown', noteShieldPress);
  };
  const closedRoot = (host, html) => {
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = html;
    root.querySelectorAll('button').forEach(count);
    return root;
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.target.localName === 'x-guarded') event.stopPropagation();
  }, true);
  document.addEventListener('mousedown', (event) => {
    if (event.target.localName === 'x-guarded') event.stopPropagation();
  }, true);
  customElements.define('x-deep-inner', class extends HTMLElement {
    constructor() { super(); closedRoot(this, '<button>Deep</button>'); }
  });
  customElements.define('x-deep', class extends HTMLElement {
    constructor() { super(); closedRoot(this, '<x-deep-inner></x-deep-inner>'); }
  });
  customElements.define('x-swap', class extends HTMLElement {
    constructor() {
      super();
      const root = closedRoot(this, '<button>Swap</button>');
      root.querySelector('button').addEventListener('pointerdown', () => {
        window.clicks.push('Swap pressed');
        root.innerHTML = '<button>Swap</button>';
        count(root.querySelector('button'));
      });
    }
  });
  customElements.define('x-guarded', class extends HTMLElement {
    constructor() { super(); closedRoot(this, '<button>Guarded</button>'); }
  });
  customElements.define('x-open', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<button>Open</button>';
      count(this.shadowRoot.querySelector('button'));
    }
  });
  customElements.define('x-shield', class extends HTMLElement {
    constructor() {
      super();
      const root = closedRoot(this, '<div style="position: relative"><button>Shielded</button></div>');
      const button = root.querySelector('button');
      button.addEventListener('mouseover', () => {
        const shield = document.createElement('div');
        shield.id = 'inner-shield';
        shield.style.position = 'fixed';
        cover(button, shield);
        root.firstElementChild.append(shield);
      }, { once: true });
    }
  });
  customElements.define('x-nest-inner', class extends HTMLElement {
    constructor() { super(); closedRoot(this, '<button>Nested</button>'); }
  });
  customElements.define('x-nest', class extends HTMLElement {
    constructor() {
      super();
      const root = closedRoot(this, '<x-nest-inner></x-nest-inner>');
      const inner = root.querySelector('x-nest-inner');
      inner.addEventListener('mouseover', () => {
        const shield = document.createElement('div');
        shield.id = 'nest-shield';
        shield.style.position = 'fixed';
        cover(inner, shield);
        root.append(shield);
      }, { once: true });
    }
  });
  customElements.define('x-under', class extends HTMLElement {
    constructor() {
      super();
      const button = closedRoot(this, '<button>Under</button>').querySelector('button');
      button.addEventListener('mouseover', () => {
        const shield = document.createElement('div');
        shield.id = 'outer-shield';
        cover(button, shield);
        document.body.append(shield);
      }, { once: true });
    }
  });
  const rerender = document.getElementById('rerender');
  rerender.addEventListener('click', () => {
    window.clicks.push('Rerender clicked');
    document.getElementById('rerender-host').innerHTML = '<button>Rerendered</button>';
  });
  for (const [id, type] of [['gone-pointerdown', 'pointerdown'], ['gone-mousedown', 'mousedown'], ['gone-pointerup', 'pointerup']]) {
    const button = document.getElementById(id);
    button.addEventListener(type, () => {
      window.clicks.push(id + ' ran');
      button.remove();
    });
  }
  document.getElementById('item-1').addEventListener('pointerdown', (event) => {
    window.clicks.push('item-1 ran');
    event.currentTarget.remove();
  });
  const follow = document.getElementById('follow');
  follow.addEventListener('pointerdown', () => {
    window.clicks.push('follow ran');
    const following = document.createElement('button');
    following.textContent = 'Following';
    follow.replaceWith(following);
  });
  const option = document.getElementById('option');
  option.addEventListener('pointerdown', () => {
    window.clicks.push('option ran');
    const picked = document.createElement('span');
    picked.textContent = 'picked';
    option.parentNode.append(picked);
    option.remove();
  });
  const light = document.getElementById('light');
  count(light);
  light.addEventListener('mouseover', () => {
    const shield = document.createElement('div');
    shield.id = 'light-shield';
    cover(light, shield);
    document.body.append(shield);
  }, { once: true });
</script>`;

/** Press check pages by path */
export const ROUTES: FixtureRoutes = {
  '/press-check': PRESS_CHECK_HTML,
};
