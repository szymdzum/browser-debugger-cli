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

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { getDomContext } from '@/commands/dom/helpers.js';
import type { DomContext } from '@/commands/dom/helpers.js';
import { runCommand, runJsonCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  A11yTreeCommandOptions,
  A11yQueryCommandOptions,
  A11yDescribeCommandOptions,
} from '@/commands/shared/optionTypes.js';
import {
  collectA11yTree,
  queryA11yTree,
  parseQueryPattern,
  resolveA11yNode,
} from '@/telemetry/a11y.js';
import type { A11yNode } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatA11yTree,
  formatA11yQueryResult,
  formatA11yNodeWithContext,
} from '@/ui/formatters/a11y.js';
import {
  elementNotFoundError,
  invalidQueryPatternError,
  noA11yNodesFoundError,
  elementNotAccessibleError,
} from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle bdg dom a11y tree command
 *
 * Dumps the full accessibility tree for the current page via IPC.
 * Filters out ignored nodes for cleaner output.
 *
 * @param options - Command options
 */
async function handleA11yTree(options: A11yTreeCommandOptions): Promise<void> {
  if (options.json) {
    await runJsonCommand(async () => {
      const tree = await collectA11yTree();
      return {
        root: tree.root,
        nodes: Object.fromEntries(tree.nodes),
        count: tree.count,
      };
    });
  }

  const tree = await collectA11yTree();
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
async function handleA11yQuery(pattern: string, options: A11yQueryCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const queryPattern = parseQueryPattern(pattern);

      if (!queryPattern.role && !queryPattern.name && !queryPattern.description) {
        const err = invalidQueryPatternError(pattern);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }

      const tree = await collectA11yTree();
      const result = queryA11yTree(tree, queryPattern);

      if (result.count === 0) {
        const err = noA11yNodesFoundError(pattern);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
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
 * Data structure for a11y node with DOM context.
 */
interface A11yNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

/**
 * Handle bdg dom a11y describe <selectorOrIndex> command
 *
 * Gets accessibility properties for a DOM element by CSS selector or numeric index.
 * Supports index-based access from query results (e.g., "bdg dom a11y describe 0").
 * Useful for understanding how an element is exposed to assistive technologies.
 * Includes DOM context (tag, classes, text preview) when a11y data is sparse.
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
  options: A11yDescribeCommandOptions
): Promise<void> {
  const resolver = DomElementResolver.getInstance();
  const isNumericIndex = resolver.isNumericIndex(selectorOrIndex);

  /**
   * Fetch a11y node data for a given selector or index.
   */
  async function fetchA11yNodeData(): Promise<A11yNodeWithContext> {
    let node: A11yNode | null;
    let nodeId: number | undefined;

    if (isNumericIndex) {
      const index = parseInt(selectorOrIndex, 10);
      const targetNode = await resolver.getNodeIdForIndex(index);
      nodeId = targetNode.nodeId;
      node = await resolveA11yNode('', nodeId);
    } else {
      node = await resolveA11yNode(selectorOrIndex);
    }

    if (!node) {
      if (isNumericIndex) {
        const err = elementNotAccessibleError(parseInt(selectorOrIndex, 10));
        throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
      }
      throw new CommandError(
        elementNotFoundError(selectorOrIndex),
        {},
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    let domContext: DomContext | null = null;
    const domNodeId = node.backendDOMNodeId ?? nodeId;
    if (domNodeId) {
      domContext = await getDomContext(domNodeId);
    }

    return { node, domContext };
  }

  if (options.json) {
    await runJsonCommand(fetchA11yNodeData);
  }

  await runCommand(
    async () => {
      const data = await fetchA11yNodeData();
      return { success: true, data };
    },
    options,
    formatA11yNodeWithContext
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
    .description('Accessibility tree inspection and semantic queries')
    .argument(
      '[search]',
      'Quick search: index (describe), CSS selector (#id, .class), pattern with ":" (query), or name search'
    )
    .enablePositionalOptions()
    .action(async (search: string | undefined, options: A11yDescribeCommandOptions) => {
      if (!search) {
        a11y.help();
        return;
      }

      const isNumericIndex = /^\d+$/.test(search);
      const isCssSelector = /^[#.[]/u.test(search) || search.includes(' ');
      const isPatternQuery = search.includes(':') || search.includes('=');

      if (isNumericIndex || isCssSelector) {
        await handleA11yDescribe(search, options);
      } else if (isPatternQuery) {
        await handleA11yQuery(search, options);
      } else {
        await handleA11yQuery(`name:*${search}*`, options);
      }
    });

  a11y
    .command('tree')
    .description('Dump full accessibility tree (filters ignored nodes)')
    .addOption(jsonOption())
    .action(async (options: A11yTreeCommandOptions) => {
      await handleA11yTree(options);
    });

  a11y
    .command('query')
    .description('Query elements by accessibility properties (e.g., "role:button", "name:Submit")')
    .argument(
      '<pattern>',
      'Pattern with field prefix - role:button, name:Submit, name:*search* (supports wildcards)'
    )
    .addOption(jsonOption())
    .action(async (pattern: string, options: A11yQueryCommandOptions) => {
      await handleA11yQuery(pattern, options);
    });

  a11y
    .command('describe')
    .description('Get accessibility properties for CSS selector or index')
    .argument(
      '<selectorOrIndex>',
      'CSS selector (e.g., "button.submit") or numeric index from query results'
    )
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: A11yDescribeCommandOptions) => {
      await handleA11yDescribe(selectorOrIndex, options);
    });
}
