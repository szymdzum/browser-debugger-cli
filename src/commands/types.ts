/**
 * Type definitions for command results.
 *
 * Provides type safety for CommandRunner by defining explicit result types
 * for each command. This enables compile-time checking of formatter inputs.
 */

import type { DomQueryResult, DomGetResult, ScreenshotResult } from '@/types/dom.js';
import type { BdgOutput } from '@/types.js';

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

/**
 * DOM query command result
 */
export type DomQueryCommandResult = DomQueryResult;

/**
 * DOM get command result
 */
export type DomGetCommandResult = DomGetResult;

/**
 * DOM eval command result
 */
export interface DomEvalResult {
  result: unknown;
}

/**
 * DOM screenshot command result
 */
export type DomScreenshotCommandResult = ScreenshotResult;

/**
 * CDP command result (varies by method)
 */
export interface CdpCommandResult {
  method: string;
  result: unknown;
}

/**
 * Peek/Tail command result (preview data)
 */
export type PreviewResult = BdgOutput;
