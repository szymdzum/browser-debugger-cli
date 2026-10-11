/**
 * Fixture pages for action outcomes that used to look like nothing happened
 * (#593), served by the fixture server. `/redspan` has a contact form whose
 * `type=button` "Send" (`#redspan-go`) appends a plain red `<span>`
 * ("Something went wrong", no role or class) to the form, which also holds a
 * password field with a value; a button (`#sending`) whose click handler
 * disables it and sets its text to "Sending…"; a `type=button` (`#plain`)
 * whose click handler only notes the click in `window.clicks`; and a search
 * form (`#lookup`) whose submit handler cancels the submit and notes the
 * query in `window.lookups` (submitted by JS, no navigation).
 * `/tracker-errors` has `#track`, which logs two console errors from
 * scripts named as tracker URLs (`//# sourceURL=` on
 * googletagmanager.com and google-analytics.com, hosts the default tracking
 * filter drops), one from the page itself, and starts a request to a tracker
 * host (dropped at capture whatever its outcome); and `#dupes`, which logs
 * the same error from two scripts named `/one/event?a=1` and `/two/event?b=2`
 * on the fixture's own origin (both shortened to `event`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Handlers whose outcomes are a new plain text, a changed button, a click by key, a JS submit */
const REDSPAN_HTML = `<!doctype html><meta charset="utf-8"><title>action outcomes</title>
<form id="contact"><input name="email"><input name="password" type="password" value="Hunter2Secret">
  <button type="button" id="redspan-go">Send</button></form>
<div id="sender"><button type="button" id="sending">Send</button></div>
<button type="button" id="plain">Plain</button>
<form id="lookup"><input name="q"><button id="lookup-go">Find</button></form>
<script>
  window.clicks = [];
  window.lookups = [];
  document.getElementById('redspan-go').addEventListener('click', () => {
    const span = document.createElement('span');
    span.style.color = 'red';
    span.textContent = 'Something went wrong';
    document.getElementById('contact').append(span);
  });
  document.getElementById('sending').addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Sending…';
  });
  document.getElementById('plain').addEventListener('click', () => window.clicks.push('plain'));
  document.getElementById('lookup').addEventListener('submit', (event) => {
    event.preventDefault();
    window.lookups.push(event.target.q.value);
  });
</script>`;

/** Console errors from tracker scripts and from scripts with the same short name */
const TRACKER_ERRORS_HTML = `<!doctype html><title>tracker errors</title>
<button id="track">Track</button>
<button id="dupes">Dupes</button>
<script>
  const run = (code, url) => eval(code + '\\n//# sourceURL=' + url);
  document.getElementById('track').addEventListener('click', () => {
    run("console.error('tracker failed')", 'https://www.googletagmanager.com/gtm.js');
    run("console.error('tracker failed')", 'https://www.google-analytics.com/collect');
    console.error('app failed');
    fetch('https://www.google-analytics.com/collect', { mode: 'no-cors' }).catch(() => {});
  });
  document.getElementById('dupes').addEventListener('click', () => {
    run("console.error('beacon failed')", location.origin + '/one/event?a=1');
    run("console.error('beacon failed')", location.origin + '/two/event?b=2');
  });
</script>`;

/** Action outcome pages by path */
export const ROUTES: FixtureRoutes = {
  '/redspan': REDSPAN_HTML,
  '/tracker-errors': TRACKER_ERRORS_HTML,
};
