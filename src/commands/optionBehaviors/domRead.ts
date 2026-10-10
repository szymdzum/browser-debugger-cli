/**
 * Option behaviors of the `bdg dom` commands that read the page (get, query, tree, eval, listeners, audit, layout, inspect, form).
 */

import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const DOM_READ_BEHAVIORS: BehaviorTable = {
  'get:--raw': {
    default:
      'Returns semantic accessibility structure: [Role] "Name" (properties) - 70-99% token reduction',
    whenEnabled: 'Returns full HTML with all attributes and classes',
    automaticBehavior:
      'Secret values are masked as in dom query: in the HTML (also with --node-id) the value attribute of a sensitive input and the text of a sensitive textarea are "••••", for the element and for fields inside it (a form), and JSON attributes.value too. Sensitive: password fields, CSS-masked fields, cc-*/one-time-code/password autocomplete, names like password, PIN, OTP, SSN or card data. No opt-out; bdg dom eval reads a value',
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
};
