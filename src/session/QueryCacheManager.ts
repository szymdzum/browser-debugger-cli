/**
 * Query cache manager for DOM element index-based access.
 *
 * Stores the last `bdg dom query` / `bdg dom form` result so later commands
 * can address its elements by index ("bdg dom get 0"). Each cached node holds
 * its backend node id, which identifies that exact element for as long as it
 * stays in the page; whether it still does is checked when the index is used,
 * not here.
 *
 * @example
 * ```typescript
 * const manager = QueryCacheManager.getInstance();
 * await manager.set(queryResult);
 *
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
import type { DomQueryResult, IndexSource } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/**
 * Cache format version. Version 2 stores backend node ids; older caches held
 * per-connection node ids that are meaningless to later commands.
 */
const CACHE_VERSION = 2;

/**
 * Selector recorded for `dom form` results (fields carry their own selectors).
 */
export const FORM_DISCOVERY_CACHE_SELECTOR = 'form:auto-discovered';

/** Prefix of the selector recorded for `dom a11y query` results (followed by the pattern) */
export const A11Y_CACHE_SELECTOR_PREFIX = 'a11y ';

/**
 * The list an index refers to, from the selector recorded with the cache.
 *
 * @param index - The index the user gave
 * @param cacheSelector - Selector recorded with the cached results
 * @returns The command whose results are cached, and its query
 */
export function indexSourceOf(index: number, cacheSelector: string): IndexSource {
  if (cacheSelector === FORM_DISCOVERY_CACHE_SELECTOR) return { index, command: 'dom form' };
  if (cacheSelector.startsWith(A11Y_CACHE_SELECTOR_PREFIX)) {
    return {
      index,
      command: 'dom a11y query',
      query: cacheSelector.slice(A11Y_CACHE_SELECTOR_PREFIX.length),
    };
  }
  return { index, command: 'dom query', query: cacheSelector };
}

/**
 * Result of reading the cache.
 */
export interface QueryCacheValidation {
  /** Whether cached indices can be used */
  valid: boolean;
  /** Cached result, if readable */
  cache: DomQueryResult | null;
  /** Why the cache can't be used */
  error?: string;
  /** How to fix it */
  suggestion?: string;
}

/**
 * Singleton manager for the on-disk query cache.
 */
export class QueryCacheManager {
  private static instance: QueryCacheManager | null = null;

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
   * Path of the cache file in the session directory.
   *
   * @returns Absolute cache file path
   */
  private getCachePath(): string {
    return join(getSessionDir(), 'query-cache.json');
  }

  /**
   * Store a query result.
   *
   * @param result - Query result whose nodes carry backend node ids
   */
  async set(result: DomQueryResult): Promise<void> {
    try {
      const cachePath = this.getCachePath();
      await writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, ...result }), 'utf-8');
      log.debug(`Cached ${result.nodes.length} query results to ${cachePath}`);
    } catch (error) {
      log.debug(`Failed to write query cache: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Read the cache and check that it can be used.
   *
   * @returns Validation result with the cached query when usable
   */
  async validate(): Promise<QueryCacheValidation> {
    const raw = await this.read();
    if (!raw) {
      return {
        valid: false,
        cache: null,
        error: 'No cached query results found',
        suggestion: `Run "${sessionCommand('bdg dom query <selector>')}" first to generate indexed results`,
      };
    }
    const { version, ...cache } = raw;
    if (version !== CACHE_VERSION) {
      return {
        valid: false,
        cache: null,
        error: 'Cached query results are from an older bdg version',
        suggestion:
          cache.selector === FORM_DISCOVERY_CACHE_SELECTOR
            ? `Re-run "${sessionCommand('bdg dom form')}" to refresh cached results`
            : `Re-run "${sessionCommand(`bdg dom query ${cache.selector}`)}" to refresh cached results`,
      };
    }
    return { valid: true, cache };
  }

  /**
   * Remove the cache file.
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
   * Read the raw cache file.
   *
   * @returns Parsed cache content, or null if missing/unreadable
   */
  private async read(): Promise<(DomQueryResult & { version?: number }) | null> {
    try {
      const cachePath = this.getCachePath();
      if (!existsSync(cachePath)) return null;
      return JSON.parse(await readFile(cachePath, 'utf-8')) as DomQueryResult & {
        version?: number;
      };
    } catch (error) {
      log.debug(`Failed to read query cache: ${getErrorMessage(error)}`);
      return null;
    }
  }
}
