/**
 * DOM element resolver for index and selector-based access.
 *
 * Provides centralized resolution of DOM elements from:
 * - Numeric indices (referencing cached query results)
 * - CSS selectors (used directly)
 *
 * Handles cache validation, staleness detection, and automatic refresh.
 * When cache is stale due to navigation, automatically re-runs the original
 * query to provide seamless "just works" experience.
 *
 * @example
 * ```typescript
 * const resolver = DomElementResolver.getInstance();
 *
 * // Resolve index from cached query
 * const target = await resolver.resolve('0');
 * // { success: true, selector: '.cached-selector', index: 1 }
 *
 * // Resolve CSS selector directly
 * const target = await resolver.resolve('button.submit');
 * // { success: true, selector: 'button.submit' }
 *
 * // Get nodeId for cached index (throws if invalid)
 * const nodeId = await resolver.getNodeIdForIndex(0);
 * ```
 */

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { CommandError } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * Successful result of resolving a selector or index argument.
 */
export interface ElementTargetSuccess {
  /** Resolution succeeded */
  success: true;
  /** CSS selector to use */
  selector: string;
  /** 0-based index for selector (if resolved from cached query) */
  index?: number | undefined;
}

/**
 * Failed result of resolving a selector or index argument.
 */
export interface ElementTargetFailure {
  /** Resolution failed */
  success: false;
  /** Error message */
  error: string;
  /** Exit code for the error */
  exitCode: number;
  /** Suggestion for fixing the error */
  suggestion?: string | undefined;
}

/**
 * Result of resolving a selector or index argument to an element target.
 * Discriminated union that guarantees selector exists when success is true.
 */
export type ElementTargetResult = ElementTargetSuccess | ElementTargetFailure;

/**
 * Singleton resolver for DOM element access patterns.
 *
 * Centralizes element resolution with cache validation, automatic refresh,
 * and consistent error handling.
 */
export class DomElementResolver {
  private static instance: DomElementResolver | null = null;
  private cacheManager: QueryCacheManager;

  /**
   * Create a new resolver instance.
   *
   * @param cacheManager - Query cache manager (defaults to singleton)
   */
  constructor(cacheManager?: QueryCacheManager) {
    this.cacheManager = cacheManager ?? QueryCacheManager.getInstance();
  }

  /**
   * Refresh stale cache by re-running the original query.
   *
   * Called automatically when cache validation fails due to navigation.
   * Re-queries using the stored selector and updates the cache with fresh results.
   *
   * @param selector - Original CSS selector from stale cache
   * @returns Fresh query result
   */
  private async refreshCache(selector: string): Promise<void> {
    log.debug(`Cache stale, auto-refreshing query "${selector}"`);

    const { queryDOMElements } = await import('@/commands/dom/helpers.js');
    const result = await queryDOMElements(selector);

    const navigationId = await this.cacheManager.getCurrentNavigationId();
    const resultWithNavId = {
      ...result,
      ...(navigationId !== null && { navigationId }),
    };

    await this.cacheManager.set(resultWithNavId);
    this.cacheManager.invalidateNavigationCache();

    log.debug(`Cache refreshed: found ${result.count} elements`);
  }

  /**
   * Get the singleton instance.
   *
   * @returns DomElementResolver instance
   */
  static getInstance(): DomElementResolver {
    DomElementResolver.instance ??= new DomElementResolver();
    return DomElementResolver.instance;
  }

  /**
   * Reset the singleton instance (for testing).
   */
  static resetInstance(): void {
    DomElementResolver.instance = null;
  }

  /**
   * Resolve a selectorOrIndex argument to an element target.
   *
   * Handles the common pattern of accepting either:
   * - A CSS selector string (used directly)
   * - A numeric index (resolved from cached query results)
   *
   * Automatically refreshes stale cache by re-running the original query.
   * This provides a "just works" experience where navigation doesn't break
   * index-based access.
   *
   * @param selectorOrIndex - CSS selector or numeric index from query results
   * @param explicitIndex - Optional explicit --index flag value (0-based)
   * @returns Resolution result with selector and optional index
   *
   * @example
   * ```typescript
   * const target = await resolver.resolve('button');
   * // { success: true, selector: 'button' }
   *
   * const target = await resolver.resolve('0');
   * // { success: true, selector: '.cached-selector', index: 1 }
   * ```
   */
  async resolve(selectorOrIndex: string, explicitIndex?: number): Promise<ElementTargetResult> {
    const isNumericIndex = /^\d+$/.test(selectorOrIndex);

    if (isNumericIndex) {
      let validation = await this.cacheManager.validate();

      // Auto-refresh: if cache is stale but has selector, re-run query
      if (!validation.valid && validation.cache?.selector) {
        await this.refreshCache(validation.cache.selector);
        validation = await this.cacheManager.validate();
      }

      if (!validation.valid || !validation.cache) {
        return {
          success: false,
          error: validation.error ?? 'No cached query results found',
          exitCode: EXIT_CODES.INVALID_ARGUMENTS,
          suggestion: validation.suggestion,
        };
      }

      const cachedQuery = validation.cache;
      const index = parseInt(selectorOrIndex, 10);
      if (index < 0 || index >= cachedQuery.nodes.length) {
        return {
          success: false,
          error: `Index ${index} out of range (found ${cachedQuery.nodes.length} nodes from query "${cachedQuery.selector}")`,
          exitCode: EXIT_CODES.STALE_CACHE,
          suggestion:
            cachedQuery.nodes.length === 0
              ? `No elements found after refresh. The selector "${cachedQuery.selector}" may no longer match any elements.`
              : `Use an index between 0 and ${cachedQuery.nodes.length - 1}`,
        };
      }

      return {
        success: true,
        selector: cachedQuery.selector,
        index: index + 1,
      };
    }

    return {
      success: true,
      selector: selectorOrIndex,
      index: explicitIndex,
    };
  }

  /**
   * Get nodeId for a cached index.
   *
   * Automatically refreshes stale cache by re-running the original query.
   * Throws CommandError only if refresh fails or index is out of range after refresh.
   *
   * @param index - Zero-based index from query results
   * @returns Node with nodeId from cache
   * @throws CommandError if cache missing, index out of range after refresh, or node not found
   *
   * @example
   * ```typescript
   * const node = await resolver.getNodeIdForIndex(0);
   * console.log(node.nodeId); // CDP node ID
   * ```
   */
  async getNodeIdForIndex(index: number): Promise<{ nodeId: number }> {
    let validation = await this.cacheManager.validate();

    // Auto-refresh: if cache is stale but has selector, re-run query
    if (!validation.valid && validation.cache?.selector) {
      await this.refreshCache(validation.cache.selector);
      validation = await this.cacheManager.validate();
    }

    if (!validation.valid || !validation.cache) {
      throw new CommandError(
        validation.error ?? 'No cached query results found',
        validation.suggestion ? { suggestion: validation.suggestion } : {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }

    const cachedQuery = validation.cache;

    if (index < 0 || index >= cachedQuery.nodes.length) {
      const suggestion =
        cachedQuery.nodes.length === 0
          ? `No elements found after refresh. The selector "${cachedQuery.selector}" may no longer match any elements.`
          : `Use an index between 0 and ${cachedQuery.nodes.length - 1}`;

      throw new CommandError(
        `Index ${index} out of range (found ${cachedQuery.nodes.length} nodes from query "${cachedQuery.selector}")`,
        { suggestion },
        EXIT_CODES.STALE_CACHE
      );
    }

    const targetNode = cachedQuery.nodes[index];
    if (!targetNode) {
      throw new CommandError(
        `Element at index ${index} not found`,
        { suggestion: `Re-run "bdg dom query ${cachedQuery.selector}" to refresh the cache` },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    return targetNode;
  }

  /**
   * Get the count of cached elements.
   *
   * Automatically refreshes stale cache by re-running the original query.
   *
   * @returns Number of cached elements
   * @throws CommandError if cache is missing or refresh fails
   */
  async getElementCount(): Promise<number> {
    let validation = await this.cacheManager.validate();

    // Auto-refresh: if cache is stale but has selector, re-run query
    if (!validation.valid && validation.cache?.selector) {
      await this.refreshCache(validation.cache.selector);
      validation = await this.cacheManager.validate();
    }

    if (!validation.valid || !validation.cache) {
      throw new CommandError(
        validation.error ?? 'No cached query results found',
        validation.suggestion ? { suggestion: validation.suggestion } : {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }

    return validation.cache.nodes.length;
  }

  /**
   * Check if the argument is a numeric index.
   *
   * @param selectorOrIndex - String to check
   * @returns True if the string is a numeric index
   */
  isNumericIndex(selectorOrIndex: string): boolean {
    return /^\d+$/.test(selectorOrIndex);
  }
}
