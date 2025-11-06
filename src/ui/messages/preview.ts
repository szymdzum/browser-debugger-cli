/**
 * Preview command messages (bdg peek)
 *
 * User-facing messages for the peek command, including empty states,
 * tips, and interactive command suggestions.
 */

// ============================================================================
// Empty State Messages
// ============================================================================

export const PREVIEW_EMPTY_STATES = {
  NO_DATA: '(none)',
  NO_NETWORK_REQUESTS: 'No network requests yet',
  NO_CONSOLE_MESSAGES: 'No console messages yet',
} as const;

// ============================================================================
// Header Messages
// ============================================================================

export const PREVIEW_HEADERS = {
  LIVE_PREVIEW: 'Live Preview (Partial Data)',
} as const;

// ============================================================================
// Tips and Command Suggestions
// ============================================================================

/**
 * Generate compact mode tip message.
 *
 * @returns Single-line tip for basic peek usage
 */
export function compactTipsMessage(): string {
  return 'Tip: bdg stop | bdg peek --last 50 | bdg peek --verbose';
}

/**
 * Generate verbose mode commands section.
 *
 * @returns Multi-line commands help for verbose mode
 */
export function verboseCommandsMessage(): string {
  const lines: string[] = [];
  lines.push('Commands:');
  lines.push('  Stop session:    bdg stop');
  lines.push('  Full preview:    bdg peek --last 50');
  lines.push('  Watch live:      bdg peek --follow');
  return lines.join('\n');
}
