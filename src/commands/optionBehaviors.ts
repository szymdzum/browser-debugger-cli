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
