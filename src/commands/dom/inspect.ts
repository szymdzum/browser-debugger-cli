/**
 * `bdg dom inspect <selector|index>` - what one element looks like, without a
 * screenshot: its box, layout (and its place in the parent), typography with
 * the rendered font and contrast, fills, borders, effects, CSS state,
 * pseudo-elements and a compact child tree, as grouped lines (`--json`:
 * Figma-aligned fields).
 */

import { Option, type Command } from 'commander';

import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption, SELECTOR_OR_INDEX_ARGUMENT } from '@/commands/shared/commonOptions.js';
import type { InspectCommandOptions } from '@/commands/shared/optionTypes.js';
import { cssPropertiesOption, integerOption } from '@/commands/shared/validation.js';
import { domInspect } from '@/ipc/client.js';
import type { DomInspectCommand } from '@/ipc/protocol/commands.js';
import type { InspectResult } from '@/ipc/protocol/inspectTypes.js';
import { DEFAULT_TREE_DEPTH, DEFAULT_TREE_LIMIT } from '@/runtime/dom/inspectTree.js';
import { formatInspect } from '@/ui/formatters/inspect.js';
import { INSPECT_OUTPUT_LEGEND } from '@/ui/messages/commands.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Register `bdg dom inspect`.
 *
 * @param dom - The `dom` command group
 */
export function registerInspectCommand(dom: Command): void {
  dom
    .command('inspect')
    .description(
      'What one element looks like without a screenshot: box, layout, font (rendered, contrast), colors, borders, effects, pseudo-elements and child tree'
    )
    .argument('<selectorOrIndex>', SELECTOR_OR_INDEX_ARGUMENT)
    .option(
      '--index <n>',
      'Which match to inspect (0-based; default: the first rendered one)',
      integerOption(0)
    )
    .option(
      '--tree <depth>',
      `Child tree depth (default ${DEFAULT_TREE_DEPTH}; 0 for none)`,
      integerOption(0, 10)
    )
    .option(
      '--tree-limit <n>',
      `Child tree rows at most (default ${DEFAULT_TREE_LIMIT})`,
      integerOption(1, 500)
    )
    .addOption(
      new Option(
        '--all',
        'Every computed property that is not its default, collapsed into shorthands, instead of the groups'
      ).conflicts('props')
    )
    .addHelpText('after', INSPECT_OUTPUT_LEGEND)
    .option(
      '--props <names>',
      'Only these properties, computed and normalized (comma-separated, e.g. padding,color,--brand)',
      cssPropertiesOption
    )
    .addOption(
      new Option(
        '--rules',
        'Also show which CSS rule sets each shown property (selector, file:line, what it overrides); with --props, those properties'
      ).conflicts('all')
    )
    .addOption(
      new Option(
        '--why <property>',
        'Every declaration of one property: the one that applies and those it overrides (e.g. --why color)'
      )
        .conflicts('all')
        .argParser(propertyOption)
    )
    .option('--no-hints', 'Skip the check for declarations that have no effect')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: InspectCommandOptions) => {
      await runCommand(() => inspectTarget(selectorOrIndex, options), options, formatInspect);
    });
}

/**
 * Parse `--why`: a property name, lowercased (custom properties as given).
 *
 * @param value - Property name
 * @returns Name
 */
function propertyOption(value: string): string {
  return value.startsWith('--') ? value.trim() : value.trim().toLowerCase();
}

/**
 * Resolve the target and ask the daemon to inspect it.
 *
 * @param selectorOrIndex - CSS selector or cached query index
 * @param options - Command options
 * @returns Command result
 */
async function inspectTarget(
  selectorOrIndex: string,
  options: InspectCommandOptions
): ReturnType<typeof runElementCommand<DomInspectCommand, InspectResult>> {
  return runElementCommand<DomInspectCommand, InspectResult>({
    selectorOrIndex,
    index: options.index,
    buildRequest: (target) => ({
      ...target,
      ...filterDefined({
        tree: options.tree,
        treeLimit: options.treeLimit,
        all: options.all,
        props: options.props,
        rules: options.rules,
        why: options.why,
        ...(options.hints === false && { hints: false }),
      }),
    }),
    call: domInspect,
    command: 'inspect',
    action: 'inspect the element',
    failureSuggestion: 'Verify the selector matches an element: bdg dom query "<selector>"',
  });
}
