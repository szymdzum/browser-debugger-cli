import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { queryDOM, highlightDOM, getDOM } from '@/ipc/client.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { getNodeIdByIndex } from './helpers/domCache.js';
import { parseSelectorOrIndex } from './helpers/selectorParser.js';

/**
 * Options for DOM query command
 */
interface DomQueryOptions {
  json?: boolean;
}

/**
 * Options for DOM highlight command
 */
interface DomHighlightOptions {
  first?: boolean;
  nth?: number;
  nodeId?: number;
  color?: string;
  opacity?: number;
  json?: boolean;
}

/**
 * Options for DOM get command
 */
interface DomGetOptions {
  all?: boolean;
  nth?: number;
  nodeId?: number;
  json?: boolean;
}

/**
 * Handle bdg dom query <selector> command
 *
 * @param selector - CSS selector to query
 * @param options - Command options
 */
async function handleDomQuery(selector: string, options: DomQueryOptions): Promise<void> {
  try {
    // Send query request via IPC to daemon/worker
    const response = await queryDOM(selector);

    if (response.status === 'error') {
      throw new Error(response.error ?? 'Unknown error');
    }

    if (!response.data) {
      throw new Error('No data in response');
    }

    const { count, nodes } = response.data;

    if (count === 0) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              selector,
              count: 0,
              nodes: [],
            },
            null,
            2
          )
        );
      } else {
        console.log(`No elements found matching "${selector}"`);
      }
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Output results
    if (options.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`Found ${count} element${count === 1 ? '' : 's'} matching "${selector}":`);
      for (const node of nodes) {
        const classInfo =
          node.classes && node.classes.length > 0 ? ` class="${node.classes.join(' ')}"` : '';
        console.log(`  [${node.index}] <${node.tag}${classInfo}> ${node.preview}`);
      }
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}

/**
 * Handle bdg dom highlight <selector|index> command
 *
 * @param selectorOrIndex - CSS selector or index from last query
 * @param options - Command options
 */
async function handleDomHighlight(
  selectorOrIndex: string,
  options: DomHighlightOptions
): Promise<void> {
  try {
    // Build IPC request options
    const ipcOptions: Parameters<typeof highlightDOM>[0] = {
      ...(options.color !== undefined && { color: options.color }),
      ...(options.opacity !== undefined && { opacity: options.opacity }),
      ...(options.first !== undefined && { first: options.first }),
      ...(options.nth !== undefined && { nth: options.nth }),
    };

    // Handle direct nodeId (advanced users)
    if (options.nodeId !== undefined) {
      ipcOptions.nodeId = options.nodeId;
    } else {
      const parsed = parseSelectorOrIndex(selectorOrIndex);

      if (parsed.type === 'index') {
        // Look up nodeId from cache
        const nodeId = getNodeIdByIndex(parsed.value as number);
        if (!nodeId) {
          throw new Error(
            `No cached element at index ${parsed.value}. Run 'bdg dom query <selector>' first.`
          );
        }
        ipcOptions.index = parsed.value as number;
      } else {
        // Query by selector
        ipcOptions.selector = parsed.value as string;
      }
    }

    // Send highlight request via IPC to daemon/worker
    const response = await highlightDOM(ipcOptions);

    if (response.status === 'error') {
      throw new Error(response.error ?? 'Unknown error');
    }

    if (!response.data) {
      throw new Error('No data in response');
    }

    // Output result
    if (options.json) {
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(
        `✓ Highlighted ${response.data.highlighted} element${response.data.highlighted === 1 ? '' : 's'}`
      );
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}

/**
 * Handle bdg dom get <selector|index> command
 *
 * @param selectorOrIndex - CSS selector or index from last query
 * @param options - Command options
 */
async function handleDomGet(selectorOrIndex: string, options: DomGetOptions): Promise<void> {
  try {
    // Build IPC request options
    const ipcOptions: Parameters<typeof getDOM>[0] = {
      ...(options.all !== undefined && { all: options.all }),
      ...(options.nth !== undefined && { nth: options.nth }),
    };

    // Handle direct nodeId (advanced users)
    if (options.nodeId !== undefined) {
      ipcOptions.nodeId = options.nodeId;
    } else {
      const parsed = parseSelectorOrIndex(selectorOrIndex);

      if (parsed.type === 'index') {
        // Look up nodeId from cache
        const nodeId = getNodeIdByIndex(parsed.value as number);
        if (!nodeId) {
          throw new Error(
            `No cached element at index ${parsed.value}. Run 'bdg dom query <selector>' first.`
          );
        }
        ipcOptions.index = parsed.value as number;
      } else {
        // Query by selector
        ipcOptions.selector = parsed.value as string;
      }
    }

    // Send get request via IPC to daemon/worker
    const response = await getDOM(ipcOptions);

    if (response.status === 'error') {
      throw new Error(response.error ?? 'Unknown error');
    }

    if (!response.data) {
      throw new Error('No data in response');
    }

    const { nodes } = response.data;

    // Output results
    if (options.json) {
      console.log(JSON.stringify(nodes.length === 1 ? nodes[0] : nodes, null, 2));
    } else {
      if (nodes.length === 1) {
        const firstNode = nodes[0];
        if (firstNode) {
          console.log(firstNode.outerHTML);
        }
      } else {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node) {
            console.log(`[${i + 1}] ${node.outerHTML}`);
          }
        }
      }
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}

/**
 * Register DOM collector commands
 *
 * @param program - Commander.js Command instance
 */
export function registerDomCommands(program: Command): void {
  const dom = program.command('dom').description('DOM inspection and manipulation');

  // bdg dom query <selector>
  dom
    .command('query')
    .description('Find elements by CSS selector')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomQueryOptions) => {
      await handleDomQuery(selector, options);
    });

  // bdg dom highlight <selector|index>
  dom
    .command('highlight')
    .description('Highlight elements in browser')
    .argument('<selector|index>', 'CSS selector or index from last query')
    .option('--first', 'Target first match only')
    .option('--nth <n>', 'Target nth match', parseInt)
    .option('--node-id <id>', 'Use nodeId directly (advanced)', parseInt)
    .option('--color <color>', 'Highlight color (red, blue, green, yellow, orange, purple)')
    .option('--opacity <value>', 'Highlight opacity (0.0 - 1.0)', parseFloat)
    .option('-j, --json', 'Output as JSON')
    .action(async (selectorOrIndex: string, options: DomHighlightOptions) => {
      await handleDomHighlight(selectorOrIndex, options);
    });

  // bdg dom get <selector|index>
  dom
    .command('get')
    .description('Get full HTML and attributes for elements')
    .argument('<selector|index>', 'CSS selector or index from last query')
    .option('--all', 'Target all matches')
    .option('--nth <n>', 'Target nth match', parseInt)
    .option('--node-id <id>', 'Use nodeId directly (advanced)', parseInt)
    .option('-j, --json', 'Output as JSON')
    .action(async (selectorOrIndex: string, options: DomGetOptions) => {
      await handleDomGet(selectorOrIndex, options);
    });
}
