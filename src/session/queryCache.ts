/**
 * Query result cache for index-based element access.
 *
 * Stores the most recent DOM query results in a temporary file to enable
 * index-based access patterns like "bdg dom get 0" after running
 * "bdg dom query .selector".
 *
 * Uses file-based persistence to work across separate CLI process invocations.
 * Cache is stored in ~/.bdg/query-cache.json and cleared when session ends.
 *
 * Cache includes navigationId for staleness detection - when the page navigates,
 * cached node IDs become invalid and users should re-run their query.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getErrorMessage } from '@/connection/errors.js';
import { getSessionDir } from '@/session/paths.js';
import type { DomQueryResult } from '@/types/dom.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('session');

/**
 * Get path to query cache file.
 *
 * @returns Absolute path to query-cache.json
 */
function getQueryCachePath(): string {
  return join(getSessionDir(), 'query-cache.json');
}

/**
 * Store query results for index-based access.
 *
 * Writes results to ~/.bdg/query-cache.json for cross-process access.
 *
 * @param result - DOM query result to cache
 */
export function setSessionQueryCache(result: DomQueryResult): void {
  try {
    const cachePath = getQueryCachePath();
    writeFileSync(cachePath, JSON.stringify(result), 'utf-8');
    log.debug(`Cached ${result.nodes.length} query results to ${cachePath}`);
  } catch (error) {
    log.debug(`Failed to write query cache: ${getErrorMessage(error)}`);
  }
}

/**
 * Retrieve cached query results.
 *
 * Reads from ~/.bdg/query-cache.json if it exists.
 *
 * @returns Cached query result or null if no cache exists
 */
export function getSessionQueryCache(): DomQueryResult | null {
  try {
    const cachePath = getQueryCachePath();
    if (!existsSync(cachePath)) {
      return null;
    }

    const content = readFileSync(cachePath, 'utf-8');
    const result = JSON.parse(content) as DomQueryResult;
    log.debug(`Retrieved ${result.nodes.length} cached query results`);
    return result;
  } catch (error) {
    log.debug(`Failed to read query cache: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Clear the query cache.
 *
 * Removes ~/.bdg/query-cache.json.
 * Called when starting a new query or when the session ends.
 */
export function clearSessionQueryCache(): void {
  try {
    const cachePath = getQueryCachePath();
    if (existsSync(cachePath)) {
      rmSync(cachePath, { force: true });
      log.debug('Cleared query cache');
    }
  } catch (error) {
    log.debug(`Failed to clear query cache: ${getErrorMessage(error)}`);
  }
}

/**
 * Result of validating query cache against current navigation state.
 */
export interface QueryCacheValidation {
  /** Whether the cache is valid for use. */
  valid: boolean;
  /** The cached query result (if exists). */
  cache: DomQueryResult | null;
  /** Error message if cache is invalid. */
  error?: string;
  /** Suggestion for fixing the error. */
  suggestion?: string;
}

/**
 * Get current navigation ID from the daemon.
 *
 * @returns Current navigation ID or null if unavailable
 */
export async function getCurrentNavigationId(): Promise<number | null> {
  try {
    const { getStatus } = await import('@/ipc/client.js');
    const response = await getStatus();

    if (response.status === 'ok' && response.data?.navigationId !== undefined) {
      return response.data.navigationId;
    }

    return null;
  } catch (error) {
    log.debug(`Failed to get current navigation ID: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Validate query cache against current navigation state.
 *
 * Checks if the cached query results are still valid by comparing
 * the stored navigationId with the current one from the daemon.
 *
 * @returns Validation result with cache and error info
 *
 * @example
 * ```typescript
 * const validation = await validateQueryCache();
 * if (!validation.valid) {
 *   throw new CommandError(validation.error, { suggestion: validation.suggestion });
 * }
 * const cache = validation.cache;
 * ```
 */
export async function validateQueryCache(): Promise<QueryCacheValidation> {
  const cache = getSessionQueryCache();

  if (!cache) {
    return {
      valid: false,
      cache: null,
      error: 'No cached query results found',
      suggestion: 'Run "bdg dom query <selector>" first to generate indexed results',
    };
  }

  if (cache.navigationId === undefined) {
    log.debug('Query cache missing navigationId (legacy format), allowing access');
    return { valid: true, cache };
  }

  const currentNavId = await getCurrentNavigationId();

  if (currentNavId === null) {
    log.debug('Could not get current navigationId, allowing cache access');
    return { valid: true, cache };
  }

  if (cache.navigationId !== currentNavId) {
    return {
      valid: false,
      cache,
      error: `Query cache is stale (page has navigated since query was run)`,
      suggestion: `Re-run "bdg dom query ${cache.selector}" to refresh cached results`,
    };
  }

  return { valid: true, cache };
}
