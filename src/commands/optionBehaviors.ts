/**
 * Behavioral metadata registry for self-documenting CLI options.
 *
 * Maps option flags to rich behavioral context that helps agents
 * understand option effects without trial-and-error or source inspection.
 *
 * @see docs/principles/SELF_DOCUMENTING_SYSTEMS.md
 */

import {
  MAX_EDGE_PX,
  PIXELS_PER_TOKEN,
  TALL_PAGE_THRESHOLD,
} from '@/commands/dom/screenshotResize.js';
import type { OptionBehavior } from '@/commands/helpJson.js';

/** What DOM actions report about the network requests they triggered */
const TRIGGERED_REQUESTS_BEHAVIOR =
  'Requests (and WebSocket connections) that start after the action begins are returned as triggeredRequests (method, url, status, durationMs; pending when still running at return, loading when the response arrived but its body is still streaming; human output lists the first 10; absent when network telemetry is off). Attribution is by time: requests a page timer or poller starts meanwhile are listed too, whether or not the action caused them';

/** What `--no-wait` does to a DOM action's triggered requests */
const NO_WAIT_TRIGGERED_REQUESTS =
  'Returns immediately without waiting for network; triggeredRequests lists only requests bdg saw start before returning (often none yet; check bdg network list later)';

/**
 * Registry key format: "command:flag" (e.g., "screenshot:--no-resize")
 */
type BehaviorKey = string;

/**
 * Behavioral metadata registry.
 *
 * Keyed by "command:flag" to support same flag names across different commands.
 */
const OPTION_BEHAVIORS: Record<BehaviorKey, OptionBehavior> = {
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
  'get:--all': {
    default: 'Returns first matching element only',
    whenEnabled: 'Returns all matching elements (only works with --raw)',
  },
  'get:--nth': {
    default: 'Returns first matching element',
    whenEnabled: 'Returns the nth matching element (0-based index, only works with --raw)',
  },
  'eval:--frame': {
    default: "Evaluates in the page's main frame",
    whenEnabled:
      "Evaluates in one iframe's main world (its own globals), including cross-origin (out-of-process) iframes; output gains a frame field (its URL)",
    automaticBehavior:
      'The value is matched as: a 0-based index (bdg dom frames order, main page not counted), else an exact name/id attribute, else a case-insensitive part of the URL. Several matches fail with 81 listing them; none fails with 83 listing all frames. Frames are looked up on every call (a reloaded iframe is found again).',
  },

  'console:-H': {
    default: 'Shows messages from current page load only (most recent navigation)',
    whenEnabled: 'Shows messages from ALL page loads during the session',
    automaticBehavior:
      'Page navigations create new "navigation contexts" - default filters to latest context',
  },
  'console:--history': {
    default: 'Shows messages from current page load only (most recent navigation)',
    whenEnabled: 'Shows messages from ALL page loads during the session',
    automaticBehavior:
      'Page navigations create new "navigation contexts" - default filters to latest context',
  },
  'console:-l': {
    default: 'Smart summary with errors deduplicated and warnings grouped',
    whenEnabled: 'Lists all messages chronologically without deduplication',
  },
  'console:--list': {
    default: 'Smart summary with errors deduplicated and warnings grouped',
    whenEnabled: 'Lists all messages chronologically without deduplication',
  },
  'console:--level': {
    default: 'Shows all log levels (error, warning, log, info, debug)',
    whenEnabled: 'Filters to specific level: error, warning, log, info, or debug',
  },

  'fill:--no-wait': {
    default: 'Waits for network stability after filling input (150ms idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `Network wait helps ensure React/Vue state updates complete before next action. ${TRIGGERED_REQUESTS_BEHAVIOR}`,
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
    automaticBehavior: `Network wait helps ensure AJAX requests triggered by click complete. ${TRIGGERED_REQUESTS_BEHAVIOR}. The click itself uses real mouse events in the visible part of the element (method "mouse"); if the element is covered or has no size it falls back to DOM events (method "dom", with a warning)`,
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
  'hover:--no-wait': {
    default: 'Waits for network stability after moving the mouse (menus may load content)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `The mouse stays over the element afterwards, so hover menus stay open until the next mouse action. ${TRIGGERED_REQUESTS_BEHAVIOR}`,
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
    automaticBehavior: TRIGGERED_REQUESTS_BEHAVIOR,
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
  },
  'submit:--wait-network': {
    default: 'Default network idle timeout',
    whenEnabled: 'Custom network idle timeout in ms (use for slow APIs)',
    automaticBehavior: TRIGGERED_REQUESTS_BEHAVIOR,
  },

  'listeners:--type': {
    default:
      'Lists listeners of every event type on the element, its ancestors (through open shadow roots), its document and window',
    whenEnabled:
      'Lists only these event types (comma-separated, case-sensitive like addEventListener)',
    automaticBehavior:
      'Listeners are grouped by type, nearest first; JSON line/column numbers are 0-based (human output shows them 1-based like DevTools). The Debugger domain is not enabled',
    tokenImpact:
      'Pages with many window/document listeners produce long lists; --type keeps the output short',
  },

  'layout:--index': {
    default:
      'Reports every match of the selector (human output lists the first 20, JSON up to 100 plus an omitted count); a numeric argument reports that cached query element',
    whenEnabled: 'Reports only the nth match (0-based); out of range exits 81',
    automaticBehavior:
      'Coordinates are CSS px: bounds relative to the top-level page (iframe offsets and page scroll included), viewport relative to the visible area. Iframes and overflow containers (scroll lists, overflow: hidden) clip what counts as visible (clippedBy names the one cutting it off). scrollBy centres the element and is limited to how far the page can scroll; fixed elements and ones beyond that range get offScreenReason instead. Content in a closed <details> or under content-visibility: hidden is hidden. coveredBy is the topmost element at the center of the largest visible box (none for pointer-events: none); inert elements are flagged, not hidden',
    tokenImpact:
      'About one line per element; a cheap alternative to screenshots for "where is it?"',
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
  },
  'scroll:--no-wait': {
    default:
      'Waits for lazy-loaded content to stabilize after scroll (150ms network idle, up to 2s)',
    whenDisabled: NO_WAIT_TRIGGERED_REQUESTS,
    automaticBehavior: `Wait helps ensure images and infinite scroll content load before next action. ${TRIGGERED_REQUESTS_BEHAVIOR}`,
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

  'peek:--type': {
    whenEnabled:
      'Filters network requests by CDP resource type. Case-insensitive, comma-separated. Valid: Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, WebSocket, etc.',
  },
  'peek:-f': {
    default: 'Shows snapshot of current data',
    whenEnabled: 'Continuous monitoring - refreshes every second (like tail -f)',
  },
  'peek:--follow': {
    default: 'Shows snapshot of current data',
    whenEnabled: 'Continuous monitoring - refreshes every second (like tail -f)',
  },
  'peek:-v': {
    default: 'Compact output (truncated URLs, no resource types)',
    whenEnabled: 'Verbose output with full URLs and resource types',
  },
  'start:--all': {
    default:
      'Tracking/analytics requests and console noise are filtered; bodies of binary responses (images, fonts) are not captured',
    whenEnabled:
      'Everything is captured, including binary response bodies (base64, flagged by responseBodyBase64, within --max-body-size)',
    tokenImpact:
      'details network --json and HAR exports can grow considerably on media-heavy pages',
  },
  'peek:--verbose': {
    default: 'Compact output (truncated URLs, no resource types)',
    whenEnabled: 'Verbose output with full URLs and resource types',
  },

  'bdg:--session': {
    default:
      'The default session in ~/.bdg (or $BDG_SESSION_DIR); BDG_SESSION=<name> selects a named session like the flag',
    whenEnabled:
      'Uses the named session in ~/.bdg/sessions/<name>/ (or $BDG_SESSION_DIR/sessions/<name>/) with its own daemon, Chrome, profile and port; every command (status, stop, cleanup, ...) acts on that session only',
    automaticBehavior:
      'Accepted before or after any subcommand; --session wins over BDG_SESSION. Without --port a named session takes the first free port above 9222 not claimed by another running session, and keeps it in port.txt. Names: 1-40 letters, digits, "-" or "_" (exit 81 otherwise, also when the socket path would be too long)',
  },

  'cleanup:-f': {
    default: 'Refuses to run while a session is active; removes files left by a crashed session',
    whenEnabled: 'Kills the running daemon and its Chrome first (use when a session is stuck)',
  },
  'cleanup:--aggressive': {
    whenEnabled: 'Alias for --force, kept for compatibility',
  },

  'bdg:--chrome-ws-url': {
    default: 'bdg launches its own Chrome (closed on stop)',
    whenEnabled:
      'Attaches to a running Chrome instead; it keeps running after stop. --port and -u cannot be combined with it',
    automaticBehavior:
      'A port (9222), host:port or http://host:port is turned into the browser WebSocket URL via /json/version; a browser URL uses the first open tab',
  },

  'stop:--kill-chrome': {
    default:
      'Chrome launched by bdg is always closed on stop; an attached Chrome (--chrome-ws-url) is left running',
    whenEnabled: 'No additional effect; kept for compatibility',
  },

  'status:-v': {
    default: 'Basic session status (daemon running, session active, URL)',
    whenEnabled: 'Includes Chrome diagnostics and CDP connection details',
  },
  'status:--verbose': {
    default: 'Basic session status (daemon running, session active, URL)',
    whenEnabled: 'Includes Chrome diagnostics and CDP connection details',
  },
};

/**
 * Build behavior registry key from command and flag.
 *
 * @param commandName - Command name (e.g., "screenshot")
 * @param flags - Option flags string (e.g., "--no-resize")
 * @returns Registry key
 */
function buildKey(commandName: string, flags: string): BehaviorKey {
  const firstFlag = flags.split(',')[0] ?? flags;
  const flagName = firstFlag.trim().split(' ')[0] ?? firstFlag.trim();
  return `${commandName}:${flagName}`;
}

/**
 * Look up behavioral metadata for an option.
 *
 * @param commandName - Name of the command containing the option
 * @param flags - Option flags string from Commander
 * @returns Behavioral metadata if registered, undefined otherwise
 */
export function getOptionBehavior(commandName: string, flags: string): OptionBehavior | undefined {
  const key = buildKey(commandName, flags);
  return OPTION_BEHAVIORS[key];
}
