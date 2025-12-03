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
    default: 'PNG format (lossless, larger file size)',
    whenEnabled: 'JPEG format available for smaller files with quality trade-off',
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
    whenEnabled: 'Returns the nth matching element (1-based index, only works with --raw)',
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
    default: 'Waits for network stability after filling input (200ms idle)',
    whenDisabled: 'Returns immediately without waiting for network',
    automaticBehavior:
      'Network wait helps ensure React/Vue state updates complete before next action',
  },
  'fill:--no-blur': {
    default: 'Triggers blur event after filling (validates most form fields)',
    whenDisabled: 'Keeps focus on element after filling',
    automaticBehavior:
      'Blur triggers validation in most frameworks - disable only if you need to continue typing',
  },
  'click:--no-wait': {
    default: 'Waits for network stability after click (200ms idle)',
    whenDisabled: 'Returns immediately without waiting for network',
    automaticBehavior: 'Network wait helps ensure AJAX requests triggered by click complete',
  },
  'pressKey:--no-wait': {
    default: 'Waits for network stability after key press (200ms idle)',
    whenDisabled: 'Returns immediately without waiting for network',
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
    default: 'Waits for lazy-loaded content to stabilize after scroll (200ms network idle)',
    whenDisabled: 'Returns immediately without waiting for lazy-loaded content',
    automaticBehavior:
      'Wait helps ensure images and infinite scroll content load before next action',
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
  'peek:--verbose': {
    default: 'Compact output (truncated URLs, no resource types)',
    whenEnabled: 'Verbose output with full URLs and resource types',
  },
  'peek:--dom': {
    automaticBehavior:
      'DOM data only available after session stops. During live session shows "(none)".',
  },

  'cleanup:--force': {
    default: 'Only cleans up if session process is dead',
    whenEnabled: 'Forces cleanup even if session appears active (use when stuck)',
  },
  'cleanup:--aggressive': {
    whenEnabled:
      'Kills ALL Chrome processes on system (uses chrome-launcher killAll). Use with caution!',
  },

  'stop:--kill-chrome': {
    default: 'Stops session but leaves Chrome running for potential reconnection',
    whenEnabled: 'Stops session AND terminates the Chrome browser process',
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

/**
 * Check if an option has registered behavioral metadata.
 *
 * @param commandName - Name of the command containing the option
 * @param flags - Option flags string from Commander
 * @returns True if behavior metadata exists
 */
export function hasOptionBehavior(commandName: string, flags: string): boolean {
  const key = buildKey(commandName, flags);
  return key in OPTION_BEHAVIORS;
}
