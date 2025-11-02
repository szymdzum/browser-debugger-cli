/**
 * Formatting utilities for agent-friendly output.
 * Detects TTY and NO_COLOR environment variable to conditionally use emojis/formatting.
 */

/**
 * Check if formatting (colors, emojis) should be used.
 * Respects NO_COLOR environment variable and TTY detection.
 */
export function shouldUseFormatting(): boolean {
  // Check NO_COLOR environment variable (standard: https://no-color.org/)
  if (process.env['NO_COLOR'] !== undefined) {
    return false;
  }

  // Check if stdout is a TTY (false when piping)
  return Boolean(process.stdout.isTTY);
}

/**
 * Format a success/failure indicator.
 * Returns emoji when formatting enabled, text otherwise.
 */
export function formatCheck(success: boolean): string {
  if (shouldUseFormatting()) {
    return success ? '✓' : '✗';
  }
  return success ? 'OK' : 'FAIL';
}

/**
 * Format an icon for different message types.
 * Returns emoji when formatting enabled, text prefix otherwise.
 */
export function formatIcon(type: 'success' | 'error' | 'warning' | 'info' | 'lightbulb'): string {
  if (!shouldUseFormatting()) {
    const textMap: Record<string, string> = {
      success: '[OK]',
      error: '[ERROR]',
      warning: '[WARN]',
      info: '[INFO]',
      lightbulb: '[TIP]',
    };
    return textMap[type] ?? '[INFO]';
  }

  const emojiMap: Record<string, string> = {
    success: '✓',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    lightbulb: '💡',
  };
  return emojiMap[type] ?? 'ℹ️';
}

/**
 * Format a status message with icon.
 */
export function formatStatus(icon: ReturnType<typeof formatIcon>, message: string): string {
  return `${icon} ${message}`;
}
