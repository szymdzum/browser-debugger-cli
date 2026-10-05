/**
 * `bdg dom listeners <selector|index>` - the event listeners that run for an
 * element: on the element itself, its ancestors, its document and window.
 *
 * The daemon collects them with `DOMDebugger.getEventListeners`; listeners on
 * ancestors matter because frameworks (React, jQuery) attach their handlers
 * to a root container or the document and dispatch from there. jQuery's
 * dispatcher is replaced by the jQuery handlers it runs for the element, and
 * framework roots (React's root container) are summarised per node unless
 * `--all` is given.
 */

import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { ListenersCommandOptions } from '@/commands/shared/optionTypes.js';
import { eventTypesOption, integerOption } from '@/commands/shared/validation.js';
import { domListeners } from '@/ipc/client.js';
import type { ListenersResult } from '@/ipc/protocol/domTypes.js';
import { formatListeners } from '@/ui/formatters/listeners.js';

/**
 * Register `bdg dom listeners`.
 *
 * @param dom - The `dom` command group
 */
export function registerListenersCommand(dom: Command): void {
  dom
    .command('listeners')
    .description('List event listeners that run for an element (incl. delegated ones on ancestors)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option(
      '--type <types>',
      'Only these event types (comma-separated, e.g. click,keydown; repeatable)',
      eventTypesOption
    )
    .option('--all', 'List every listener of framework roots (React) instead of one line per node')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: ListenersCommandOptions) => {
      await runCommand(
        () => listElementListeners(selectorOrIndex, options),
        options,
        (data) => formatListeners(data, options.type)
      );
    });
}

/**
 * Resolve the element and ask the daemon for its listeners.
 *
 * @param selectorOrIndex - CSS selector or cached query index
 * @param options - Command options
 * @returns Command result; an index argument is reported as `index`
 */
async function listElementListeners(
  selectorOrIndex: string,
  options: ListenersCommandOptions
): ReturnType<typeof runElementCommand<Parameters<typeof domListeners>[0], ListenersResult>> {
  const result = await runElementCommand<Parameters<typeof domListeners>[0], ListenersResult>({
    selectorOrIndex,
    index: options.index,
    buildRequest: (target) => ({
      ...target,
      ...(options.type && { types: options.type }),
      ...(options.all && { all: true }),
    }),
    call: domListeners,
    command: 'listeners',
    action: 'list event listeners',
    failureSuggestion: 'Verify the selector matches an element: bdg dom query "<selector>"',
  });
  if (!result.data || !DomElementResolver.getInstance().isNumericIndex(selectorOrIndex)) {
    return result;
  }
  return { ...result, data: { ...result.data, index: Number(selectorOrIndex) } };
}
