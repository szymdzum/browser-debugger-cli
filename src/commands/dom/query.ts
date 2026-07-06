/**
 * `bdg dom query` — find elements by CSS selector and populate the query cache.
 */

import { queryDOMElements } from '@/commands/dom/helpers/index.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomQueryCommandOptions } from '@/commands/shared/optionTypes.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { formatDomQuery } from '@/ui/formatters/dom.js';

/**
 * Handle `bdg dom query <selector>`.
 *
 * Runs the selector, caches the result set so later commands can reference
 * elements by index, and renders the result either as JSON or human output.
 */
export async function handleDomQuery(
  selector: string,
  options: DomQueryCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const interactive = (options as { interactive?: boolean }).interactive ?? false;
      const result = await queryDOMElements(selector, { interactive });
      const cacheManager = QueryCacheManager.getInstance();
      const navigationId = await cacheManager.getCurrentNavigationId();
      const resultWithNavId = {
        ...result,
        ...(navigationId !== null && { navigationId }),
      };
      await cacheManager.set(resultWithNavId);
      return { success: true, data: result };
    },
    options,
    formatDomQuery
  );
}
