/**
 * Fixture pages for the errors actions cause, served by the fixture server:
 * `/action-errors` logs an error and a warning as it loads and has controls
 * whose handlers throw (synchronously, from a timer, as an unhandled
 * rejection), log errors (repeated, several distinct ones, with a warning)
 * or link to `/action-errors-target`, which throws as it loads; a field
 * throws on input and on key presses, a box on hover, the window on scroll
 * and a form on submit.
 */

/** Page whose controls make errors */
const ACTION_ERRORS_HTML = `<!doctype html><title>action errors</title>
<button id="quiet" onclick="document.title = 'quiet clicked'">Quiet</button>
<button id="sync" onclick="throw new Error('sync exploded')">Sync</button>
<button id="async" onclick="setTimeout(() => { throw new Error('async exploded'); }, 0)">Async</button>
<button id="rejection" onclick="Promise.reject(new Error('rejected in handler'))">Rejection</button>
<button id="logged" onclick="for (let i = 0; i < 2; i++) console.error('logged boom'); console.warn('only a warning')">Logged</button>
<button id="many" onclick="['first', 'second', 'third', 'fourth'].forEach((text) => console.error(text + ' error'))">Many</button>
<a id="navigate" href="/action-errors-target">Navigate</a>
<input id="field" oninput="throw new Error('input exploded')" onkeydown="if (event.key === 'Enter') throw new Error('key exploded')">
<div id="hover-box" style="width: 100px; height: 40px" onmouseenter="throw new Error('hover exploded')">Hover</div>
<form id="form" onsubmit="event.preventDefault(); throw new Error('submit exploded')"><button>Send</button></form>
<div style="height: 3000px"></div>
<script>
  console.error('on load error');
  console.warn('on load warning');
  addEventListener('scroll', () => { throw new Error('scroll exploded'); }, { once: true });
</script>`;

/** Page that throws as it loads */
const ACTION_ERRORS_TARGET_HTML = `<!doctype html><title>action errors target</title>
<script>throw new Error('new page exploded');</script>
<p>Target</p>`;

/** Pages by path */
export const ACTION_ERROR_ROUTES: Record<string, string> = {
  '/action-errors': ACTION_ERRORS_HTML,
  '/action-errors-target': ACTION_ERRORS_TARGET_HTML,
};
