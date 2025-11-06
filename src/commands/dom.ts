import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { queryDOM, highlightDOM, getDOM } from '@/ipc/client.js';
import {
  formatDomQuery,
  formatDomHighlight,
  formatDomGet,
  formatDomEval,
} from '@/ui/formatters/dom.js';

import { buildSelectorOptions } from './domOptionsBuilder.js';

/**
 * Options for DOM query command
 */
type DomQueryOptions = BaseCommandOptions;

/**
 * Options for DOM highlight command
 */
interface DomHighlightOptions extends BaseCommandOptions {
  first?: boolean;
  nth?: number;
  nodeId?: number;
  color?: string;
  opacity?: number;
}

/**
 * Options for DOM get command
 */
interface DomGetOptions extends BaseCommandOptions {
  all?: boolean;
  nth?: number;
  nodeId?: number;
}

/**
 * Handle bdg dom query <selector> command
 *
 * Queries the DOM using a CSS selector and displays matching elements.
 * Results are cached for 5 minutes to enable index-based references in other commands.
 *
 * @param selector - CSS selector to query (e.g., ".error", "#app", "button")
 * @param options - Command options
 */
async function handleDomQuery(selector: string, options: DomQueryOptions): Promise<void> {
  await runCommand(
    async () => {
      const response = await queryDOM(selector);

      if (response.status === 'error') {
        return {
          success: false,
          error: response.error ?? 'Unknown error',
        };
      }

      if (!response.data) {
        return {
          success: false,
          error: 'No data in response',
        };
      }

      return {
        success: true,
        data: response.data,
      };
    },
    options,
    formatDomQuery
  );
}

/**
 * Handle bdg dom highlight command
 *
 * Highlights elements in the browser with visual overlay. Accepts CSS selector,
 * cached index from previous query, or direct nodeId.
 *
 * @param selectorOrIndex - CSS selector (e.g., ".error") or index from cached query (e.g., "2")
 * @param options - Command options including color, opacity, targeting flags, and nodeId
 */
async function handleDomHighlight(
  selectorOrIndex: string,
  options: DomHighlightOptions
): Promise<void> {
  await runCommand(
    async () => {
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

      const response = await highlightDOM(ipcOptions);

      if (response.status === 'error') {
        return {
          success: false,
          error: response.error ?? 'Unknown error',
        };
      }

      if (!response.data) {
        return {
          success: false,
          error: 'No data in response',
        };
      }

      return {
        success: true,
        data: response.data,
      };
    },
    options,
    formatDomHighlight
  );
}

/**
 * Handle bdg dom get command
 *
 * Retrieves full HTML and attributes for DOM elements. Accepts CSS selector,
 * cached index from previous query, or direct nodeId.
 *
 * @param selectorOrIndex - CSS selector (e.g., ".error") or index from cached query (e.g., "2")
 * @param options - Command options including --all, --nth, and nodeId
 */
async function handleDomGet(selectorOrIndex: string, options: DomGetOptions): Promise<void> {
  await runCommand(
    async () => {
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

      const response = await getDOM(ipcOptions);

      if (response.status === 'error') {
        return {
          success: false,
          error: response.error ?? 'Unknown error',
        };
      }

      if (!response.data) {
        return {
          success: false,
          error: 'No data in response',
        };
      }

      return {
        success: true,
        data: response.data,
      };
    },
    options,
    formatDomGet
  );
}

/**
 * Options for DOM eval command
 */
interface DomEvalOptions extends BaseCommandOptions {
  port?: string;
}

/**
 * Handle bdg dom eval <script> command
 *
 * Evaluates arbitrary JavaScript in the browser context and returns the result.
 * Requires an active session. Uses CDP Runtime.evaluate with async support.
 * Note: This command uses direct CDP connection (not IPC) so it follows a different pattern.
 *
 * @param script - JavaScript expression to evaluate (e.g., "document.title", "window.location.href")
 * @param options - Command options including port and json formatting
 */
async function handleDomEval(script: string, options: DomEvalOptions): Promise<void> {
  await runCommand(
    async () => {
      // Lazy load CDP connection (only needed for eval command)
      const { CDPConnection } = await import('@/connection/cdp.js');
      const {
        validateActiveSession,
        getValidatedSessionMetadata,
        verifyTargetExists,
        executeScript,
      } = await import('./domEvalHelpers.js');

      // Validate session is running
      validateActiveSession();

      // Get and validate session metadata
      const metadata = getValidatedSessionMetadata();

      // Verify target still exists
      const port = parseInt(options.port ?? '9222', 10);
      await verifyTargetExists(metadata, port);

      // Create temporary CDP connection and execute script
      const cdp = new CDPConnection();
      // getValidatedSessionMetadata ensures webSocketDebuggerUrl is defined
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await cdp.connect(metadata.webSocketDebuggerUrl!);

      const result = await executeScript(cdp, script);
      cdp.close();

      return {
        success: true,
        data: { result: result.result?.value },
      };
    },
    options,
    formatDomEval
  );
}

/**
 * Register DOM telemetry commands
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
