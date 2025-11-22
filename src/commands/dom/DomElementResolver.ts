/**
 * DOM element resolver for index and selector-based access.
 *
 * Provides centralized resolution of DOM elements from:
 * - Numeric indices (referencing cached query results)
 * - CSS selectors (used directly)
 *
 * Handles cache validation, staleness detection, and consistent error handling.
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
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Successful result of resolving a selector or index argument.
 */
export interface ElementTargetSuccess {
  /** Resolution succeeded */
  success: true;
  /** CSS selector to use */
  selector: string;
  /** 1-based index for selector (if resolved from cached query) */
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
 * Centralizes element resolution with cache validation and consistent error handling.
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
   * Validates cache staleness by checking navigationId against current page state.
   *
   * @param selectorOrIndex - CSS selector or numeric index from query results
   * @param explicitIndex - Optional explicit --index flag value (1-based)
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
      const validation = await this.cacheManager.validate();

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
          error: `Index ${index} out of range (found ${cachedQuery.nodes.length} elements)`,
          exitCode: EXIT_CODES.INVALID_ARGUMENTS,
          suggestion: `Use an index between 0 and ${cachedQuery.nodes.length - 1}`,
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
   * Validates cache staleness and throws CommandError if invalid.
   *
   * @param index - Zero-based index from query results
   * @returns Node with nodeId from cache
   * @throws CommandError if cache missing, stale, index out of range, or node not found
   *
   * @example
   * ```typescript
   * const node = await resolver.getNodeIdForIndex(0);
   * console.log(node.nodeId); // CDP node ID
   * ```
   */
  async getNodeIdForIndex(index: number): Promise<{ nodeId: number }> {
    const validation = await this.cacheManager.validate();

    if (!validation.valid || !validation.cache) {
      throw new CommandError(
        validation.error ?? 'No cached query results found',
        validation.suggestion ? { suggestion: validation.suggestion } : {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }

    const cachedQuery = validation.cache;

    if (index < 0 || index >= cachedQuery.nodes.length) {
      throw new CommandError(
        `Index ${index} out of range (found ${cachedQuery.nodes.length} elements)`,
        {
          suggestion: `Use an index between 0 and ${cachedQuery.nodes.length - 1}`,
        },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }

    const targetNode = cachedQuery.nodes[index];
    if (!targetNode) {
      throw new CommandError(
        `Element at index ${index} not found`,
        {},
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    return targetNode;
  }

  /**
   * Get the count of cached elements.
   *
   * Validates cache and returns element count, or throws if cache is invalid.
   *
   * @returns Number of cached elements
   * @throws CommandError if cache is missing or stale
   */
  async getElementCount(): Promise<number> {
    const validation = await this.cacheManager.validate();

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
