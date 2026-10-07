/**
 * Accessibility tree inspection commands for semantic element queries.
 *
 * Provides three core commands:
 * - tree: List the accessibility tree (bounded by --limit / --depth)
 * - query: Search by role/name/description patterns
 * - describe: Get A11y properties for CSS selector
 *
 * Uses IPC/callCDP pattern for consistency with other DOM commands.
 */

import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import {
  getDomContext,
  pageDocumentId,
  resolveBackendNodeIds,
} from '@/commands/dom/helpers/index.js';
import type { DomContext } from '@/commands/dom/helpers/index.js';
import { withSecretMasked } from '@/commands/dom/semanticUtils.js';
import { runCommand, runJsonCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  A11yTreeCommandOptions,
  A11yQueryCommandOptions,
  A11yDescribeCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { QUERY_JSON_LIST_LIMIT } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import {
  elementNotFoundError,
  invalidQueryPatternError,
  noA11yNodesFoundError,
  notInAccessibilityTreeError,
} from '@/errors/messages.js';
import { A11Y_CACHE_SELECTOR_PREFIX, QueryCacheManager } from '@/session/QueryCacheManager.js';
import {
  a11yIgnoredReasons,
  collectA11yTree,
  listA11yTree,
  queryA11yTree,
  parseQueryPattern,
  resolveA11yNode,
} from '@/telemetry/a11y.js';
import type { A11yNode, A11yQueryResult, ListedA11yTree } from '@/types.js';
import {
  formatA11yTree,
  formatA11yQueryResult,
  formatA11yNodeWithContext,
} from '@/ui/formatters/a11y.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Matches `dom a11y query` lists by default in human output (a page can have hundreds of links) */
const A11Y_QUERY_LIMIT = 50;

/** Nodes `dom a11y tree` lists by default, in human and JSON output */
const A11Y_TREE_LIMIT = 50;

/**
 * Handle bdg dom a11y tree command
 *
 * Lists the accessibility tree depth-first, the first `--limit` meaningful
 * nodes (default {@link A11Y_TREE_LIMIT}, 0 = all) down to `--depth`, in
 * human and JSON output; `count` is the whole tree, `omitted` the nodes cut
 * and `skipped` the noise never listed.
 *
 * JSON output returns nodes as an array (each with its `depth`) for jq:
 *   bdg dom a11y tree --json --limit 0 | jq '.data.nodes[] | select(.role == "checkbox")'
 *
 * @param options - Command options
 */
async function handleA11yTree(options: A11yTreeCommandOptions): Promise<void> {
  const listTree = async (): Promise<ListedA11yTree> =>
    listA11yTree(await collectA11yTree(), options.limit ?? A11Y_TREE_LIMIT, options.depth);

  if (options.json) {
    await runJsonCommand(listTree);
  }

  await runCommand(
    async () => ({ success: true, data: await listTree() }),
    options,
    formatA11yTree
  );
}

/**
 * Quote a search text for a query pattern, keeping the quotes it contains
 * (`Say "hi"` is searched as is).
 *
 * @param text - Accessible name to search for
 * @returns Quoted value (unquoted only if it contains both kinds of quotes)
 */
function quoteQueryValue(text: string): string {
  if (!text.includes('"')) return `"${text}"`;
  if (!text.includes("'")) return `'${text}'`;
  return text;
}

/**
 * Handle bdg dom a11y query <pattern> command
 *
 * Queries the accessibility tree using role/name/description patterns via IPC.
 * Pattern format: "role:button name:Submit" (key:value or key=value pairs; a
 * name or description may contain spaces and colons)
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

      const document = await pageDocumentId();
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

      const indexed = { ...result, nodes: result.nodes.map((node, index) => ({ ...node, index })) };
      await QueryCacheManager.getInstance().set(
        {
          selector: `${A11Y_CACHE_SELECTOR_PREFIX}${pattern}`,
          count: indexed.count,
          nodes: indexed.nodes.map((node) => ({
            index: node.index,
            nodeId: node.backendDOMNodeId ?? 0,
            tag: node.role,
            ...(node.name && { preview: node.name }),
          })),
        },
        document
      );
      return {
        success: true,
        data: limitMatches(
          indexed,
          options.limit ?? (options.json ? QUERY_JSON_LIST_LIMIT : A11Y_QUERY_LIMIT)
        ),
      };
    },
    options,
    formatA11yQueryResult
  );
}

/**
 * The matches to list: the first `limit` (all with 0), counting the rest as
 * omitted. All of them are cached, so their indices work either way.
 *
 * @param result - Query result
 * @param limit - Matches to list (0 = all)
 * @returns The result with the listed matches
 */
export function limitMatches(result: A11yQueryResult, limit: number): A11yQueryResult {
  if (limit === 0 || result.nodes.length <= limit) return result;
  return { ...result, nodes: result.nodes.slice(0, limit), omitted: result.nodes.length - limit };
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
    const backendNodeId = isNumericIndex
      ? (await resolver.getNodeIdForIndex(parseInt(selectorOrIndex, 10))).nodeId
      : (await resolveBackendNodeIds([selectorOrIndex]))[0];
    if (backendNodeId === undefined) {
      const err = elementNotFoundError(selectorOrIndex);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }
    const node = await resolveA11yNode({ backendNodeId });
    if (!node) {
      const reasons = await a11yIgnoredReasons({ backendNodeId });
      const err = notInAccessibilityTreeError(selectorOrIndex, reasons);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    let domContext: DomContext | null = null;
    const domNodeId = node.backendDOMNodeId ?? backendNodeId;
    if (domNodeId) {
      domContext = await getDomContext({ backendNodeId: domNodeId });
    }

    return { node: withSecretMasked(node, domContext), domContext };
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
    .addOption(jsonOption())
    .action(async (search: string | undefined, options: A11yDescribeCommandOptions) => {
      if (!search) {
        return a11y.help({ error: true });
      }

      const isNumericIndex = /^\d+$/.test(search);
      const isCssSelector = /^[#.[]/u.test(search);
      const isPatternQuery = /^(role|name|description|desc)\s*[:=]/i.test(search);

      if (isNumericIndex || isCssSelector) {
        await handleA11yDescribe(search, options);
      } else if (isPatternQuery) {
        await handleA11yQuery(search, options);
      } else {
        await handleA11yQuery(`name:${quoteQueryValue(search)}`, options);
      }
    });

  a11y
    .command('tree')
    .description(
      'List the accessibility tree depth-first (ignored nodes, text boxes, repeated text and nameless wrappers left out)'
    )
    .option(
      '--limit <n>',
      `Nodes to list (default: ${A11Y_TREE_LIMIT}, also with --json; 0 = all listed nodes (text boxes and empty wrappers are always skipped))`,
      integerOption(0)
    )
    .option(
      '--depth <n>',
      'Levels below the root to list (0 = root only; default: all)',
      integerOption(0)
    )
    .addOption(jsonOption())
    .action(async (options: A11yTreeCommandOptions) => {
      await handleA11yTree(options);
    });

  a11y
    .command('query')
    .description('Query elements by accessibility properties (e.g., "role:button", "name:Submit")')
    .argument(
      '<pattern>',
      "Fields role, name, description as key:value or key=value, separated by spaces or commas; * is a wildcard. A name or description runs to the next field or the end, so it may contain spaces and colons; quote the whole pattern (e.g. 'role=button name=Sign in', 'name=E-mail address:')"
    )
    .option(
      '--limit <n>',
      `Matches to list (default: ${A11Y_QUERY_LIMIT}, ${QUERY_JSON_LIST_LIMIT} with --json; 0 = all); all are indexed`,
      integerOption(0)
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
