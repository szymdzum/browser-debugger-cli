/**
 * Option behaviors of the DOM actions (fill, click, hover, pressKey, submit, scroll), `bdg dom wait` and `bdg page navigate`.
 */

import type { OptionBehavior } from '@/commands/helpJson.js';
import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** What DOM actions report about the network requests they triggered */
const TRIGGERED_REQUESTS_BEHAVIOR =
  'Requests (and WebSocket connections) that start after the action begins are returned as triggeredRequests (method, url, status, durationMs; pending when still running at return, loading when the response arrived but its body is still streaming; with resourceType; human output lists documents, XHR/fetch and WebSockets first (up to 10) and counts static assets on one line; absent when network telemetry is off). Attribution is by time: requests a page timer or poller starts meanwhile are listed too, whether or not the action caused them';

/** What every DOM action reports about the console errors it caused */
const ACTION_ERRORS_BEHAVIOR =
  'Console errors and uncaught exceptions bdg received from the start of the action until its result was read (console.error, failed console.assert, throws in handlers and in timers they set, unhandled rejections, browser errors such as failed loads, from the page, its iframes and workers, and errors of a page it navigated to) are listed as Errors: <text> (<file>:<line>:<col>), [Nx] for repeats; JSON errors [{ text, source: "url:line:col", count }], at most 3 distinct ones, grouped by text and source like bdg console, with "+N more (bdg console --level error)" and moreErrors for the rest; absent when none. Errors logged before the action and warnings are left out; attribution is by arrival (not Chrome\'s clock), so an error a page timer or poller logs meanwhile is listed too. A failed action (target not found, not fillable, refused) has no errors: it fails before the page\'s handlers run, and a throwing handler does not make it fail. Read from console telemetry (none when it is off), without waiting';

/** What every DOM action reports about the page besides its requests */
const ACTION_EFFECTS_BEHAVIOR =
  'The result also says what changed on the page: a navigation (Page: navigated to <url> (status), or URL changed to <url> (same document); JSON navigation { url, sameDocument, status }), and messages that appeared or changed in alert/status/aria-live elements or flash/error/toast-like classes (New text: "…" (element); JSON messages [{ text, element }], at most 3, with "(+N more)" and moreMessages for the rest; after a navigation every message on the new page counts; texts of only digits and time units, such as clocks and counters, are left out, but other text that changes on its own, such as a rotating banner, can show up). Both are absent when nothing changed. Downloads that began meanwhile are listed (Download: <name> → <path> (<state>, <size>); JSON downloads [{ url, suggestedFilename, path, state: inProgress|completed|canceled, bytes }]); a Chrome bdg launched saves them into <session dir>/downloads (never ~/Downloads), named as suggested with (1), (2)… when taken, and one still running when the action returns is inProgress and appears at its path once complete; downloads of tabs the page opens (target=_blank, window.open) count too; when that directory cannot be created they are refused (canceled, with reason) instead of going to ~/Downloads, and if Chrome refuses the download behavior bdg status warns that downloads are not redirected; ones that begin after the action returned are listed by bdg status and bdg peek (Downloads: N (last: …)); files stay after stop and cleanup; with --chrome-ws-url (the exception: not a browser bdg owns) downloads go to the download folder of that Chrome (usually ~/Downloads), only downloads of the session page are tracked (not those of tabs or popups it opens), and bdg sets behavior default with events, which replaces one another CDP client set and which Chrome drops when the session connection closes. Tabs and windows opened meanwhile are listed (Opened: popup|tab <url> (bdg page switch <index>); JSON opened [{ url, targetId, kind: popup (can reach window.opener) | tab, index }], the URL as of the return, about:blank for a window still loading); when the session tab closed since the previous action (a popup calling window.close()) the session is back on its opener (else the tab used before it), said as Tab closed: <url>; now on tab <index>: <url> (JSON tabClosed, switchedTo), and an action whose own tab closed while it ran succeeds with that instead of failing; when the tab closed on its own (a timer) and no action reported it, the first action after it is not run but exits 90 naming the move (it was meant for the closed tab; run it again to act on the current tab), unless a page switch or page close chose a tab since. Cost: one page script sent before the action without waiting for it and one read after it, a few ms; when the page does not answer (a pending navigation) bdg waits at most 200 ms for the snapshot and 250 ms per read, and the navigation is still reported from CDP events. ' +
  ACTION_ERRORS_BEHAVIOR;

/** What click and pressKey report when the page was still changing as they returned */
const STILL_CHANGING_BEHAVIOR =
  'When the page was still changing as the action returned, the status line says (page still changing), a note below it says what was pending and suggests bdg dom wait <selector>, and JSON has settled: false with pending { requests (document, fetch/XHR and script requests still running), navigation (a new page still loading), loading (a loading indicator that appeared, e.g. "div#loading"), domChanging (DOM changes came in bursts and, at a second look 250 ms later, again, with no quiet gap over 150 ms; time the page could not run its tasks, a long task or timers a starved renderer runs late, is not quiet, and a single burst more than 150 ms old with at most 75 ms of quiet time since also gets the second look (only that 250 ms; domChanging still needs a fresh change at it); a single render, ticking text and style animations do not count, and changes more than about 150 ms apart while the page could run look settled), busy (the page did not answer within 250 ms and ran a long task since the action began, or did not answer a check within 250 ms more: a long script; a page that answered late without a long task, a starved renderer, gets its answer waited for instead; a renderer descheduled in the middle of a task can still record a long task and is then busy; the check runs at most once per action, adding at most 250 ms, so an endless script is reported busy about 500 ms after the action) }; absent when the page looked settled (exit code stays 0). A result a timer renders later, with no DOM change, request or loading indicator before it, is not detected. Cost: nothing extra, except 250 ms plus one read when the DOM looked busy. Not checked with --no-wait';

/** What hover and pressKey report about elements they showed */
const SHOWN_BEHAVIOR =
  'Elements the action showed are listed (Shown: <element> "<text>"; JSON shown [{ text, element }], at most 3, outermost first): elements with visible text added inside the target\'s form, search box, dialog or combobox (else its grandparent, or its parent when that is the body), and popups and messages added anywhere (tooltip, menu, listbox, dialog, alert, status roles, popover, aria-live, message-like classes); widgets elsewhere on the page and re-rendered elements whose text was there before do not count';

/** What `--no-wait` does to a DOM action's triggered requests */
const NO_WAIT_TRIGGERED_REQUESTS =
  'Returns immediately without waiting for network; triggeredRequests lists only requests bdg saw start before returning (often none yet; check bdg network list later)';

/** How an action's `--dialog` answers the dialogs it opens */
const ACTION_DIALOG_BEHAVIOR: OptionBehavior = {
  default:
    'Dialogs the action opens get the session default: accepted (OK; a prompt gets its default value, "" without one) unless bdg <url> --dialog dismiss; beforeunload is always accepted',
  whenEnabled:
    'accept (OK) or dismiss (Cancel: confirm() returns false, prompt() null) for alert, confirm, prompt and beforeunload dialogs opened while the action runs, its network wait included; dismissing beforeunload cancels the navigation (the page stays); an accepted prompt without --prompt-text gets its default value, as OK does. Case does not matter (Dismiss works). Other values exit 81 with a suggestion (ok/yes: accept, cancel/no: dismiss); --dialog dismiss with --prompt-text exits 81',
  automaticBehavior:
    'Results list them as Dialog: confirm() dismissed: "Sure?" (JSON dialogs [{ type, message, answer: accepted|dismissed, promptText }]). The choice resets when the action returns: a dialog a page timer opens later gets the session default. Actions run one at a time, so it never applies to another action, but a bdg dom eval or bdg cdp call running at the same time shares it. Not with hover --off',
};

/** How an action's `--prompt-text` answers the prompt() dialogs it opens */
const ACTION_PROMPT_TEXT_BEHAVIOR: OptionBehavior = {
  default:
    'Accepted prompt() dialogs get their default value, as OK does ("" without one; the session default may dismiss them)',
  whenEnabled:
    'prompt() dialogs the action opens are accepted with this text, also when the session default is dismiss; JSON dialogs[].promptText and the human line ((answered "…") show it. Other dialogs keep their answer',
};

/** `--dialog` and `--prompt-text` of every DOM action that answers dialogs */
const ACTION_DIALOG_BEHAVIORS: Record<string, OptionBehavior> = Object.fromEntries(
  ['fill', 'click', 'hover', 'submit', 'pressKey', 'scroll'].flatMap((command) => [
    [`${command}:--dialog`, ACTION_DIALOG_BEHAVIOR],
    [`${command}:--prompt-text`, ACTION_PROMPT_TEXT_BEHAVIOR],
  ])
);

/** Behaviors by registry key */
export const DOM_ACTION_BEHAVIORS: BehaviorTable = {
  ...ACTION_DIALOG_BEHAVIORS,
  'fill:--no-wait': {
    default: 'Waits for network stability after filling input (150ms idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `Network wait helps ensure React/Vue state updates complete before next action. The value is read back after filling: when the page rejected or moved it, the output starts with a warning and JSON has valueMismatch { expected, actual } (exit code stays 0), plus movedTo naming the field of the form that got the value instead. ${TRIGGERED_REQUESTS_BEHAVIOR}. ${ACTION_EFFECTS_BEHAVIOR}`,
  },
  'fill:--no-blur': {
    default: 'Triggers blur event after filling (validates most form fields)',
    whenDisabled: 'Keeps focus on element after filling',
    automaticBehavior:
      'Blur triggers validation in most frameworks - disable only if you need to continue typing',
  },
  'click:--no-wait': {
    default: 'Waits for network stability after click (150ms idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `Network wait helps ensure AJAX requests triggered by click complete. ${TRIGGERED_REQUESTS_BEHAVIOR}. The click itself uses real mouse events in the visible part of the element (method "mouse"); if the element is covered or has no size it falls back to DOM events (method "dom", with a warning; --strict refuses instead). Results the page shows later (timers, spinners, slow renders) are not waited for but reported as pending work: use bdg dom wait <selector> --visible. ${ACTION_EFFECTS_BEHAVIOR}. ${STILL_CHANGING_BEHAVIOR}. A click with no DOM change, no request, no navigation and no console message (checked again 300 ms later, which adds 300 ms plus at most 250 ms for the read) is reported as ⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms) and effect: "none" in JSON (exit code stays 0); not claimed with --no-wait, for hover or right-click, after a copy or cut, or when the click hit a form control, label, media, iframe, popover button, a mailto:/tel:/javascript: or other non-http link, a link to another window or a custom element with a closed shadow root, or moved focus to an element that is not a button or link. Effects outside the DOM (CSS :hover/:focus-within styles, canvas, clipboard without a copy event) are not seen. A click on a submit button (button of type submit or without a type, input type=submit or image, also outside its form through the form attribute or in a shadow root) whose form the browser's constraint validation kept from submitting is reported as ⚠ Element Clicked (submit blocked) with ⚠ Submit blocked: <field>: <browser message> (fields named as dom submit names them, separated by ; ) and JSON submitBlocked [{ field, message }], instead of a plain success or no visible effect (exit code stays 0); not for a form with novalidate, a formnovalidate button, a click the page canceled, a form that fired submit, or a click that navigated or triggered a request`,
    tokenImpact: 'A click that navigates lists the whole page load in JSON triggeredRequests',
  },
  'click:--double': {
    default: 'Single click',
    whenEnabled:
      'Double-click: two presses with clickCount 1 and 2, so the page gets click, click and dblclick',
  },
  'click:--right': {
    default: 'Left click',
    whenEnabled:
      'Right-click: the page gets contextmenu (custom context menus open); cannot be combined with --double',
  },
  'click:--strict': {
    default:
      'A covered, hidden or zero-size element is clicked with DOM events (method "dom", with a warning, exit 0)',
    whenEnabled:
      'Refuses with exit 90 (RESOURCE_CONFLICT: the page state blocks the request) when a real mouse cannot reach the element, naming what covers it and suggesting bdg dom layout <selector>; also when the mouse press never reached the element (it is released, no further presses for --double)',
    automaticBehavior:
      'Applies to --double and --right too. Nothing is dispatched when the element is unreachable, so the page is unchanged',
  },
  'hover:--no-wait': {
    default: 'Waits for network stability after moving the mouse (menus may load content)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `The element is scrolled into view first; when the page moved, Scrolled (JSON scrolledBy) says how far. The mouse stays over the element afterwards, so hover menus stay open until the next mouse action. ${TRIGGERED_REQUESTS_BEHAVIOR}. ${ACTION_EFFECTS_BEHAVIOR}. ${SHOWN_BEHAVIOR}; for a hover also elements around it (its parent's subtree) and tooltips, menus, listboxes, dialogs and popovers anywhere that were hidden before, so captions shown by CSS :hover count (hidden elements noted by identity right before the mouse moves: up to 1500, within 8 ms). A hover never claims "no visible effect" and does not check whether the page was still changing`,
  },
  'hover:--strict': {
    default:
      'A covered, hidden or zero-size element gets synthetic mouseover/mouseenter events (method "dom", with a warning)',
    whenEnabled:
      'Refuses with exit 90 when a real mouse cannot reach the element, naming what covers it and suggesting bdg dom layout <selector>',
  },
  'navigate:--no-wait': {
    default: 'Waits until the new page has loaded and the network and DOM are idle (up to 15 s)',
    whenDisabled: 'Returns as soon as the navigation has started',
    automaticBehavior:
      'Also applies to page reload/back/forward; indices from earlier queries become stale (87). Triggered requests are not listed (they are the page load; see bdg network list)',
  },
  'pressKey:--no-wait': {
    default: 'Waits for network stability after key press (150ms idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `${TRIGGERED_REQUESTS_BEHAVIOR}. ${ACTION_EFFECTS_BEHAVIOR}. ${SHOWN_BEHAVIOR}, such as the item Enter added to a list. ${STILL_CHANGING_BEHAVIOR}. A key press never claims "no visible effect"`,
  },
  'pressKey:--times': {
    default: 'Presses key once',
    whenEnabled: 'Presses key N times (useful for ArrowDown in autocomplete, Tab navigation)',
  },
  'pressKey:--modifiers': {
    whenEnabled:
      'Adds modifier keys: shift, ctrl, alt, meta (comma-separated). Example: --modifiers ctrl for Ctrl+key',
  },
  'submit:--wait-navigation': {
    default: 'Waits for network stability only',
    whenEnabled: 'Waits for page navigation to complete (use for forms that redirect)',
    automaticBehavior:
      'A navigation is a new document loading in the main frame, also at the same URL (a POST that redirects back to the form after a login error). When the new page loaded but requests were still running at --timeout, the submit succeeds with a warning; without a navigation it exits 102, and the hint says whether a page request was sent (slow server) or not (the form may submit via fetch)',
  },
  'submit:--wait-network': {
    default: 'Default network idle timeout',
    whenEnabled: 'Custom network idle timeout in ms (use for slow APIs)',
    automaticBehavior: `${TRIGGERED_REQUESTS_BEHAVIOR}. ${ACTION_EFFECTS_BEHAVIOR}. A submit with no DOM change, request or navigation reports effect: "none" like dom click`,
  },
  'wait:--timeout': {
    default: 'Gives up after 10000 ms',
    whenEnabled: 'Gives up after the given milliseconds (1 to 600000)',
    automaticBehavior:
      'The page is watched (DOM mutations plus a 100 ms poll for style changes) and answers as soon as the matches change; a navigation during the wait continues it on the new document. A timeout exits 102 (CDP_TIMEOUT) with what the page showed last, e.g. "2 matches, none visible" or "document.readyState: loading", and a next step (dom query for no matches, dom layout for hidden ones, peek for a page still loading)',
  },
  'wait:--visible': {
    default: 'Counts every match, hidden ones included',
    whenEnabled:
      'Counts only visible matches (rendered, non-empty box, visibility: visible; opacity 0 counts as visible, as with :visible)',
    automaticBehavior:
      'With --gone, waits until no match is visible (the element may stay in the DOM hidden)',
  },
  'wait:--gone': {
    default: 'Waits for at least one match',
    whenEnabled:
      'Waits until nothing matches (nothing visible with --visible, nothing containing the text with --text), seen twice in a row in the same document once it is no longer loading, so the empty document right after a navigation does not count (a page stuck in readyState loading never meets it)',
  },
  'wait:--text': {
    default: 'Any match counts',
    whenEnabled:
      'Only matches whose text contains the given text count (case-insensitive, whitespace collapsed; hidden elements are matched by their text nodes, as with :has-text)',
    automaticBehavior: 'Needs a selector; use body to look in the whole page',
  },
  'wait:--load': {
    default: 'Does not look at document.readyState',
    whenEnabled:
      'Also waits for document.readyState "complete"; without a selector waits only for that (a script whose server never answers keeps it "loading")',
  },
  'scroll:--down': {
    whenEnabled: 'Scrolls page down by specified pixel amount',
  },
  'scroll:--up': {
    whenEnabled: 'Scrolls page up by specified pixel amount',
  },
  'scroll:--left': {
    whenEnabled: 'Scrolls page left by specified pixel amount (horizontal scroll)',
  },
  'scroll:--right': {
    whenEnabled: 'Scrolls page right by specified pixel amount (horizontal scroll)',
  },
  'scroll:--top': {
    whenEnabled: 'Scrolls to the very top of the page (position 0,0)',
  },
  'scroll:--bottom': {
    whenEnabled: 'Scrolls to the very bottom of the page',
    automaticBehavior:
      'A page scroll (--down/--up/--left/--right/--top/--bottom) that moved nothing still exits 0 but starts with a warning saying why: the document is no taller (wider) than the viewport, the page was already at that edge, or scrolling is locked; while document.readyState is not complete it adds that the page is still loading (bdg dom wait --load)',
  },
  'scroll:--no-wait': {
    default:
      'Waits for lazy-loaded content to stabilize after scroll (150ms network idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `Wait helps ensure images and infinite scroll content load before next action. ${TRIGGERED_REQUESTS_BEHAVIOR}. ${ACTION_EFFECTS_BEHAVIOR}`,
  },
  'scroll:--index': {
    whenEnabled: 'If selector matches multiple elements, scrolls to the nth element (0-based)',
  },
};
