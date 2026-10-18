/**
 * Fixture page for a message snapshot that runs out of budget (#529, #853),
 * served by the fixture server.
 *
 * - `/messages-budget`: `#show` appends `#wrap-flash`, a container whose own
 *   text is the message of its inner `#inner-flash`, and after it an unrelated
 *   `#other-flash`. The test makes the snapshot's budget run out after a
 *   number of candidates (`BDG_TEST_MESSAGES_BUDGET_CANDIDATES`), not after
 *   milliseconds, so the page needs no costly tail and the result does not
 *   depend on the machine: 1 candidate keeps the container before the inner
 *   message is examined, 0 spends the budget before anything is kept. In both
 *   cases only the inner message may be reported, and `#other-flash`, which
 *   lies outside the last message kept, must stay unexamined.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A button appending a flash container with its message and an unrelated flash after it */
const MESSAGES_BUDGET_HTML = `<!doctype html><title>messages budget</title>
<button id="show">Show</button>
<script>
  document.getElementById('show').addEventListener('click', () => {
    const wrap = document.createElement('div');
    wrap.id = 'wrap-flash';
    wrap.innerHTML = '<div id="inner-flash" class="flash error">Your password is invalid!</div>';
    const other = document.createElement('div');
    other.id = 'other-flash';
    other.className = 'flash';
    other.textContent = 'Saved';
    document.body.append(wrap, other);
  });
</script>`;

export const ROUTES: FixtureRoutes = {
  '/messages-budget': MESSAGES_BUDGET_HTML,
};
