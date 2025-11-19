/**
 * Accessibility tree inspection commands for semantic element queries.
 *
 * Provides three core commands:
 * - tree: Dump full accessibility tree
 * - query: Search by role/name/description patterns
 * - describe: Get A11y properties for CSS selector
 *
 * Uses IPC/callCDP pattern for consistency with other DOM commands.
 */

import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import {
  collectA11yTree,
  queryA11yTree,
  parseQueryPattern,
  getA11yNodeBySelector,
} from '@/telemetry/a11y.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatA11yTree, formatA11yQueryResult, formatA11yNode } from '@/ui/formatters/a11y.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for A11y tree command
 */
type A11yTreeOptions = BaseCommandOptions;

/**
 * Options for A11y query command
 */
type A11yQueryOptions = BaseCommandOptions;

/**
 * Options for A11y describe command
 */
type A11yDescribeOptions = BaseCommandOptions;

/**
 * Handle bdg dom a11y tree command
 *
 * Dumps the full accessibility tree for the current page via IPC.
 * Filters out ignored nodes for cleaner output.
 *
 * @param options - Command options
 */
async function handleA11yTree(options: A11yTreeOptions): Promise<void> {
  const tree = await collectA11yTree();

  if (options.json) {
    const serialized = {
      root: tree.root,
      nodes: Object.fromEntries(tree.nodes),
      count: tree.count,
    };
    console.log(JSON.stringify(serialized, null, 2));
    process.exit(EXIT_CODES.SUCCESS);
  }

  await runCommand(() => Promise.resolve({ success: true, data: tree }), options, formatA11yTree);
}

/**
 * Handle bdg dom a11y query <pattern> command
 *
 * Queries the accessibility tree using role/name/description patterns via IPC.
 * Pattern format: "role:button name:Submit" (space-separated key:value pairs)
 *
 * @param pattern - Query pattern string
 * @param options - Command options
 *
 * @example
 * ```bash
 * bdg dom a11y query "role:button name:Submit"
 * bdg dom a11y query "role:textbox"
 * bdg dom a11y query "name:Email"
 * ```
 */
async function handleA11yQuery(pattern: string, options: A11yQueryOptions): Promise<void> {
  await runCommand(
    async () => {
      const queryPattern = parseQueryPattern(pattern);

      if (!queryPattern.role && !queryPattern.name && !queryPattern.description) {
        throw new CommandError(
          'Query pattern must specify at least one field',
          {
            suggestion: 'Try: bdg dom a11y query "role:button" or "name:Submit"',
            note: `Received: "${pattern}"`,
          },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      const tree = await collectA11yTree();
      const result = queryA11yTree(tree, queryPattern);

      if (result.count === 0) {
        throw new CommandError(
          'No elements found matching pattern',
          {
            suggestion: 'Try a broader query or use "bdg dom a11y tree" to see all elements',
            note: `Pattern: ${JSON.stringify(queryPattern)}`,
          },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }

      return { success: true, data: result };
    },
    options,
    formatA11yQueryResult
  );
}

/**
 * Handle bdg dom a11y describe <selector> command
 *
 * Gets accessibility properties for a DOM element by CSS selector via IPC.
 * Useful for understanding how an element is exposed to assistive technologies.
 *
 * @param selector - CSS selector
 * @param options - Command options
 *
 * @example
 * ```bash
 * bdg dom a11y describe "button.submit"
 * bdg dom a11y describe "#email"
 * bdg dom a11y describe "form input[type=password]"
 * ```
 */
async function handleA11yDescribe(selector: string, options: A11yDescribeOptions): Promise<void> {
  await runCommand(
    async () => {
      const node = await getA11yNodeBySelector(selector);

      if (!node) {
        throw new CommandError(
          `Element not found or has no accessibility information: ${selector}`,
          {
            suggestion: 'Verify the selector matches an element: bdg dom query <selector>',
          },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }

      return { success: true, data: node };
    },
    options,
    formatA11yNode
  );
}

/**
 * Register accessibility commands under 'bdg dom a11y'
 *
 * @param domCmd - Parent DOM command
 */
export function registerA11yCommands(domCmd: Command): void {
  const a11y = domCmd
    .command('a11y')
    .description('Accessibility tree inspection and semantic queries');

  a11y
    .command('tree')
    .description('Dump full accessibility tree (filters ignored nodes)')
    .addOption(jsonOption)
    .action(async (options: A11yTreeOptions) => {
      await handleA11yTree(options);
    });

  a11y
    .command('query')
    .description('Query elements by accessibility properties')
    .argument(
      '<pattern>',
      'Query pattern: "role:button name:Submit" (space-separated key:value pairs)'
    )
    .addOption(jsonOption)
    .action(async (pattern: string, options: A11yQueryOptions) => {
      await handleA11yQuery(pattern, options);
    });

  a11y
    .command('describe')
    .description('Get accessibility properties for CSS selector')
    .argument('<selector>', 'CSS selector (e.g., "button.submit", "#email")')
    .addOption(jsonOption)
    .action(async (selector: string, options: A11yDescribeOptions) => {
      await handleA11yDescribe(selector, options);
    });
}
