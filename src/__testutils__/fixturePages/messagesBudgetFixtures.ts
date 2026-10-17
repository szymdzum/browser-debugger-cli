/**
 * Fixture page for a message snapshot that runs out of time (#529), served by
 * the fixture server.
 *
 * - `/messages-budget`: `#show` appends `#wrap-flash`, a container whose own
 *   text is the message of its inner `#inner-flash`, followed by thousands of
 *   hidden text nodes. Reading the container's text takes longer than the
 *   snapshot's time budget, so the container is kept before the inner
 *   message is examined.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Hidden text nodes after the message, enough to outlast the snapshot's budget */
const HIDDEN_NODES = 100000;

/** A button appending a flash container with its message and a costly hidden tail */
const MESSAGES_BUDGET_HTML = `<!doctype html><title>messages budget</title>
<button id="show">Show</button>
<script>
  document.getElementById('show').addEventListener('click', () => {
    const wrap = document.createElement('div');
    wrap.id = 'wrap-flash';
    wrap.innerHTML = '<div id="inner-flash" class="flash error">Your password is invalid!</div>';
    const tail = document.createElement('div');
    tail.hidden = true;
    for (let i = 0; i < ${HIDDEN_NODES}; i++) tail.append(document.createTextNode('x'));
    wrap.append(tail);
    document.body.append(wrap);
  });
</script>`;

export const ROUTES: FixtureRoutes = {
  '/messages-budget': MESSAGES_BUDGET_HTML,
};
