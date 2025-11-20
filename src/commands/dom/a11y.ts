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
  resolveA11yNode,
} from '@/telemetry/a11y.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatA11yTree, formatA11yQueryResult, formatA11yNode } from '@/ui/formatters/a11y.js';
import { elementNotFoundError } from '@/ui/messages/errors.js';
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
 * Retrieve cached node by index with validation.
 *
 * @param index - Zero-based index from query results
 * @returns Node from cache
 * @throws CommandError if cache missing, index out of range, or node not found
 */
async function getCachedNodeByIndex(index: number): Promise<{ nodeId: number }> {
  const { getSessionQueryCache } = await import('@/session/queryCache.js');

  const cachedQuery = getSessionQueryCache();

  if (!cachedQuery) {
    throw new CommandError(
      'No cached query results found',
      {
        suggestion: 'Run "bdg dom query <selector>" first to generate indexed results',
      },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

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
 * Handle bdg dom a11y describe <selectorOrIndex> command
 *
 * Gets accessibility properties for a DOM element by CSS selector or numeric index.
 * Supports index-based access from query results (e.g., "bdg dom a11y describe 0").
 * Useful for understanding how an element is exposed to assistive technologies.
 *
 * @param selectorOrIndex - CSS selector (e.g., "button.submit") or numeric index from query results
 * @param options - Command options
 *
 * @example
 * ```bash
 * bdg dom a11y describe "button.submit"
 * bdg dom a11y describe "#email"
 * bdg dom a11y describe "form input[type=password]"
 * bdg dom a11y describe 0                  # Uses cached query results
 * ```
 */
async function handleA11yDescribe(
  selectorOrIndex: string,
  options: A11yDescribeOptions
): Promise<void> {
  const isNumericIndex = /^\d+$/.test(selectorOrIndex);

  await runCommand(
    async () => {
      let node: Awaited<ReturnType<typeof resolveA11yNode>>;

      if (isNumericIndex) {
        const index = parseInt(selectorOrIndex, 10);
        const targetNode = await getCachedNodeByIndex(index);
        node = await resolveA11yNode('', targetNode.nodeId);
      } else {
        node = await resolveA11yNode(selectorOrIndex);
      }

      if (!node) {
        throw new CommandError(
          elementNotFoundError(selectorOrIndex),
          {},
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
    .description('Query elements by accessibility properties (e.g., "role:button", "name:Submit")')
    .argument(
      '<pattern>',
      'Pattern with field prefix - role:button, name:Submit, name:*search* (supports wildcards)'
    )
    .addOption(jsonOption)
    .action(async (pattern: string, options: A11yQueryOptions) => {
      await handleA11yQuery(pattern, options);
    });

  a11y
    .command('describe')
    .description('Get accessibility properties for CSS selector or index')
    .argument(
      '<selectorOrIndex>',
      'CSS selector (e.g., "button.submit") or numeric index from query results'
    )
    .addOption(jsonOption)
    .action(async (selectorOrIndex: string, options: A11yDescribeOptions) => {
      await handleA11yDescribe(selectorOrIndex, options);
    });
}
