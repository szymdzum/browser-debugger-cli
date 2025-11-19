import type { Command } from 'commander';

import { registerA11yCommands } from '@/commands/dom/a11y.js';
import { queryDOMElements, getDOMElements, capturePageScreenshot } from '@/commands/dom/helpers.js';
import type { DomGetOptions as DomGetHelperOptions } from '@/commands/dom/helpers.js';
import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { getA11yNodeBySelector } from '@/telemetry/a11y.js';
import type { A11yNode } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatDomQuery,
  formatDomGet,
  formatDomEval,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';
import { semantic } from '@/ui/formatters/semantic.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { parsePositiveIntOption } from '@/utils/validation.js';

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
  raw?: boolean;
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
 * Retrieves semantic accessibility structure by default (70% token reduction).
 * Use --raw flag for full HTML output.
 *
 * @param selector - CSS selector (e.g., ".error")
 * @param options - Command options including --all, --nth, nodeId, and raw
 */
async function handleDomGet(selector: string, options: DomGetOptions): Promise<void> {
  if (options.raw) {
    await runCommand(
      async () => {
        const getOptions = filterDefined({
          selector,
          all: options.all,
          nth: options.nth,
          nodeId: options.nodeId,
        }) as DomGetHelperOptions;

        const result = await getDOMElements(getOptions);
        return { success: true, data: result };
      },
      options,
      formatDomGet
    );
  } else {
    await runCommand(
      async () => {
        const node = await getA11yNodeBySelector(selector);

        if (!node) {
          throw new CommandError(
            `Element not found or has no accessibility information: ${selector}`,
            { suggestion: 'Try: bdg dom query <selector> to verify element exists' },
            EXIT_CODES.RESOURCE_NOT_FOUND
          );
        }

        return { success: true, data: node };
      },
      options,
      (node: A11yNode) => {
        const fakeTree = {
          root: node,
          nodes: new Map([[node.nodeId, node]]),
          count: 1,
        };
        return semantic(fakeTree);
      }
    );
  }
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
      const screenshotOptions = filterDefined({
        format: options.format,
        quality: options.quality,
        fullPage: options.fullPage,
      }) as { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean };

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
      const { CDPConnection } = await import('@/connection/cdp.js');
      const {
        validateActiveSession,
        getValidatedSessionMetadata,
        verifyTargetExists,
        executeScript,
      } = await import('@/commands/dom/evalHelpers.js');

      validateActiveSession();

      const metadata = getValidatedSessionMetadata();

      const port = parsePositiveIntOption('port', options.port, {
        defaultValue: 9222,
        min: 1,
        max: 65535,
      });
      await verifyTargetExists(metadata, port);

      const cdp = new CDPConnection();
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

  registerA11yCommands(dom);

  dom
    .command('query')
    .description('Find elements by CSS selector')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomQueryOptions) => {
      await handleDomQuery(selector, options);
    });

  dom
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option('-p, --port <number>', 'Chrome debugging port (default: 9222)')
    .option('-j, --json', 'Wrap result in version/success format')
    .action(async (script: string, options: DomEvalOptions) => {
      await handleDomEval(script, options);
    });

  dom
    .command('get')
    .description('Get semantic accessibility structure (default) or raw HTML (--raw)')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('--raw', 'Output raw HTML with all filtering options')
    .option('--all', 'Get all matches (only with --raw)')
    .option('--nth <n>', 'Get nth match (only with --raw)', parseInt)
    .option('--node-id <id>', 'Use nodeId directly (only with --raw)', parseInt)
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomGetOptions) => {
      await handleDomGet(selector, options);
    });

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
