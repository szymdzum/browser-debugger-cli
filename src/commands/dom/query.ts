/**
 * `bdg dom query` — find elements by CSS selector and populate the query cache.
 */

import { queryDOMElements } from '@/commands/dom/helpers/index.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { noNodesFoundError } from '@/errors/messages.js';
import type { DomQueryCommandOptions } from '@/commands/shared/optionTypes.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { formatDomQuery } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom query <selector>`.
 *
 * Runs the selector, caches the result set so later commands can reference
 * elements by index, and renders the result either as JSON or human output.
 * No match exits 83, like `dom get` and `dom a11y`, and clears the cache so
 * indices of an earlier query are not used by mistake.
 */
export async function handleDomQuery(
  selector: string,
  options: DomQueryCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const result = await queryDOMElements(selector);
      const cache = QueryCacheManager.getInstance();
      if (result.count === 0) {
        await cache.clear();
        const err = noNodesFoundError(selector);
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          errorContext: { suggestion: err.suggestion },
        };
      }
      await cache.set(result);
      return { success: true, data: result };
    },
    options,
    formatDomQuery
  );
}
