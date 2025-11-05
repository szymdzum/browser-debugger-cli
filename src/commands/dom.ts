import type { Command } from 'commander';

import { OutputBuilder } from '@/commands/shared/OutputBuilder.js';
import { queryDOM, highlightDOM, getDOM } from '@/ipc/client.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { handleCommandError } from './domErrorHandler.js';
import { buildSelectorOptions } from './domOptionsBuilder.js';

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
 * Queries the DOM using a CSS selector and displays matching elements.
 * Results are cached for 5 minutes to enable index-based references in other commands.
 *
 * @param selector - CSS selector to query (e.g., ".error", "#app", "button")
 * @param options - Command options
 * @throws Error When IPC request fails or returns error response
 * @throws Error When response data is missing
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
    handleCommandError(error, options.json ?? false);
  }
}

/**
 * Handle bdg dom highlight command
 *
 * Highlights elements in the browser with visual overlay. Accepts CSS selector,
 * cached index from previous query, or direct nodeId.
 *
 * @param selectorOrIndex - CSS selector (e.g., ".error") or index from cached query (e.g., "2")
 * @param options - Command options including color, opacity, targeting flags, and nodeId
 * @throws Error When cached index not found (user must run 'bdg dom query' first)
 * @throws Error When IPC request fails or returns error response
 * @throws Error When response data is missing
 */
async function handleDomHighlight(
  selectorOrIndex: string,
  options: DomHighlightOptions
): Promise<void> {
  try {
    // Build base IPC request options (color, opacity, targeting)
    const ipcOptions: Parameters<typeof highlightDOM>[0] = {
      ...(options.color !== undefined && { color: options.color }),
      ...(options.opacity !== undefined && { opacity: options.opacity }),
      ...(options.first !== undefined && { first: options.first }),
      ...(options.nth !== undefined && { nth: options.nth }),
    };

    // Add selector/index/nodeId using shared helper
    const selectorOptions = buildSelectorOptions<Parameters<typeof highlightDOM>[0]>(
      selectorOrIndex,
      options.nodeId
    );
    Object.assign(ipcOptions, selectorOptions);

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
    handleCommandError(error, options.json ?? false);
  }
}

/**
 * Handle bdg dom get command
 *
 * Retrieves full HTML and attributes for DOM elements. Accepts CSS selector,
 * cached index from previous query, or direct nodeId.
 *
 * @param selectorOrIndex - CSS selector (e.g., ".error") or index from cached query (e.g., "2")
 * @param options - Command options including --all, --nth, and nodeId
 * @throws Error When cached index not found (user must run 'bdg dom query' first)
 * @throws Error When IPC request fails or returns error response
 * @throws Error When response data is missing
 */
async function handleDomGet(selectorOrIndex: string, options: DomGetOptions): Promise<void> {
  try {
    // Build base IPC request options (targeting flags)
    const ipcOptions: Parameters<typeof getDOM>[0] = {
      ...(options.all !== undefined && { all: options.all }),
      ...(options.nth !== undefined && { nth: options.nth }),
    };

    // Add selector/index/nodeId using shared helper
    const selectorOptions = buildSelectorOptions<Parameters<typeof getDOM>[0]>(
      selectorOrIndex,
      options.nodeId
    );
    Object.assign(ipcOptions, selectorOptions);

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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        console.log(nodes[0]!.outerHTML);
      } else {
        for (const [i, node] of nodes.entries()) {
          console.log(`[${i + 1}] ${node.outerHTML}`);
        }
      }
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    handleCommandError(error, options.json ?? false);
  }
}

/**
 * Options for DOM eval command
 */
interface DomEvalOptions {
  json?: boolean;
  port?: string;
}

/**
 * Handle bdg dom eval <script> command
 *
 * Evaluates arbitrary JavaScript in the browser context and returns the result.
 * Requires an active session. Uses CDP Runtime.evaluate with async support.
 *
 * @param script - JavaScript expression to evaluate (e.g., "document.title", "window.location.href")
 * @param options - Command options including port and json formatting
 * @throws Error When no active session is running
 * @throws Error When session metadata is invalid
 * @throws Error When target no longer exists (tab closed)
 * @throws Error When CDP connection fails
 * @throws Error When script execution throws exception
 */
async function handleDomEval(script: string, options: DomEvalOptions): Promise<void> {
  try {
    // Lazy load CDP connection (only needed for eval command)
    const { CDPConnection } = await import('@/connection/cdp.js');
    const {
      validateActiveSession,
      getValidatedSessionMetadata,
      verifyTargetExists,
      executeScript,
    } = await import('./domEvalHelpers.js');

    // Validate session is running
    const jsonOutput = options.json ?? false;
    validateActiveSession(jsonOutput);

    // Get and validate session metadata
    const metadata = getValidatedSessionMetadata(jsonOutput);

    // Verify target still exists
    const port = parseInt(options.port ?? '9222', 10);
    await verifyTargetExists(metadata, port, jsonOutput);

    // Create temporary CDP connection and execute script
    const cdp = new CDPConnection();
    // getValidatedSessionMetadata ensures webSocketDebuggerUrl is defined
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await cdp.connect(metadata.webSocketDebuggerUrl!);

    const result = await executeScript(cdp, script);
    cdp.close();

    // Output result (wrapped if --json, raw otherwise)
    if (options.json) {
      console.log(
        JSON.stringify(
          OutputBuilder.buildJsonSuccess({
            result: result.result?.value,
          }),
          null,
          2
        )
      );
    } else {
      console.log(JSON.stringify(result.result?.value, null, 2));
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    handleCommandError(error, options.json ?? false);
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

  // bdg dom eval <script>
  dom
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option('-p, --port <number>', 'Chrome debugging port (default: 9222)')
    .option('-j, --json', 'Wrap result in version/success format')
    .action(async (script: string, options: DomEvalOptions) => {
      await handleDomEval(script, options);
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
