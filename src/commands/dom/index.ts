import type { Command } from 'commander';

import { queryDOMElements, getDOMElements, capturePageScreenshot } from '@/commands/dom/helpers.js';
import type { DomGetOptions as DomGetHelperOptions } from '@/commands/dom/helpers.js';
import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatDomQuery,
  formatDomGet,
  formatDomEval,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
 * Uses CDP relay through worker's persistent connection.
 *
 * @param selector - CSS selector to query (e.g., ".error", "#app", "button")
 * @param options - Command options
 */
async function handleDomQuery(selector: string, options: DomQueryOptions): Promise<void> {
  await runCommand(
    async () => {
      const result = await queryDOMElements(selector);
      return { success: true, data: result };
    },
    options,
    formatDomQuery
  );
}

/**
 * Handle bdg dom get command
 *
 * Retrieves full HTML and attributes for DOM elements. Accepts CSS selector or direct nodeId.
 * Uses CDP relay through worker's persistent connection.
 *
 * @param selector - CSS selector (e.g., ".error")
 * @param options - Command options including --all, --nth, and nodeId
 */
async function handleDomGet(selector: string, options: DomGetOptions): Promise<void> {
  await runCommand(
    async () => {
      const getOptions: DomGetHelperOptions = { selector };
      if (options.all !== undefined) getOptions.all = options.all;
      if (options.nth !== undefined) getOptions.nth = options.nth;
      if (options.nodeId !== undefined) getOptions.nodeId = options.nodeId;

      const result = await getDOMElements(getOptions);
      return { success: true, data: result };
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
 * Uses CDP relay through worker's persistent connection.
 *
 * @param path - Output file path (absolute or relative)
 * @param options - Screenshot options (format, quality, fullPage)
 */
async function handleDomScreenshot(path: string, options: DomScreenshotOptions): Promise<void> {
  await runCommand(
    async () => {
      const screenshotOptions: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } =
        {};
      if (options.format !== undefined) screenshotOptions.format = options.format;
      if (options.quality !== undefined) screenshotOptions.quality = options.quality;
      if (options.fullPage !== undefined) screenshotOptions.fullPage = options.fullPage;

      const result = await capturePageScreenshot(path, screenshotOptions);
      return { success: true, data: result };
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
      } = await import('@/commands/dom/evalHelpers.js');

      // Validate session is running
      validateActiveSession();

      // Get and validate session metadata
      const metadata = getValidatedSessionMetadata();

      // Verify target still exists
      const port = parseInt(options.port ?? '9222', 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new CommandError(
          'Invalid port number',
          { suggestion: 'Port must be an integer between 1 and 65535' },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }
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

  // bdg dom get <selector>
  dom
    .command('get')
    .description('Get full HTML and attributes for elements')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('--all', 'Target all matches')
    .option('--nth <n>', 'Target nth match', parseInt)
    .option('--node-id <id>', 'Use nodeId directly (advanced)', parseInt)
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomGetOptions) => {
      await handleDomGet(selector, options);
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
