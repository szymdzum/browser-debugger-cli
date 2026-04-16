/**
 * `bdg dom query` — find elements by CSS selector and populate the query cache.
 */

import { queryDOMElements } from '@/commands/dom/helpers/index.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { DomQueryCommandOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { formatDomQuery } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
  if (selector.trim().length === 0) {
    handleValidationError(
      new CommandError(
        'Selector cannot be empty',
        { suggestion: 'Pass a CSS selector, e.g., bdg dom query "button"' },
        EXIT_CODES.INVALID_ARGUMENTS
      ),
      options.json ?? false
    );
  }

  await runCommand(
    async () => {
      const result = await queryDOMElements(selector);
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
