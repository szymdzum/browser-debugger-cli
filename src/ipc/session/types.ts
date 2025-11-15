/**
 * Shared Session Types
 *
 * Common types used across session messages and worker commands.
 */

/**
 * Session activity metrics.
 */
export interface SessionActivity {
  /** Total network requests captured. */
  networkRequestsCaptured: number;
  /** Total console messages captured. */
  consoleMessagesCaptured: number;
  /** Timestamp of last network request. */
  lastNetworkRequestAt?: number;
  /** Timestamp of last console message. */
  lastConsoleMessageAt?: number;
}

/**
 * Current page state.
 */
export interface PageState {
  /** Current page URL. */
  url: string;
  /** Current page title. */
  title: string;
}
