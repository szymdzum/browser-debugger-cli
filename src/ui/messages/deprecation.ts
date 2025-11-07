/**
 * Deprecation warning messages
 *
 * Messages for deprecated flags and features that will be removed in future versions.
 */

// ============================================================================
// Deprecation Warnings
// ============================================================================

/**
 * Generate deprecation warning for peek --follow flag.
 *
 * @returns Formatted deprecation warning message
 *
 * @example
 * ```typescript
 * console.error(peekFollowDeprecationWarning());
 * // Output: "⚠️  Deprecation Warning: The --follow flag will be removed in v1.0"
 * ```
 */
export function peekFollowDeprecationWarning(): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('⚠️  Deprecation Warning:');
  lines.push('   The --follow flag is deprecated and will be removed in v1.0');
  lines.push('   Please use: bdg tail');
  lines.push('');
  return lines.join('\n');
}

/**
 * Generate deprecation warning for stop --kill-chrome flag.
 *
 * @returns Formatted deprecation warning message
 *
 * @example
 * ```typescript
 * console.error(stopKillChromeDeprecationWarning());
 * // Output: "⚠️  Deprecation Warning: The --kill-chrome flag will be removed in v1.0"
 * ```
 */
export function stopKillChromeDeprecationWarning(): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('⚠️  Deprecation Warning:');
  lines.push('   The --kill-chrome flag is deprecated and will be removed in v1.0');
  lines.push('   Please use: bdg stop && bdg cleanup --aggressive');
  lines.push('');
  return lines.join('\n');
}
