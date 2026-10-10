/**
 * Fixture page for the closed shadow host check of "not found" errors,
 * served by the fixture server: `/closed-shadow-late` has 25 defined custom
 * elements without a shadow root (`<x-light>`) before `<x-late>`, whose
 * closed shadow root holds a field, so the check stops before reaching it.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** More custom elements than the closed host check reads, then a closed host */
const CLOSED_SHADOW_LATE_HTML = `<!doctype html><title>closed shadow late</title>
${'<x-light>light</x-light>\n'.repeat(25)}<x-late></x-late>
<script>
  customElements.define('x-light', class extends HTMLElement {});
  customElements.define('x-late', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'closed' }).innerHTML = '<input name="late">';
    }
  });
</script>`;

/** Closed shadow host check pages by path */
export const ROUTES: FixtureRoutes = {
  '/closed-shadow-late': CLOSED_SHADOW_LATE_HTML,
};
