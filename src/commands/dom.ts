import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { queryDOM, getDOM, captureScreenshot } from '@/ipc/client.js';
import {
  formatDomQuery,
  formatDomGet,
  formatDomEval,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';
import { filterDefined } from '@/utils/objects.js';

import { mergeWithSelector } from './domOptionsBuilder.js';

/**
 * Options for DOM query command
 */
type DomQueryOptions = BaseCommandOptions;

/**
 * Options for DOM get command
 */
interface DomGetOptions extends BaseCommandOptions {
  all?: boolean;
  nth?: number;
  nodeId?: number;
}

/**
 * Options for DOM screenshot command
 */
interface DomScreenshotOptions extends BaseCommandOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
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
      // Build IPC options with selector/index/nodeId merged
      const ipcOptions = mergeWithSelector<Parameters<typeof getDOM>[0]>(
        filterDefined({
          all: options.all,
          nth: options.nth,
        }) as Parameters<typeof getDOM>[0],
        selectorOrIndex,
        options.nodeId
      );

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
 * Handle bdg dom screenshot <path> command
 *
 * Captures a screenshot of the current page and saves it to disk.
 * Supports PNG and JPEG formats with customizable quality and viewport options.
 *
 * @param path - Output file path (absolute or relative)
 * @param options - Screenshot options (format, quality, fullPage)
 */
async function handleDomScreenshot(path: string, options: DomScreenshotOptions): Promise<void> {
  await runCommand(
    async () => {
      const screenshotOptions = filterDefined({
        format: options.format,
        quality: options.quality,
        fullPage: options.fullPage,
      }) as { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean };

      const response = await captureScreenshot(path, screenshotOptions);

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
    formatDomScreenshot
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

  // bdg dom screenshot <path>
  dom
    .command('screenshot')
    .description('Capture page screenshot')
    .argument('<path>', 'Output file path (e.g., "./screenshot.png")')
    .option('--format <format>', 'Image format: png or jpeg (default: png)')
    .option('--quality <number>', 'JPEG quality 0-100 (default: 90)', parseInt)
    .option('--no-full-page', 'Capture viewport only (default: full page)')
    .option('-j, --json', 'Output as JSON')
    .action(async (path: string, options: DomScreenshotOptions) => {
      await handleDomScreenshot(path, options);
    });
}
