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
} from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle bdg dom a11y tree command
 *
 * Dumps the full accessibility tree for the current page via IPC.
 * Filters out ignored nodes for cleaner output.
 *
 * JSON output returns nodes as an array for natural jq filtering:
 *   bdg dom a11y tree --json | jq '.data.nodes[] | select(.role == "checkbox")'
 *   bdg dom a11y tree --json | jq '.data.nodes[0]'
 *
 * @param options - Command options
 */
async function handleA11yTree(options: A11yTreeCommandOptions): Promise<void> {
  if (options.json) {
    await runJsonCommand(async () => {
      const tree = await collectA11yTree();
      return {
        root: tree.root,
        nodes: Array.from(tree.nodes.values()),
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
 * Handle bdg dom a11y describe <selector> command
 *
 * Gets accessibility properties for a DOM element by CSS/Playwright selector.
 * Useful for understanding how an element is exposed to assistive technologies.
 * Includes DOM context (tag, classes, text preview) when a11y data is sparse.
 *
 * @param selector - CSS/Playwright selector (e.g., "button.submit", ":text('Login')")
 * @param options - Command options
 *
 * @example
 * ```bash
 * bdg dom a11y describe "button.submit"
 * bdg dom a11y describe "#email"
 * bdg dom a11y describe "form input[type=password]"
 * bdg dom a11y describe ":has-text('Submit')"
 * ```
 */
async function handleA11yDescribe(
  selector: string,
  options: A11yDescribeCommandOptions
): Promise<void> {
  /**
   * Fetch a11y node data for a given selector.
   */
  async function fetchA11yNodeData(): Promise<A11yNodeWithContext> {
    const node = await resolveA11yNode(selector);

    if (!node) {
      throw new CommandError(elementNotFoundError(selector), {}, EXIT_CODES.RESOURCE_NOT_FOUND);
    }

    const domContext = await getDomContext(selector);

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
      'Quick search: CSS selector (#id, .class), pattern with "role:" or "name:" (query), or name search'
    )
    .enablePositionalOptions()
    .action(async (search: string | undefined, options: A11yDescribeCommandOptions) => {
      if (!search) {
        a11y.help();
        return;
      }

      const isCssSelector = /^[#.[]/u.test(search) || search.includes(' ');
      const isPatternQuery = /(?:role|name|description):/i.test(search);

      if (isCssSelector) {
        await handleA11yDescribe(search, options);
      } else if (isPatternQuery) {
        await handleA11yQuery(search, options);
      } else {
        // Default: treat as name search
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
    .description('Get accessibility properties for CSS/Playwright selector')
    .argument(
      '<selector>',
      'CSS/Playwright selector (e.g., "button.submit", ":has-text(\'Login\')")'
    )
    .addOption(jsonOption())
    .action(async (selector: string, options: A11yDescribeCommandOptions) => {
      await handleA11yDescribe(selector, options);
    });
}
