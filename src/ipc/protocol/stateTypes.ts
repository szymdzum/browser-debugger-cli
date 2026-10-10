/**
 * Protocol-owned DTOs for saved browser auth state: `bdg state save`,
 * `bdg state load` and `bdg <url> --state`.
 *
 * The values (cookie values, storage items) only travel between the CLI and
 * the daemon; what the CLI prints is a {@link StateSummary}, counts only.
 */

import type { PageNavigationResult } from '@/ipc/protocol/commands.js';

/** Version of the state file format this bdg writes and reads */
export const STATE_FILE_VERSION = 1;

/**
 * A cookie as `Network.getAllCookies` reports it. Fields Chrome adds in
 * later versions are kept in the file and ignored on load.
 */
export interface StateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Expiry in seconds since the epoch; -1 for a session cookie */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  /** True for a session cookie (no Expires/Max-Age) */
  session?: boolean;
  sameSite?: string;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  /** Partition key of a partitioned (CHIPS) cookie */
  partitionKey?: unknown;
  [field: string]: unknown;
}

/** Storage of one origin */
export interface OriginStorage {
  /** Origin, e.g. `https://app.example.com` */
  origin: string;
  /** localStorage items by key */
  localStorage: Record<string, string>;
  /** sessionStorage items by key (of the session's tab) */
  sessionStorage: Record<string, string>;
}

/** What a state file holds besides its header */
export interface AuthStateContent {
  cookies: StateCookie[];
  origins: OriginStorage[];
}

/** A state file */
export interface AuthStateFile extends AuthStateContent {
  version: typeof STATE_FILE_VERSION;
  /** When it was saved (ISO 8601) */
  savedAt: string;
}

/** Why an origin's storage was not saved or restored */
export type SkippedOriginReason = 'not-on-page' | 'partitioned' | 'upgraded-to-https';

/** An origin whose storage was left out */
export interface SkippedOrigin {
  origin: string;
  reason: SkippedOriginReason;
}

/** Counts of one origin's storage */
export interface OriginStorageCounts {
  origin: string;
  localStorage: number;
  sessionStorage: number;
}

/** What was saved or restored: counts only, never values */
export interface StateSummary {
  cookies: number;
  origins: OriginStorageCounts[];
  /** Origins whose storage was left out, and why (absent when none) */
  skipped?: SkippedOrigin[];
}

/** state_save: read the session's cookies and storage */
export interface StateSaveCommand {
  /** Origins to save storage of (default: the origins of the page's frames) */
  origins?: string[];
}

/** The state read, for the CLI to write (it prints a summary only) */
export interface StateSaveData {
  state: AuthStateContent;
  /** Frames of the page whose storage was left out */
  skipped?: SkippedOrigin[];
}

/** state_load: restore cookies and storage into the session */
export interface StateLoadCommand {
  state: AuthStateContent;
  /** Reload the page afterwards (default: true) */
  reload?: boolean;
}

/** What `state load` restored */
export interface StateLoadData extends StateSummary {
  /** The page after the reload (absent with --no-reload) */
  reload?: PageNavigationResult;
}
