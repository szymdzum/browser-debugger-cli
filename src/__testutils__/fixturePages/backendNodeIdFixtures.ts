/**
 * Fixture page for `backendNodeId` in `dom query` / `dom get --raw` (#465):
 * `/backend-node-id` has two paragraphs, a same-origin iframe (srcdoc) with
 * one paragraph and an open shadow root with one paragraph.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Paragraphs in the page, an iframe and a shadow root */
const BACKEND_NODE_ID_HTML = `<!doctype html><title>backend node id</title>
<p class="t">top one</p>
<p class="t">top two</p>
<iframe srcdoc="<p class='t'>in frame</p>"></iframe>
<div id="host"></div>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = "<p class='t'>in shadow</p>";</script>`;

/** backendNodeId pages by path */
export const ROUTES: FixtureRoutes = {
  '/backend-node-id': BACKEND_NODE_ID_HTML,
};
