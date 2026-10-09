/**
 * Fixture pages for JavaScript dialogs, served by the fixture server:
 * `/dialogs` has buttons that open a confirm, a prompt and an alert and keep
 * what the page got (`window.confirmed`, `window.answered`), a field whose
 * key presses open a confirm (`window.keyConfirmed`), and a link to
 * `/dialogs-load` that a beforeunload handler guards while `window.guard` is
 * set; `/dialogs-load` opens a confirm while it loads (`window.loaded`).
 */

/** Buttons that open dialogs, and a link guarded by beforeunload */
const DIALOGS_HTML = `<!doctype html><title>dialogs</title>
<button id="conf" onclick="window.confirmed = confirm('Sure?')">Delete</button>
<button id="ask" onclick="window.answered = prompt('Name?')">Rename</button>
<button id="note" onclick="alert('Saved')">Save</button>
<input id="key" onkeydown="window.keyConfirmed = confirm('Key?')">
<a id="leave" href="/dialogs-load">Leave</a>
<script>
  window.addEventListener('beforeunload', (event) => {
    if (!window.guard) return;
    event.preventDefault();
    event.returnValue = '';
  });
</script>`;

/** A page that asks for confirmation while it loads */
const DIALOGS_LOAD_HTML = `<!doctype html><title>dialogs on load</title>
<p id="loaded">Loaded</p>
<script>window.loaded = confirm('Continue loading?');</script>`;

/** Dialog pages by path */
export const DIALOG_ROUTES: Record<string, string> = {
  '/dialogs': DIALOGS_HTML,
  '/dialogs-load': DIALOGS_LOAD_HTML,
};
