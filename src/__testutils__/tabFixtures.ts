/**
 * Fixture pages for tabs and windows, served by the fixture server:
 * `/tabs` opens `/tabs-popup` with `window.open()` (a popup that can reach
 * its opener) and `/tabs-tab` through a `target=_blank` link (a tab that
 * cannot), and shows the message its popup posts back; `/tabs-popup` posts
 * `token-123` to its opener and closes itself when its button is clicked,
 * like an OAuth or SSO window. `/tabs-loader` logs an error and fetches
 * `/tabs-data` as it loads, before bdg can switch to it; `/tabs-selfclose`
 * is a window the test makes close itself on a timer, like a window that
 * closes on its own.
 */

/** The opener */
const TABS_HTML = `<!doctype html><title>Opener</title>
<button id="open-popup" onclick="window.open('/tabs-popup', 'signin', 'width=420,height=520')">Sign in</button>
<a id="open-tab" href="/tabs-tab" target="_blank">Terms</a>
<button id="open-loader" onclick="window.open('/tabs-loader', 'loader', 'width=420,height=520')">Load</button>
<button id="open-selfclose" onclick="window.open('/tabs-selfclose', 'selfclose', 'width=420,height=520')">Timer</button>
<p id="token">none</p>
<script>
  addEventListener('message', (event) => {
    document.getElementById('token').textContent = String(event.data);
  });
</script>`;

/** A sign-in window that reports back and closes */
const TABS_POPUP_HTML = `<!doctype html><title>Sign in</title>
<h1>Sign in</h1>
<button id="allow" onclick="window.opener.postMessage('token-123', '*'); window.close()">Allow</button>`;

/** A page opened in a new tab */
const TABS_TAB_HTML = `<!doctype html><title>Terms</title><h1 id="terms">Terms</h1>`;

/** A window that logs an error and sends a request while it loads, then tells its opener */
const TABS_LOADER_HTML = `<!doctype html><title>Loader</title>
<h1>Loader</h1>
<script>
  console.error('loader failed while loading');
  fetch('/tabs-data').then(() => window.opener.postMessage('loader-ready', '*'));
</script>`;

/** A window the test makes close itself on a timer */
const TABS_SELFCLOSE_HTML = `<!doctype html><title>Self-closing</title>
<h1 id="selfclose">Closing soon</h1>`;

/** Pages by path */
export const TAB_ROUTES: Record<string, string> = {
  '/tabs': TABS_HTML,
  '/tabs-popup': TABS_POPUP_HTML,
  '/tabs-tab': TABS_TAB_HTML,
  '/tabs-loader': TABS_LOADER_HTML,
  '/tabs-selfclose': TABS_SELFCLOSE_HTML,
  '/tabs-data': '{"ok":true}',
};
