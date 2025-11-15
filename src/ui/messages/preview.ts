/**
 * Preview command messages (bdg peek)
 *
 * User-facing messages for the peek command, including empty states,
 * tips, and interactive command suggestions.
 * */

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
  return [
    'Commands:',
    '  Stop session:    bdg stop',
    '  Full preview:    bdg peek --last 50',
    '  Watch live:      bdg tail',
  ].join('\n');
}

// ============================================================================
// Follow Mode Messages
// ============================================================================

/**
 * Generate message for following preview mode.
 *
 * @returns Formatted message indicating follow mode is active
 *
 * @example
 * ```typescript
 * console.error(followingPreviewMessage());
 * // Output: "Following live preview (Ctrl+C to stop)...\n"
 * ```
 */
export function followingPreviewMessage(): string {
  return 'Following live preview (Ctrl+C to stop)...\n';
}

/**
 * Generate message for stopped following preview.
 *
 * @returns Formatted message indicating follow mode stopped
 *
 * @example
 * ```typescript
 * console.error(stoppedFollowingPreviewMessage());
 * // Output: "\nStopped following preview"
 * ```
 */
export function stoppedFollowingPreviewMessage(): string {
  return '\nStopped following preview';
}

/**
 * Generate connection lost + retry message for follow mode.
 *
 * @param timestamp - ISO timestamp of the event
 * @param retryLabel - Human-readable retry interval (e.g. "1s", "500ms")
 */
export function connectionLostRetryMessage(timestamp: string, retryLabel: string): string {
  return `\n[${timestamp}] ⚠️  Connection lost, retrying every ${retryLabel}...`;
}

/**
 * Generate follow-mode stop hint.
 *
 * @returns Message instructing the user how to stop follow mode
 */
export function connectionLostStopHintMessage(): string {
  return 'Press Ctrl+C to stop';
}
