/**
 * Shared Session Types
 *
 * Common types used across session messages and session commands.
 */

import type { DownloadInfo } from '@/ipc/protocol/domTypes.js';
import type { ColorScheme, ViewportSize } from '@/types.js';

/**
 * Session activity metrics.
 */
export interface SessionActivity {
  /** Network requests kept (finished ones; the newest at the cap). */
  networkRequestsCaptured: number;
  /** Oldest finished requests dropped at the request cap (left out when none). */
  networkRequestsDropped?: number;
  /** Oldest response bodies evicted at the total body budget (left out when none). */
  networkBodiesEvicted?: number;
  /** Total console messages captured. */
  consoleMessagesCaptured: number;
  /** Timestamp of last network request. */
  lastNetworkRequestAt?: number;
  /** Timestamp of last console message. */
  lastConsoleMessageAt?: number;
  /** Downloads that began during the session, oldest first (left out when none). */
  downloads?: DownloadInfo[];
  /** Why downloads do not go to the session directory (refused, or not redirected), while they do not */
  downloadsWarning?: string;
}

/**
 * Current page state.
 */
export interface PageState {
  /** Current page URL. */
  url: string;
  /** Current page title. */
  title: string;
  /** Layout viewport without scrollbars (left out when the page did not answer in time). */
  viewport?: ViewportSize;
  /** `prefers-color-scheme` the page sees (left out when the page did not answer in time). */
  colorScheme?: ColorScheme;
  /** When the page's renderer crashed (epoch ms); `bdg page reload` brings it back */
  crashedAt?: number;
}
