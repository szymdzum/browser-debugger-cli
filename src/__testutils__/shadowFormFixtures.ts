/**
 * Fixture pages for forms rendered by web components, served by the fixture
 * server: `/shadow-forms` has a login form in `<x-login>`'s open shadow root
 * (labels by `for` inside the root, a password and a PIN field), a
 * newsletter form two open shadow roots deep (`<x-outer>` → `<x-inner>`), a
 * light form whose field is a component with its input in its shadow root
 * (`<x-field>`, like Shoelace's `<sl-input>`), a card form in `<x-vault>`'s
 * closed shadow root, and `<x-search-modal>`, whose open shadow root gets its
 * search form only when the Search button is clicked (like MDN's
 * `<mdn-search-modal>`); `/shadow-fields` has form-less fields in an open
 * shadow root only.
 */

/** Forms in open, nested and closed shadow roots, and one rendered on demand */
const SHADOW_FORMS_HTML = `<!doctype html><title>shadow forms</title>
<label for="pw">Light label</label>
<main>
<x-login></x-login>
<x-outer></x-outer>
<form id="profile" onsubmit="event.preventDefault()"><x-field></x-field><button>Save</button></form>
<x-vault></x-vault>
<button id="open-search" onclick="document.querySelector('x-search-modal').open()">Search</button>
<x-search-modal></x-search-modal>
</main>
<script>
  window.submitted = [];
  customElements.define('x-login', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<form id="login"><label>Email <input name="email" type="email" required></label>' +
        '<label for="pw">Your passphrase</label><input id="pw" name="password" type="password" value="Hunter2Secret">' +
        '<label for="pin">Card code</label><input id="pin" name="pin" value="4321">' +
        '<button>Go</button></form>';
      root.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitted.push('login:' + root.querySelector('[name=email]').value);
      });
    }
  });
  customElements.define('x-inner', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<form aria-label="Newsletter" onsubmit="event.preventDefault()">' +
        '<span id="nl-label">Newsletter email</span><input name="nl-email" aria-labelledby="nl-label">' +
        '<label for="nl-name">Name *</label><input id="nl-name" name="nl-name">' +
        '<button type="submit">Subscribe</button></form>';
    }
  });
  customElements.define('x-outer', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<x-inner></x-inner>';
    }
  });
  customElements.define('x-field', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<label for="f">City</label><input id="f" name="city">';
    }
  });
  customElements.define('x-vault', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'closed' }).innerHTML = '<form><input name="card-holder"><button>Pay</button></form>';
    }
  });
  customElements.define('x-search-modal', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    open() {
      this.shadowRoot.innerHTML = '<dialog open><form method="get" action="/search">' +
        '<input type="search" name="q" aria-label="Search"></form></dialog>';
    }
  });
</script>`;

/** Form-less fields in an open shadow root only */
const SHADOW_FIELDS_HTML = `<!doctype html><title>shadow fields</title>
<x-filter></x-filter>
<script>
  customElements.define('x-filter', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<label>Filter <input name="filter" required></label><button>Apply</button>';
    }
  });
</script>`;

/** Shadow root form pages by path */
export const SHADOW_FORM_ROUTES: Record<string, string> = {
  '/shadow-forms': SHADOW_FORMS_HTML,
  '/shadow-fields': SHADOW_FIELDS_HTML,
};
