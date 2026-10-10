/**
 * Fixture page for the check that a mouse press reached the clicked element
 * (#582), served by the fixture server: `/press-check` has buttons in
 * closed shadow roots, which the page's window never sees in an event path:
 * `Deep` two closed roots deep (`<x-deep>` → `<x-deep-inner>`), `Swap`,
 * whose root re-renders itself on `pointerdown` (the button is gone before
 * `mousedown`), and `Guarded`, whose host's presses the page stops in a
 * capture listener on `document`; `Open` in an open root; and buttons that a
 * shield covers as the mouse moves onto them, so the press lands on the
 * shield, which reacts to it (counts it in `window.shieldPresses` and adds
 * text to the page): `Shielded`, covered by `div#inner-shield` inside its
 * closed root (`<x-shield>`), `Under`, in `<x-under>`'s closed root and
 * covered by `div#outer-shield` in the document, and the light `#light`,
 * covered by `div#light-shield`. `#park` is a corner to rest the mouse on
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
  <x-under></x-under>
  <button id="light">Light</button>
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
        root.innerHTML = '<button>Swapped</button>';
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
