/**
 * Behavioral metadata registry for self-documenting CLI options.
 *
 * Maps option flags to rich behavioral context that helps agents
 * understand option effects without trial-and-error or source inspection.
 *
 * @see docs/principles/SELF_DOCUMENTING_SYSTEMS.md
 */

import type { Option } from 'commander';

import {
  MAX_EDGE_PX,
  PIXELS_PER_TOKEN,
  TALL_PAGE_THRESHOLD,
} from '@/commands/dom/screenshotResize.js';
import type { OptionBehavior } from '@/commands/helpJson.js';

/** What DOM actions report about the network requests they triggered */
const TRIGGERED_REQUESTS_BEHAVIOR =
  'Requests (and WebSocket connections) that start after the action begins are returned as triggeredRequests (method, url, status, durationMs; pending when still running at return, loading when the response arrived but its body is still streaming; with resourceType; human output lists documents, XHR/fetch and WebSockets first (up to 10) and counts static assets on one line; absent when network telemetry is off). Attribution is by time: requests a page timer or poller starts meanwhile are listed too, whether or not the action caused them';

/** What every DOM action reports about the page besides its requests */
const ACTION_EFFECTS_BEHAVIOR =
  'The result also says what changed on the page: a navigation (Page: navigated to <url> (status), or URL changed to <url> (same document); JSON navigation { url, sameDocument, status }), and messages that appeared or changed in alert/status/aria-live elements or flash/error/toast-like classes (New text: "…" (element); JSON messages [{ text, element }], at most 3, with "(+N more)" and moreMessages for the rest; after a navigation every message on the new page counts; texts of only digits and time units, such as clocks and counters, are left out, but other text that changes on its own, such as a rotating banner, can show up). Both are absent when nothing changed. Cost: one page script sent before the action without waiting for it and one read after it, a few ms; when the page does not answer (a pending navigation) bdg waits at most 200 ms for the snapshot and 250 ms per read, and the navigation is still reported from CDP events';

/** What click and pressKey report when the page was still changing as they returned */
const STILL_CHANGING_BEHAVIOR =
  'When the page was still changing as the action returned, the status line says (page still changing), a note below it says what was pending and suggests bdg dom wait <selector>, and JSON has settled: false with pending { requests (document, fetch/XHR and script requests still running), navigation (a new page still loading), loading (a loading indicator that appeared, e.g. "div#loading"), domChanging (DOM changes came in bursts and, at a second look 250 ms later, again, with no quiet gap over 150 ms; a single render, ticking text and style animations do not count, and changes more than about 150 ms apart look settled), busy (the page did not answer within 250 ms: a long script) }; absent when the page looked settled (exit code stays 0). A result a timer renders later, with no DOM change, request or loading indicator before it, is not detected. Cost: nothing extra, except 250 ms plus one read when the DOM looked busy. Not checked with --no-wait';

/** What hover and pressKey report about elements they showed */
const SHOWN_BEHAVIOR =
  'Elements the action showed are listed (Shown: <element> "<text>"; JSON shown [{ text, element }], at most 3, outermost first): elements with visible text added inside the target\'s form, search box, dialog or combobox (else its grandparent, or its parent when that is the body), and popups and messages added anywhere (tooltip, menu, listbox, dialog, alert, status roles, popover, aria-live, message-like classes); widgets elsewhere on the page and re-rendered elements whose text was there before do not count';

/** What `--no-wait` does to a DOM action's triggered requests */
const NO_WAIT_TRIGGERED_REQUESTS =
  'Returns immediately without waiting for network; triggeredRequests lists only requests bdg saw start before returning (often none yet; check bdg network list later)';

/**
 * Registry key format: last command name, colon, long flag (the short flag
 * when there is no long one), e.g. "screenshot:--no-resize", "bdg:--headless"
 */
type BehaviorKey = string;

/** How every follow mode (peek, console, network list) runs and ends */
const FOLLOW_BEHAVIOR =
  'Stops with exit 83 when the session it follows ends, 130 on Ctrl-C, 143 on SIGTERM; with --json prints one compact object per line (NDJSON). Other failures (a busy page, a timeout) are retried: reported once in text, as one error line per refresh in JSON';

/**
 * Behavioral metadata registry.
 *
 * Keyed by "command:flag" to support same flag names across different commands.
 */
const OPTION_BEHAVIORS: Record<BehaviorKey, OptionBehavior> = {
  'screenshot:--selector': {
    default: 'Captures the page (full page unless --no-full-page)',
    whenEnabled:
      'Captures one element; the selector (or a query index) can also be given as the second argument: bdg dom screenshot out.png "#sel". With --index it picks that match of the selector (--selector ".item" --index 2). A positional and an option naming different elements exits 81',
    automaticBehavior:
      "The capture covers the border box plus what overflows it: uncleared floats, positioned children, text past a tight line height, and the element's own box shadows and outline (a focus ring); not what an overflow: hidden ancestor cuts off, nor fixed descendants. JSON element.bounds is the border box and element.captured the larger area when it grew, which human output notes. An element smaller than the viewport is scrolled into view for the capture and the page scroll put back afterwards; a larger one is captured with the page laid out at its width without scrollbars, so it does not shift",
  },
  'screenshot:--padding': {
    default:
      'The element capture is its painted area (border box, overflowing content, shadows, outline)',
    whenEnabled:
      'Adds that many CSS px of the page around the element capture on every side (0-500); without an element it exits 81',
  },
  'screenshot:--no-resize': {
    default: `Images auto-resized to max ${MAX_EDGE_PX}px longest edge for Claude Vision optimization (~1,600 tokens)`,
    whenDisabled: `Full resolution capture preserved (may use 10,000+ tokens for large pages)`,
    automaticBehavior: `Pages taller than ${TALL_PAGE_THRESHOLD}:1 aspect ratio automatically use viewport-only capture to prevent unreadable scaled text`,
    tokenImpact: `Formula: tokens = (width × height) / ${PIXELS_PER_TOKEN}. Default resize targets ~1,600 tokens.`,
  },
  'screenshot:--no-full-page': {
    default: 'Captures full scrollable page content',
    whenEnabled: 'Captures only visible viewport area',
    automaticBehavior: `Pages taller than ${TALL_PAGE_THRESHOLD}:1 aspect ratio automatically fallback to viewport capture even without this flag`,
  },
  'screenshot:--scroll': {
    whenEnabled:
      'Scrolls specified element into view, then captures viewport only (implies --no-full-page)',
    automaticBehavior:
      'When used with tall pages, prevents the automatic viewport fallback message since scroll is an explicit user choice',
  },
  'screenshot:--format': {
    default: 'Taken from the file extension: .jpg/.jpeg is JPEG, anything else PNG',
    whenEnabled: 'png or jpeg (jpg, any case); JPEG gives smaller files with a quality trade-off',
    automaticBehavior:
      'A --format that contradicts the extension, or an extension Chrome cannot write (.gif, .webp, ...), is refused with exit 81',
  },
  'screenshot:--quality': {
    default: 'JPEG quality 90 (good balance of quality and size)',
    whenEnabled: 'Lower values reduce file size but increase compression artifacts',
  },

  'get:--raw': {
    default:
      'Returns semantic accessibility structure: [Role] "Name" (properties) - 70-99% token reduction',
    whenEnabled: 'Returns full HTML with all attributes and classes',
    tokenImpact:
      'Semantic output uses 70-99% fewer tokens than raw HTML. Use --raw only when you need exact HTML structure.',
  },
  'get:--full': {
    default:
      'Semantic output shows the element text up to 500 characters (whitespace collapsed; close buttons such as "×" and aria-hidden icons left out)',
    whenEnabled:
      'Shows all of the element text; with --raw (or --node-id) prints the whole outer HTML instead of its first 20000 characters, and JSON outerHTML is whole too (else cut to 20000 with truncatedFrom, the original length)',
    automaticBehavior:
      'Without --full, --raw output cuts each element\'s HTML at 20000 characters and ends it with "… N more chars (use --full)"',
    tokenImpact:
      'A page-sized container can add thousands of tokens; dom get body --raw --full on Wikipedia is about 3.4 MB. Target the element you need',
  },
  'get:--all': {
    default: 'Returns first matching element only',
    whenEnabled: 'Returns all matching elements (only works with --raw)',
  },
  'get:--index': {
    default: 'Returns the first matching element (body without a selector)',
    whenEnabled:
      'Returns that match of the selector (0-based), in semantic and --raw output; --nth is an alias',
    automaticBehavior:
      'Past the last match exits 81; a numeric index argument (a cached query index) past the indexed matches, or from an earlier page, exits 87 (re-run dom query)',
  },
  'query:--limit': {
    default:
      'dom query and dom a11y query list the first 50 matches and say how many more there are; --json lists the first 100 with count (all matches) and omitted (the rest)',
    whenEnabled:
      'Lists that many matches (0 = all), in human and JSON output; count is always the total, JSON omitted the rest',
    automaticBehavior:
      'Matches are cached for index-based access (bdg dom click 55 works even when 50 are listed): all of them for dom a11y query, the first 1000 (or --limit, if higher) for dom query, which describes only those, so a page with 50000 matches answers in under a second; an element the page and frame trees both report is listed once. Indices work with click, fill, hover, pressKey, scroll, submit, layout, get and listeners, also for elements of a cross-origin iframe of the same site (a consent dialog), whose scripts then run in that frame',
    tokenImpact:
      'About one line per match (piped JSON about 160 bytes per dom query match, 230 per a11y match); a page can have thousands of links: on Wikipedia "United States" --limit 0 --json is 1.0 MB (dom query a) and 1.3 MB (dom a11y query role:link), the default 16 KB and 23 KB',
  },
  'tree:--limit': {
    default:
      'dom a11y tree lists the first 50 meaningful nodes depth-first, in human and JSON output; JSON count is the whole tree = nodes listed + omitted (cut by --limit/--depth) + skipped (never listed)',
    whenEnabled:
      'Lists that many nodes; 0 = all listed nodes (text boxes and empty wrappers are always skipped)',
    automaticBehavior:
      'Ignored nodes, text boxes, blank text, text repeating its parent name and nameless layout wrappers (generic, none, presentation, layout tables) are never listed (JSON skipped counts them); their children move up a level. For the raw tree with every node use bdg cdp Accessibility.getFullAXTree --json. JSON nodes carry depth (0 = root) instead of childIds; nodes outside the root (frame content) follow the root tree',
    tokenImpact:
      'About 140 bytes per piped JSON node (7 KB by default); the whole tree of a long page is megabytes (Wikipedia "United States": 51k nodes, 20k listed, 2.6 MB with --limit 0 --json), so prefer --depth or dom a11y query "role:<role>"',
  },
  'tree:--depth': {
    default: 'dom a11y tree lists every level (up to --limit nodes)',
    whenEnabled:
      'Lists nodes down to that level (0 = root only); deeper nodes are counted in omitted',
    tokenImpact: 'An outline of a page (landmarks, headings) in a few levels',
  },
  'eval:--frame': {
    default: "Evaluates in the page's main frame",
    whenEnabled:
      "Evaluates in one iframe's main world (its own globals), including cross-origin (out-of-process) iframes; output gains a frame field (its URL)",
    automaticBehavior:
      'The value is matched as: a 0-based index (bdg dom frames order: document order of the <iframe> elements, nested ones depth-first, main page not counted), else an exact name/id attribute, else a case-insensitive part of the name, id or URL. Several matches fail with 81 listing them; none fails with 83 listing all frames. Frames are looked up on every call (a reloaded iframe is found again). An index that names another frame than in the last bdg dom frames listing (iframes added, removed or moved, or the page navigated) fails with 87 STALE_CACHE: re-run bdg dom frames or pick the frame by name.',
  },
  'eval:--full': {
    default:
      'Human output prints the first 20000 characters of the value followed by "… N more chars (use --full)". In JSON a string result is cut to 20000 characters with truncatedFrom (the original length); an array result lists its first 100 elements with count (all of them) and omitted; an object or array whose JSON is still over 20000 characters becomes the first 20000 characters of its JSON text (a string; arrays keep count) with truncatedFrom (the length of the JSON text of the copy, which holds at most 1000 entries per list or object): a string result with truncatedFrom while type is object is such a JSON-text start',
    whenEnabled:
      'Prints the whole value, byte for byte; objects and arrays are copied with every entry (without --full at most 1000 per list or object)',
    tokenImpact:
      'dom eval document.documentElement.outerHTML on Wikipedia is about 3.6 MB with --full; on a page with 20000 elements, [...document.querySelectorAll("*")].map(e => e.outerHTML) --json is 3 MB with --full and 23 KB without; select what you need in the expression instead',
  },

  'console:--full': {
    default:
      'Message texts are cut: human output (summary, --list, --follow) at 200 characters followed by "… N more chars (use --full)"; JSON text at 10000 characters with truncatedFrom (the original length)',
    whenEnabled: 'Message texts are printed whole, in human and JSON output',
    tokenImpact:
      'A page that logs a large payload or throws a long error can add megabytes; bdg details console <n> shows one message whole',
  },
  'console:--history': {
    default: 'Shows messages from current page load only (most recent navigation)',
    whenEnabled: 'Shows messages from ALL page loads during the session',
    automaticBehavior:
      'Page navigations create new "navigation contexts" - default filters to latest context',
  },
  'console:--list': {
    default:
      'Smart summary with errors deduplicated and warnings grouped: the newest 50 distinct errors and warnings, with a note for the earlier ones. The session keeps the newest 10000 messages; dropped ones are counted (dropped in JSON)',
    whenEnabled: 'Lists all messages chronologically without deduplication',
  },
  'console:--last': {
    default: 'Smart summary (without --list); a list shows the last 100 messages',
    whenEnabled:
      'Lists the last N messages (0 = all) chronologically, also without --list; JSON gets messages and N distinct errors and warnings (0 = all; default 50)',
    automaticBehavior:
      'The [n] shown are positions in the session message list (what bdg details console <n> takes); when the page or level filter left messages out between the listed ones, a note says how many and why',
  },
  'console:--level': {
    default: 'Shows all log levels (error, warning, log, info, debug)',
    whenEnabled: 'Filters to specific level: error, warning, log, info, or debug',
  },

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
    automaticBehavior: `Network wait helps ensure AJAX requests triggered by click complete. ${TRIGGERED_REQUESTS_BEHAVIOR}. The click itself uses real mouse events in the visible part of the element (method "mouse"); if the element is covered or has no size it falls back to DOM events (method "dom", with a warning; --strict refuses instead). Results the page shows later (timers, spinners, slow renders) are not waited for but reported as pending work: use bdg dom wait <selector> --visible. ${ACTION_EFFECTS_BEHAVIOR}. ${STILL_CHANGING_BEHAVIOR}. A click with no DOM change, no request, no navigation and no console message (checked again 300 ms later, which adds 300 ms plus at most 250 ms for the read) is reported as ⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms) and effect: "none" in JSON (exit code stays 0); not claimed with --no-wait, for hover or right-click, after a copy or cut, or when the click hit a form control, label, media, iframe, popover button, a mailto:/tel:/javascript: or other non-http link, a link to another window or a custom element with a closed shadow root, or moved focus to an element that is not a button or link. Effects outside the DOM (CSS :hover/:focus-within styles, canvas, clipboard without a copy event) are not seen`,
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

  'listeners:--type': {
    default:
      'Lists listeners of every event type on the element, its ancestors (through open shadow roots), its document and window',
    whenEnabled:
      'Lists only these event types (comma-separated or repeated, case-sensitive like addEventListener); when none match, typeSuggestions names close types (Click, onclick → click)',
    automaticBehavior:
      'Listeners are grouped by type, the element\'s own handlers first (types handled on the element before delegated ones; nearest first, no-ops last); JSON line/column numbers are 0-based (human output shows them 1-based like DevTools). React\'s on… props that run for the element (its own and its React parents\', through portals and from a nested root into the outer root; onFocus/onBlur as focusin/focusout; parents\' props for non-bubbling events left out) are listed with source and location (framework: "React", reactProp: "onClick"; at most 50 of the requested types, reactHandlersSkipped counts the rest). jQuery handlers are shown instead of jQuery\'s dispatcher (framework: "jQuery", delegateSelector for delegates the element matches; a dispatcher with no handler for the element is omitted; at most 50 are resolved, jqueryHandlersSkipped counts the rest). Preact\'s event proxy is replaced by the handler Preact runs (framework: "Preact"). Empty handlers (React\'s onclick placeholder) are marked noop and do not count as the element\'s own handler. The Debugger domain is not enabled',
    tokenImpact:
      'Framework roots are already collapsed; --type keeps the output short on pages with many listeners',
  },
  'listeners:--all': {
    default:
      'Collapses React roots: on an ancestor recognised as a React root container (React\'s keys on the node, or dispatchers named dispatchDiscreteEvent/dispatchContinuousEvent/dispatchEvent), the function objects that each listen for several event types become one line / one "collapsed" entry with its types, phases and dispatchers. Other multi-type handlers are never collapsed',
    whenEnabled: 'Lists every listener of framework roots individually',
    tokenImpact:
      'On React pages --all adds a row per event type and phase (about 140 rows, 60 KB of JSON)',
  },

  'audit:--level': {
    default:
      'Text must reach WCAG AA: 4.5, or 3 for large text (24px, or 18.66px bold); every text-drawing element is checked, composited like dom inspect',
    whenEnabled: '--level AAA asks 7, or 4.5 for large text',
    automaticBehavior:
      'One walk over the rendered elements (open shadow roots included, at most 20000; capped says when it stopped). Findings are sorted weakest first; --limit (default 20) lists that many per check and the rest are counted. Overflow leaves out content inside horizontal scrollers and visually-hidden 1px text; identical findings are grouped (×N). Contrast is approximate (approximate: …) when something is painted behind or on top of text in view (hit-tested), or for text out of view whose ancestors paint nothing below body (only its ancestors were checked). Canvas animations cannot be listed; visible canvas elements are counted (canvases)',
    tokenImpact: 'About one line per finding; --limit bounds it',
  },
  'layout:--index': {
    default:
      'Reports every match of the selector (human output lists the first 20, JSON up to 100 plus an omitted count); a numeric argument reports that cached query element',
    whenEnabled: 'Reports only the nth match (0-based); out of range exits 81',
    automaticBehavior:
      'Coordinates are CSS px: bounds relative to the top-level page (iframe offsets and page scroll included), viewport relative to the visible area. Iframes and overflow containers (scroll lists, overflow: hidden) clip what counts as visible (clippedBy names the one cutting it off). scrollBy brings the whole element into view and is limited to how far the page can scroll: for an element out of view it centres it (aligns its start when it is larger than the viewport; human output says "to centre it"), for a partly visible one it is the smallest scroll that shows all of it (the part cut off at the top or bottom; the start of one larger than the viewport; "partly visible (87%); scroll up 5px to see all of it"). Elements a page script moves on scroll (floating menus) may move again after it; fixed and sticky elements (page scroll does not move them, or only until they stick) and ones beyond that range get offScreenReason instead, which says "page scrolling is locked (…)" when the page cannot scroll because body/html is position: fixed or overflow: hidden, so in-flow content is not called fixed; a visible dialog (dialog[open], [aria-modal=true], [role=dialog|alertdialog]) is named as the likely cause ("likely by dialog div#consent"). page.viewport is the layout viewport without scrollbars, as dom scroll reports it; page.colorScheme is the prefers-color-scheme media feature the page sees (not the theme it renders). Content in a closed <details> or under content-visibility: hidden is hidden. coveredBy is the first element painted above it at the center of the largest visible box that paints there (the background of a sticky header rather than the transparent logo on it; inside a shadow host, what its shadow root paints), else the topmost one with coverTransparent (none for pointer-events: none, nor for an element of the same click target: an overlay inside the link, button or label the element is in, a link to the same URL, or the textless absolutely positioned overlay link spanning the card that holds plain content); inert elements are flagged, not hidden',
    tokenImpact:
      'About one line per element; a cheap alternative to screenshots for "where is it?"',
  },

  'inspect:--index': {
    default:
      'Inspects the first rendered match (the first when none is rendered) and notes how many matched; a numeric argument inspects that cached element (from dom query, dom form or dom a11y query)',
    whenEnabled: 'Inspects the nth match (0-based); out of range exits 81',
    automaticBehavior:
      'Answers "what does it look like" without a screenshot, grouped like Figma Dev Mode: header (element, text, size and page position, [flex]/[grid], [not rendered]/[hidden]/[offscreen]/[covered by …], prefers-color-scheme), box (margin, padding, border widths, box-sizing, overflow, scroll size), layout (display, position, flex/grid container and item settings), parent (its display and layout, distances to its content edges, gaps to the neighbouring siblings), text (first font family → the font Chrome rendered, (webfont) or local; weight size/line-height; color; WCAG contrast against the composited background; only for elements with text), fill, border (sides, radius, outline), fx (shadow, transform, filter, opacity, blend), state (cursor, pointer-events, user-select, appearance), pseudo (::before/::after with content, ::placeholder) and a child tree (depth 2, 20 rows, identical siblings grouped). Values that change nothing (0, none, transparent, normal) are left out; colors are hex (lab/oklch from Tailwind converted), lengths px without the unit, rounded to 0.1. Secrets are never shown. JSON uses Figma-aligned names (rect, box, layout.sizing hug/fill/fixed, text, fills, strokes, radius, effects, children). Also by default: hints, the element\'s own declarations that have no effect (justify-content on a block, width on an inline element, top on a static one, var() of an unset custom property) with the reason, the fix and the rule\'s file:line',
    tokenImpact:
      'About 80–130 tokens for a button: 80–100 for the styles, up to 50 per hint (--no-hints drops them), and 30–70 more for a child tree (--tree 0 drops it), against about 1,500 for a screenshot or 3,000+ for raw computed styles',
  },

  'inspect:--all': {
    default: 'Shows the curated groups (the properties that define the look)',
    whenEnabled:
      'Lists every computed property that differs from the default of the same element type, longhands collapsed into shorthands, noise (logical duplicates, currentColor echoes, custom properties) dropped',
    tokenImpact: 'About as many tokens as the curated groups (about 90 for a button)',
  },

  'inspect:--props': {
    default: 'Shows the curated groups',
    whenEnabled:
      'Shows only the named properties (custom properties like --brand included, "(not set)" when no rule sets one; --* lists every custom property the element has, --bs-btn-* those with a prefix), each computed and normalized; an unknown name exits 81 with a suggestion',
  },

  'inspect:--rules': {
    default: 'Shows the values, not where they come from',
    whenEnabled:
      "Adds a rules group: for each shown property the page's CSS sets, the value as written (with the computed value when it uses var()), selector, file:line (column for minified files), @media/@container condition, cascade layer, how many ancestors up it is inherited from, and the rules it beats. Sides one declaration sets are one row; browser defaults are left out. With --props, only those properties",
    automaticBehavior:
      'The cascade is computed by bdg from CSS.getMatchedStylesForNode (origin, !important, style attribute, layers, specificity and order); reading it waits up to 5 s, then the output notes the cascade was not read',
    tokenImpact: 'About 15–25 tokens per row, 5–20 rows',
  },

  'inspect:--why': {
    default: 'Not shown',
    whenEnabled:
      "Adds why <property> = computed value, then every declaration of it on the element, highest precedence first: ✓ the winner (or the inherited ancestor's), ✗ the ones it beats, browser defaults included. Each rule shows its selector specificity [ids,classes,types]. var() values are shown substituted (or invalid: --x not set), with where the winner's custom properties are set, followed up to :root. Logical names map to physical ones (margin-inline-start → margin-left); a shorthand (padding, border) gives one answer when one declaration sets all its sides, else one per side",
  },

  'inspect:--no-hints': {
    default:
      "Hints at the element's own author declarations that have no effect (flex/grid properties without flex or grid, item properties without a flex or grid parent, offsets on static elements, sizes on inline ones, var() of an unset custom property, form controls in the browser's font), within a 1 s budget; hints none when nothing was found",
    automaticBehavior:
      "After a hint read times out, later inspects on the same page skip the hints without waiting (hints skipped: this page's stylesheets are slow to read) until a read is fast again, a stylesheet changes or it navigates; --rules and --why still wait up to 5 s. Matched rules that took over 300 ms are reused for up to 5 s, until a command that may change the page or a stylesheet or DOM change",
    whenEnabled: 'Skips the hints and does not read the matched rules',
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

  'form:--all': {
    default: 'Shows primary form (highest relevance), mentions others exist',
    whenEnabled: 'Expands all forms on the page with full details',
    automaticBehavior:
      'Forms in header/nav/aside score lower; forms with submit buttons score higher',
    tokenImpact: 'Multi-form pages may have 3-5 forms; potentially 10x more output',
  },
  'form:--brief': {
    default: 'Full form details with values, validation, and ready-to-use commands',
    whenEnabled: 'Quick scan: field names, types, and required status only',
    tokenImpact: 'Reduces output ~50% for initial discovery',
  },

  'peek:--full': {
    default:
      'Console message texts are cut: human output at 200 characters (compact output also at 2 lines) followed by "… N more chars (use --full)"; JSON text at 10000 characters with truncatedFrom (the original length)',
    whenEnabled: 'Console message texts are printed whole, in human and JSON output',
    tokenImpact: 'A page that logs a large payload can add megabytes per peek',
  },
  'peek:--type': {
    whenEnabled:
      'Filters network requests by CDP resource type. Case-insensitive, comma-separated. Valid: Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, WebSocket, etc.',
  },
  'peek:--follow': {
    default: 'Shows snapshot of current data',
    whenEnabled:
      'Continuous monitoring (like tail -f): refreshes every second, or every --interval ms (100-60000). Replaces the deprecated bdg tail',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
  'console:--follow': {
    default: 'Prints the messages logged so far and exits',
    whenEnabled: 'Streams new messages as they come (the last --last at start)',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
  'list:--follow': {
    default: 'Lists the requests captured so far and exits',
    whenEnabled: 'Streams requests as they finish',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
  'har:--include-sensitive': {
    default:
      'The HAR is sanitized: values become "[redacted]" for Authorization, Proxy-Authorization, Authentication, Cookie and Set-Cookie headers, X-*key/token/secret/auth headers and headers with an api-key/apikey/token/secret/jwt/subscription-key/session(-id) segment (www-authenticate is kept); every cookie value; query and fragment parameters named like credentials (plus code, sig, key) in the request URL, queryString, redirectURL and Location/Referer headers ("%5Bredacted%5D" in URLs); and password/token/secret/key/session/signature fields of JSON (primitives at any depth under such a name), form-urlencoded (also sniffed when the Content-Type says otherwise) and multipart request bodies. A JSON body too deep to walk becomes "[redacted]" whole. Header, cookie and parameter names, cookie attributes, headersSize and bodySize stay; log.comment and JSON sanitized: true say so',
    whenEnabled:
      'Writes every captured value (JSON sanitized: false); human output warns that the file holds credentials',
    automaticBehavior:
      'Matching is by name, so it over-redacts: harmless values under credential-looking names (tokenCount: 5, sessionLength) are replaced too, and credentials under other names are kept. Unlike Chrome DevTools, which drops these headers and empties cookies, names are kept so the HAR still shows a request was authenticated. Response bodies and WebSocket messages are not redacted. HAR files are written readable by their owner only (0600). network headers and network getCookies always show real values',
  },
  'peek:--verbose': {
    default: 'Compact output (truncated URLs, no resource types)',
    whenEnabled: 'Verbose output with full URLs and resource types',
  },
  'bdg:--headless': {
    default:
      'A window when there is a display: on macOS unless over SSH (SSH_CONNECTION, SSH_TTY) or CI is set; on Linux when DISPLAY or WAYLAND_DISPLAY is set. Servers, containers and CI run headless',
    whenEnabled: 'Chrome runs without a window (pass it when running unattended on a Mac)',
  },
  'bdg:--no-headless': {
    default:
      'A window when there is a display: on macOS unless over SSH (SSH_CONNECTION, SSH_TTY) or CI is set; on Linux when DISPLAY or WAYLAND_DISPLAY is set',
    whenEnabled: 'Chrome shows its window even without a detected display (it fails without one)',
  },
  'bdg:--all': {
    default:
      'Tracking/analytics requests and console noise are filtered; bodies of binary responses (images, fonts) are not captured',
    whenEnabled:
      'Everything is captured, including binary response bodies (base64, flagged by responseBodyBase64, within --max-body-size)',
    tokenImpact:
      'details network --json and HAR exports can grow considerably on media-heavy pages',
  },

  'bdg:--session': {
    default:
      'The default session in ~/.bdg (or $BDG_SESSION_DIR); BDG_SESSION=<name> selects a named session like the flag',
    whenEnabled:
      'Uses the named session in ~/.bdg/sessions/<name>/ (or $BDG_SESSION_DIR/sessions/<name>/) with its own daemon, Chrome, profile and port; every command (status, stop, cleanup, ...) acts on that session only',
    automaticBehavior:
      'Accepted before or after any subcommand; --session wins over BDG_SESSION. Names are case-insensitive (lower-cased: ALPHA is alpha). Without --port a named session takes the first free port above 9222 not claimed by another running session, and keeps it in port.txt. Names: 1-40 letters, digits, "-" or "_", starting with a letter or digit (exit 81 otherwise, also when the socket path would be too long). Hints and suggestions in its output carry --session <name>',
  },

  'cleanup:--force': {
    default: 'Refuses to run while a session is active; removes files left by a crashed session',
    whenEnabled: 'Kills the running daemon and its Chrome first (use when a session is stuck)',
  },
  'cleanup:--aggressive': {
    whenEnabled: 'Alias for --force, kept for compatibility',
  },
  'cleanup:--purge': {
    default:
      "A named session's directory (Chrome profile, ~60 MB; logs; port.txt) is kept for its next start",
    whenEnabled:
      'After cleaning up, deletes the directory of the session named by --session (exit 81 without --session); a running session is refused unless --force is given, and the directory is kept (exit 90) if the daemon still answers, cleanup reported a problem, or its Chrome has not exited',
  },

  'bdg:--viewport': {
    default:
      'A launched Chrome opens a 1920x1080 window (the viewport is smaller by the scrollbar, and in a visible window by the browser UI); an attached Chrome keeps its window',
    whenEnabled:
      'The page gets exactly that viewport (CSS px, e.g. 1280x800) for the whole session, through navigations and reloads (Emulation.setDeviceMetricsOverride at the display pixel ratio); a launched Chrome also opens its window at that size, so tabs the page opens get it too',
    automaticBehavior:
      'Works with --chrome-ws-url: the override belongs to the session, and Chrome drops it when the session ends, so the attached browser gets its own size back. bdg status shows the resulting layout viewport without the scrollbar (Viewport: 1265×800 (emulated 1280x800)). Invalid sizes (not WxH, a side outside 1-10000) exit 81',
  },
  'bdg:--mobile': {
    default:
      'A desktop viewport: classic scrollbars take ~15px of the width, no touch, a desktop user agent',
    whenEnabled:
      'Emulates a phone for the whole session: a mobile viewport (390x844 unless --viewport) at pixel ratio 3 with mobile layout (meta viewport, overlay scrollbars, so 100vw fits), touch (pointer: coarse, maxTouchPoints 5) and an Android Chrome user agent with mobile client hints; bdg page emulate --mobile turns it on mid-session, --viewport WxH without --mobile or --reset turns it off',
    automaticBehavior:
      'Screenshots keep the mobile layout and are taken at pixel ratio 1 (CSS px = image px); bdg status shows "(emulated 390x844, phone)"',
  },
  'bdg:--color-scheme': {
    default:
      'The page sees the system setting for prefers-color-scheme (headless Chrome follows the OS, so a dark OS renders dark pages); bdg status and dom layout show which one',
    whenEnabled:
      'Emulates prefers-color-scheme: light or dark for the whole session (Emulation.setEmulatedMedia); other values exit 81 with a suggestion',
    automaticBehavior:
      'Applies to the session page (and its same-process iframes); Chrome drops it when the session ends, also for an attached Chrome (--chrome-ws-url)',
  },

  'bdg:--chrome-ws-url': {
    default: 'bdg launches its own Chrome (closed on stop)',
    whenEnabled:
      'Attaches to a running Chrome instead; it keeps running after stop. --port, -u and --[no-]headless cannot be combined with it (exit 81)',
    automaticBehavior:
      'A port (9222), host:port or http://host:port is turned into the browser WebSocket URL via /json/version; a browser URL uses the first open tab. Refused with exit 90 when another running bdg session launched that Chrome or drives that tab (sessions of this BDG_SESSION_DIR, and of others that claimed a port)',
  },

  'stop:--kill-chrome': {
    default:
      'Chrome launched by bdg is always closed on stop; an attached Chrome (--chrome-ws-url) is left running',
    whenEnabled: 'No additional effect; kept for compatibility',
  },

  'cdp:--describe': {
    default:
      'Without --describe, a Domain.method is called (one missing from the bundled protocol is sent as typed, with a warning)',
    whenEnabled:
      'Describes a domain, a method (parameters with ? for optional, returns, example) or a protocol type (Domain.Type: enum values or object properties)',
    automaticBehavior:
      'Parameters referring to an enum type list its values inline (JSON enum, ref, refType); a redirected method (DOM.highlightNode) also shows the method implementing it and its parameters, which Chrome checks (JSON redirect)',
  },

  'status:--verbose': {
    default: 'Basic session status (daemon running, session active, URL)',
    whenEnabled: 'Includes Chrome diagnostics and CDP connection details',
  },
};

/**
 * Build behavior registry key from command and option: the command's own
 * name (`bdg` for the root) and the option's long flag, or its short flag
 * when it has no long one.
 *
 * @param commandName - Command name (e.g., "screenshot")
 * @param option - Commander option
 * @returns Registry key
 */
export function behaviorKey(commandName: string, option: Option): BehaviorKey {
  return `${commandName}:${option.long ?? option.short ?? option.flags}`;
}

/**
 * Every key in the behavior registry.
 *
 * @returns Registry keys
 */
export function listBehaviorKeys(): BehaviorKey[] {
  return Object.keys(OPTION_BEHAVIORS);
}

/**
 * Look up behavioral metadata for an option.
 *
 * @param commandName - Name of the command containing the option
 * @param option - Commander option
 * @returns Behavioral metadata if registered, undefined otherwise
 */
export function getOptionBehavior(commandName: string, option: Option): OptionBehavior | undefined {
  return OPTION_BEHAVIORS[behaviorKey(commandName, option)];
}
