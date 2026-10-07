/**
 * `bdg dom query` — find elements by CSS selector and populate the query cache.
 */

import { noMatchesError, pageDocumentId, queryDOMElements } from '@/commands/dom/helpers/index.js';
import { QUERY_CACHE_LIMIT } from '@/commands/dom/helpers/query.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomQueryCommandOptions } from '@/commands/shared/optionTypes.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import type { DomQueryResult } from '@/types.js';
import { formatDomQuery } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Matches `dom query` lists without `--limit` (human output) */
export const QUERY_LIST_LIMIT = 50;

/**
 * Handle `bdg dom query <selector>`.
 *
 * Runs the selector, caches the described matches so later commands can
 * reference elements by index, and lists the first `--limit` of them (50,
 * or {@link QUERY_CACHE_LIMIT} with `--json`; 0 = all) with the total count.
 * No match exits 83, like `dom get` and `dom a11y`, and clears the cache so
 * indices of an earlier query are not used by mistake.
 */
export async function handleDomQuery(
  selector: string,
  options: DomQueryCommandOptions
): Promise<void> {
  const limit = options.limit ?? (options.json ? QUERY_CACHE_LIMIT : QUERY_LIST_LIMIT);
  await runCommand(
    async () => {
      const document = await pageDocumentId();
      const result = await queryDOMElements(selector, limit);
      const cache = QueryCacheManager.getInstance();
      if (result.count === 0) {
        await cache.clear();
        const err = await noMatchesError(selector);
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          errorContext: { suggestion: err.suggestion },
        };
      }
      await cache.set(result, document);
      return { success: true, data: listedMatches(result, limit) };
    },
    options,
    formatDomQuery
  );
}

/**
 * The matches to list: the first `limit` (all with 0), with how many were
 * left out and, when not every match was described, how many can be used by
 * index. Nothing is added when the limit cut nothing (a match that could not
 * be described is just missing, as before).
 *
 * @param result - Query result with every described match
 * @param limit - Matches to list (0 = all)
 * @returns Result to output
 */
export function listedMatches(result: DomQueryResult, limit: number): DomQueryResult {
  if (limit === 0 || result.count <= limit) return result;
  return {
    ...result,
    nodes: result.nodes.slice(0, limit),
    omitted: result.count - Math.min(limit, result.nodes.length),
    ...(result.nodes.length < result.count && { indexed: result.nodes.length }),
  };
}
