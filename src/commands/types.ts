/**
 * Type definitions for command results.
 *
 * Provides type safety for CommandRunner by defining explicit result types
 * for each command. This enables compile-time checking of formatter inputs.
 */

/**
 * Status command result
 *
 * Re-exported from ui/formatters/status.ts to maintain single source of truth
 */
export type { StatusData as StatusResult } from '@/ui/formatters/status.js';

/**
 * Stop command result
 */
export interface StopResult {
  stopped: {
    bdg: boolean;
    chrome: boolean;
  };
  message: string;
  warnings?: string[];
}

/**
 * Cleanup command result
 */
export interface CleanupResult {
  cleaned: {
    session: boolean;
    output: boolean;
    chrome: boolean;
    daemons: boolean;
  };
  message: string;
  warnings?: string[];
}

/**
 * Details command result
 */
export interface DetailsResult {
  item: unknown; // NetworkRequest | ConsoleMessage
  type: 'network' | 'console';
}
