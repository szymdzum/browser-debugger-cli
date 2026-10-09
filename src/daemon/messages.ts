/**
 * Debug and diagnostic messages for the daemon process.
 *
 * User-facing debug output for internal operations. Context prefixes
 * (e.g., [daemon], [session]) are added by the logger, not here.
 *
 * WHY: Avoids duplicate prefixes when used with createLogger().
 */

/**
 * Generate telemetry module activation message.
 *
 * @param collectorName - Name of telemetry module being activated
 * @returns Formatted debug message
 */
export function sessionActivatingCollector(collectorName: string): string {
  return `Activating ${collectorName} telemetry`;
}

/**
 * Generate all telemetry modules activated message.
 *
 * @param telemetry - Array of activated telemetry module names
 * @returns Formatted debug message
 */
export function sessionCollectorsActivated(telemetry: string[]): string {
  return `All telemetry modules activated: ${telemetry.join(', ')}`;
}
