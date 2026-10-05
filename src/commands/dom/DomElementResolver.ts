/**
 * DOM element resolver for index and selector-based access.
 *
 * A numeric argument is an index into the last `bdg dom query` / `bdg dom form`
 * result and resolves to that exact element (its backend node id). Whether the
 * element still exists is checked where it is used: if the page navigated or
 * the element was removed, commands fail with exit 87 instead of acting on a
 * different element that happens to match the selector now.
 *
 * @example
 * ```typescript
 * const resolver = DomElementResolver.getInstance();
 *
 * const target = await resolver.resolve('0', undefined, 'click');
 * // { success: true, selector: '.cached-selector', backendNodeId: 42 }
 *
 * const target = await resolver.resolve('button.submit', undefined, 'click');
 * // { success: true, selector: 'button.submit' }
 * ```
 */

import { noActiveSessionError } from '@/commands/shared/CommandRunner.js';
import { CommandError } from '@/errors/index.js';
import {
  cachedIndexOutOfRangeError,
  indexWithIndexOptionError,
  staleNodeError,
} from '@/errors/messages.js';
import {
  QueryCacheManager,
  indexSourceOf,
  type QueryCacheValidation,
} from '@/session/QueryCacheManager.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import type { DomQueryResult, IndexSource } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Successful result of resolving a selector or index argument.
 */
export interface ElementTargetSuccess {
  /** Resolution succeeded */
  success: true;
  /** CSS selector (for an index: the selector shown to the user) */
  selector: string;
  /** 0-based index among the selector's matches (selector arguments only) */
  index?: number | undefined;
  /** Exact element from the query cache (index arguments only) */
  backendNodeId?: number | undefined;
  /** The list the index refers to (index arguments only) */
  source?: IndexSource | undefined;
  /** What the cached element was when listed, e.g. `h3 "Welcome"` (index arguments only) */
  preview?: string | undefined;
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
 */
export type ElementTargetResult = ElementTargetSuccess | ElementTargetFailure;

type CachedNode = DomQueryResult['nodes'][number];

/**
 * Singleton resolver for DOM element access patterns.
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
   * @param selectorOrIndex - CSS selector or numeric index from query results
   * @param explicitIndex - Optional explicit --index flag value (0-based, selectors only)
   * @param command - `bdg dom` subcommand being run, e.g. "click" (for suggestions)
   * @returns Resolution result
   */
  async resolve(
    selectorOrIndex: string,
    explicitIndex: number | undefined,
    command: string
  ): Promise<ElementTargetResult> {
    if (!this.isNumericIndex(selectorOrIndex)) {
      return { success: true, selector: selectorOrIndex, index: explicitIndex };
    }
    if (explicitIndex !== undefined) {
      const err = indexWithIndexOptionError(selectorOrIndex, command);
      return {
        success: false,
        error: err.message,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        suggestion: err.suggestion,
      };
    }
    try {
      const { node, selector, source } = await this.lookup(parseInt(selectorOrIndex, 10));
      if (node.nodeId <= 0) {
        const err = staleNodeError(source.index, source);
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.STALE_CACHE,
          suggestion: err.suggestion,
        };
      }
      return {
        success: true,
        selector: node.selector ?? selector,
        backendNodeId: node.nodeId,
        source,
        preview: cachedNodePreview(node),
      };
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      return {
        success: false,
        error: error.message,
        exitCode: error.exitCode,
        suggestion: error.metadata.suggestion,
      };
    }
  }

  /**
   * Get the backend node id for a cached index, checking the element still exists.
   *
   * @param index - Zero-based index from query results
   * @returns Cached node; `nodeId` is its backend node id
   * @throws CommandError if there is no usable cache, the index is out of range,
   *   or the element is no longer in the page (87)
   */
  async getNodeIdForIndex(index: number): Promise<{ nodeId: number; source: IndexSource }> {
    const { node, source } = await this.lookup(index);
    if (node.nodeId <= 0) {
      const err = staleNodeError(index, source);
      throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
    }
    const { assertNodeAttached } = await import('@/commands/dom/helpers/index.js');
    await assertNodeAttached(node.nodeId, source);
    return { nodeId: node.nodeId, source };
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

  /**
   * Find a cached node by index.
   *
   * @param index - Zero-based index
   * @returns Cached node and the query's selector
   * @throws CommandError (83) without a session, (81) without a usable cache, (87) for an index outside the cached results
   */
  private async lookup(
    index: number
  ): Promise<{ node: CachedNode; selector: string; source: IndexSource }> {
    const validation: QueryCacheValidation = await this.cacheManager.validate();
    if (!validation.valid || !validation.cache) {
      if (!(await isDaemonAlive())) throw noActiveSessionError();
      throw new CommandError(
        validation.error ?? 'No cached query results found',
        validation.suggestion ? { suggestion: validation.suggestion } : {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    const { nodes, selector } = validation.cache;
    const source = indexSourceOf(index, selector);
    const node = nodes.find((n) => n.index === index);
    if (!node) {
      const err = cachedIndexOutOfRangeError(source, nodes.length);
      throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
    }
    return { node, selector, source };
  }
}

/**
 * What a cached element was when it was listed.
 *
 * @param node - Cached node
 * @returns e.g. `h3 "Welcome"`, `button`; undefined without a tag
 */
function cachedNodePreview(node: CachedNode): string | undefined {
  if (!node.tag) return undefined;
  return node.preview ? `${node.tag} "${node.preview}"` : node.tag;
}
