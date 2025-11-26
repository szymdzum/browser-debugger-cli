/**
 * Query cache manager for DOM element index-based access.
 *
 * Provides centralized management of DOM query result caching with:
 * - Singleton pattern for consistent cache access
 * - Navigation-aware staleness detection
 * - TTL-based navigation ID caching to reduce IPC calls
 *
 * The cache enables index-based element access patterns like
 * "bdg dom get 0" after running "bdg dom query .selector".
 *
 * @example
 * ```typescript
 * const manager = QueryCacheManager.getInstance();
 *
 * // Store query results
 * await manager.set(queryResult);
 *
 * // Validate and retrieve (throws if stale)
 * const validation = await manager.validate();
 * if (validation.valid) {
 *   const cache = validation.cache;
 * }
 * ```
 */

import { existsSync } from 'fs';
import { readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

import { getSessionDir } from '@/session/paths.js';
import type { DomQueryResult } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** TTL for cached navigation ID (500ms). */
const NAVIGATION_ID_CACHE_TTL_MS = 500;

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
 * Singleton manager for DOM query result caching.
 *
 * Centralizes all cache operations with navigation-aware staleness detection.
 * Uses file-based persistence for cross-process access.
 */
export class QueryCacheManager {
  private static instance: QueryCacheManager | null = null;

  /** Cached navigation ID with timestamp for TTL-based invalidation. */
  private cachedNavigationId: { value: number; timestamp: number } | null = null;

  /**
   * Get the singleton instance.
   *
   * @returns QueryCacheManager instance
   */
  static getInstance(): QueryCacheManager {
    QueryCacheManager.instance ??= new QueryCacheManager();
    return QueryCacheManager.instance;
  }

  /**
   * Reset the singleton instance (for testing).
   */
  static resetInstance(): void {
    QueryCacheManager.instance = null;
  }

  /**
   * Get path to query cache file.
   *
   * @returns Absolute path to query-cache.json
   */
  private getCachePath(): string {
    return join(getSessionDir(), 'query-cache.json');
  }

  /**
   * Store query results for index-based access.
   *
   * Writes results to ~/.bdg/query-cache.json for cross-process access.
   *
   * @param result - DOM query result to cache
   */
  async set(result: DomQueryResult): Promise<void> {
    try {
      const cachePath = this.getCachePath();
      await writeFile(cachePath, JSON.stringify(result), 'utf-8');
      log.debug(`Cached ${result.nodes.length} query results to ${cachePath}`);
    } catch (error) {
      log.debug(`Failed to write query cache: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get validated cache results.
   *
   * Returns null if cache is stale or doesn't exist.
   * Use getRaw() for unchecked access.
   *
   * @returns Cached query result or null if invalid/missing
   */
  async get(): Promise<DomQueryResult | null> {
    const validation = await this.validate();
    return validation.valid ? validation.cache : null;
  }

  /**
   * Get raw cache without validation.
   *
   * Reads from ~/.bdg/query-cache.json if it exists.
   * Does not check navigation staleness.
   *
   * @returns Cached query result or null if no cache exists
   */
  async getRaw(): Promise<DomQueryResult | null> {
    try {
      const cachePath = this.getCachePath();
      if (!existsSync(cachePath)) {
        return null;
      }

      const content = await readFile(cachePath, 'utf-8');
      const result = JSON.parse(content) as DomQueryResult;
      log.debug(`Retrieved ${result.nodes.length} cached query results`);
      return result;
    } catch (error) {
      log.debug(`Failed to read query cache: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Validate cache against current navigation state.
   *
   * Checks if the cached query results are still valid by comparing
   * the stored navigationId with the current one from the daemon.
   *
   * @returns Validation result with cache and error info
   *
   * @example
   * ```typescript
   * const validation = await manager.validate();
   * if (!validation.valid) {
   *   throw new CommandError(validation.error, { suggestion: validation.suggestion });
   * }
   * const cache = validation.cache;
   * ```
   */
  async validate(): Promise<QueryCacheValidation> {
    const cache = await this.getRaw();

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

    const currentNavId = await this.getCurrentNavigationId();

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

  /**
   * Clear the query cache.
   *
   * Removes ~/.bdg/query-cache.json.
   * Called when starting a new query or when the session ends.
   */
  async clear(): Promise<void> {
    try {
      const cachePath = this.getCachePath();
      if (existsSync(cachePath)) {
        await rm(cachePath, { force: true });
        log.debug('Cleared query cache');
      }
    } catch (error) {
      log.debug(`Failed to clear query cache: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Check if cache file exists.
   *
   * @returns True if cache file exists
   */
  exists(): boolean {
    return existsSync(this.getCachePath());
  }

  /**
   * Get current navigation ID from the daemon.
   *
   * Caches the result for 500ms to avoid redundant IPC calls within a single
   * command execution while ensuring freshness for subsequent commands.
   *
   * @returns Current navigation ID or null if unavailable
   */
  async getCurrentNavigationId(): Promise<number | null> {
    if (
      this.cachedNavigationId &&
      Date.now() - this.cachedNavigationId.timestamp < NAVIGATION_ID_CACHE_TTL_MS
    ) {
      return this.cachedNavigationId.value;
    }

    try {
      const { getStatus } = await import('@/ipc/client.js');
      const response = await getStatus();

      if (response.status === 'ok' && response.data?.navigationId !== undefined) {
        this.cachedNavigationId = {
          value: response.data.navigationId,
          timestamp: Date.now(),
        };
        return response.data.navigationId;
      }

      return null;
    } catch (error) {
      log.debug(`Failed to get current navigation ID: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Invalidate cached navigation ID.
   *
   * Forces fresh fetch on next getCurrentNavigationId() call.
   * Useful after navigation events.
   */
  invalidateNavigationCache(): void {
    this.cachedNavigationId = null;
  }
}
