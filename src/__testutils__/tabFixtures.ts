/**
 * Fixture pages for tabs and windows, served by the fixture server:
 * `/tabs` opens `/tabs-popup` with `window.open()` (a popup that can reach
 * its opener) and `/tabs-tab` through a `target=_blank` link (a tab that
 * cannot), and shows the message its popup posts back; `/tabs-popup` posts
 * `token-123` to its opener and closes itself when its button is clicked,
 * like an OAuth or SSO window.
 */

/** The opener */
const TABS_HTML = `<!doctype html><title>Opener</title>
<button id="open-popup" onclick="window.open('/tabs-popup', 'signin', 'width=420,height=520')">Sign in</button>
<a id="open-tab" href="/tabs-tab" target="_blank">Terms</a>
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

/** Pages by path */
export const TAB_ROUTES: Record<string, string> = {
  '/tabs': TABS_HTML,
  '/tabs-popup': TABS_POPUP_HTML,
  '/tabs-tab': TABS_TAB_HTML,
};
