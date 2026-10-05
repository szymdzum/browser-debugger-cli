/**
 * `bdg dom layout <selector|index>` - where elements are on the page and
 * whether a user can see them, without a screenshot: page and viewport
 * coordinates, size, viewport position (visible, partly, above/below the
 * fold, hidden), what covers them and the styles that decide how they show.
 */

import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { LayoutCommandOptions } from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { domLayout } from '@/ipc/client.js';
import type { LayoutResult } from '@/ipc/protocol/domTypes.js';
import { formatLayout } from '@/ui/formatters/layout.js';

/**
 * Register `bdg dom layout`.
 *
 * @param dom - The `dom` command group
 */
export function registerLayoutCommand(dom: Command): void {
  dom
    .command('layout')
    .description(
      'Positions, sizes and visibility of elements (above/below the fold, hidden, covered) without a screenshot'
    )
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Only this match of the selector (0-based)', integerOption(0))
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: LayoutCommandOptions) => {
      await runCommand(() => measureLayout(selectorOrIndex, options), options, formatLayout);
    });
}

/**
 * Resolve the target and ask the daemon to measure it.
 *
 * @param selectorOrIndex - CSS selector or cached query index
 * @param options - Command options
 * @returns Command result; an index argument is reported as the element's `index`
 */
async function measureLayout(
  selectorOrIndex: string,
  options: LayoutCommandOptions
): ReturnType<typeof runElementCommand<Parameters<typeof domLayout>[0], LayoutResult>> {
  const result = await runElementCommand<Parameters<typeof domLayout>[0], LayoutResult>({
    selectorOrIndex,
    index: options.index,
    buildRequest: (target) => target,
    call: domLayout,
    command: 'layout',
    action: 'measure the layout',
    failureSuggestion: 'Verify the selector matches an element: bdg dom query "<selector>"',
  });
  if (!result.data || !DomElementResolver.getInstance().isNumericIndex(selectorOrIndex)) {
    return result;
  }
  const index = Number(selectorOrIndex);
  const elements = result.data.elements.map((element) => ({ ...element, index }));
  return { ...result, data: { ...result.data, elements } };
}
