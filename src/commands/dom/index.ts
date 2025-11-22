import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { registerA11yCommands } from '@/commands/dom/a11y.js';
import {
  queryDOMElements,
  getDOMElements,
  capturePageScreenshot,
  getDomContext,
} from '@/commands/dom/helpers.js';
import type { DomGetOptions as DomGetHelperOptions, DomContext } from '@/commands/dom/helpers.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type {
  DomQueryCommandOptions,
  DomGetCommandOptions,
  DomScreenshotCommandOptions,
  DomEvalCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { resolveA11yNode } from '@/telemetry/a11y.js';
import { synthesizeA11yNode } from '@/telemetry/roleInference.js';
import type { A11yNode } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatDomQuery,
  formatDomGet,
  formatDomEval,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';
import { elementNotFoundError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Handle bdg dom query <selector> command
 *
 * Queries the DOM using a CSS selector and displays matching elements.
 * Uses CDP relay through worker's persistent connection.
 * Results are cached for index-based access via "bdg dom get <index>".
 *
 * @param selector - CSS selector to query (e.g., ".error", "#app", "button")
 * @param options - Command options
 */
async function handleDomQuery(selector: string, options: DomQueryCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const result = await queryDOMElements(selector);

      const cacheManager = QueryCacheManager.getInstance();
      const navigationId = await cacheManager.getCurrentNavigationId();
      const resultWithNavId = {
        ...result,
        ...(navigationId !== null && { navigationId }),
      };
      await cacheManager.set(resultWithNavId);

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
 * Supports index-based access from query results (e.g., "bdg dom get 0").
 *
 * @param selectorOrIndex - CSS selector (e.g., ".error") or numeric index from query results
 * @param options - Command options including --all, --nth, nodeId, and raw
 */
async function handleDomGet(selectorOrIndex: string, options: DomGetCommandOptions): Promise<void> {
  const isNumericIndex = /^\d+$/.test(selectorOrIndex);

  if (isNumericIndex) {
    await handleIndexGet(parseInt(selectorOrIndex, 10), options);
  } else {
    await handleSelectorGet(selectorOrIndex, options);
  }
}

/**
 * Handle get command with numeric index
 */
async function handleIndexGet(index: number, options: DomGetCommandOptions): Promise<void> {
  const resolver = DomElementResolver.getInstance();

  if (options.raw) {
    await runCommand(
      async () => {
        const targetNode = await resolver.getNodeIdForIndex(index);
        const getOptions = filterDefined({
          nodeId: targetNode.nodeId,
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
        const targetNode = await resolver.getNodeIdForIndex(index);
        const [a11yNode, domContext] = await Promise.all([
          resolveA11yNode('', targetNode.nodeId),
          getDomContext(targetNode.nodeId),
        ]);

        // Graceful degradation: synthesize node from DOM context when a11y unavailable
        const node =
          a11yNode ?? (domContext ? synthesizeA11yNode(domContext, targetNode.nodeId) : null);

        if (!node) {
          throw new CommandError(
            elementNotFoundError(`index ${index}`),
            {},
            EXIT_CODES.RESOURCE_NOT_FOUND
          );
        }

        return { success: true, data: { node, domContext } };
      },
      options,
      formatSemanticNodeWithContext
    );
  }
}

/**
 * Handle get command with CSS selector
 */
async function handleSelectorGet(selector: string, options: DomGetCommandOptions): Promise<void> {
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
        const a11yNode = await resolveA11yNode(selector);

        // Fetch DOM context for enrichment or fallback
        let domContext: DomContext | null = null;
        let nodeId: number | undefined;

        if (a11yNode?.backendDOMNodeId) {
          nodeId = a11yNode.backendDOMNodeId;
          domContext = await getDomContext(nodeId);
        } else if (!a11yNode) {
          // Try to get DOM context by querying the selector directly
          const { callCDP } = await import('@/ipc/client.js');
          const docResponse = await callCDP('DOM.getDocument', {});
          const doc = docResponse.data?.result as { root?: { nodeId?: number } } | undefined;
          if (doc?.root?.nodeId) {
            const queryResponse = await callCDP('DOM.querySelector', {
              nodeId: doc.root.nodeId,
              selector,
            });
            const queryResult = queryResponse.data?.result as { nodeId?: number } | undefined;
            if (queryResult?.nodeId) {
              nodeId = queryResult.nodeId;
              domContext = await getDomContext(nodeId);
            }
          }
        }

        // Graceful degradation: synthesize node from DOM context when a11y unavailable
        const node =
          a11yNode ?? (domContext && nodeId ? synthesizeA11yNode(domContext, nodeId) : null);

        if (!node) {
          throw new CommandError(elementNotFoundError(selector), {}, EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        return { success: true, data: { node, domContext } };
      },
      options,
      formatSemanticNodeWithContext
    );
  }
}

/**
 * Data structure for semantic node with DOM context.
 */
interface SemanticNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

/**
 * Formatter for single semantic node with DOM context fallback.
 *
 * When a11y name is missing, shows DOM context (tag, classes, text preview)
 * to provide useful information instead of just "[Role]".
 * Shows "(inferred from DOM)" indicator when node is synthesized.
 */
function formatSemanticNodeWithContext(data: SemanticNodeWithContext): string {
  const { node, domContext } = data;

  // Build the role text
  let roleText = `[${capitalize(node.role)}]`;
  if (node.role.toLowerCase() === 'heading' && node.properties?.['level'] !== undefined) {
    const level = node.properties['level'];
    const levelNum = typeof level === 'number' ? level : Number(level);
    if (!isNaN(levelNum)) {
      roleText = `[Heading L${levelNum}]`;
    }
  }

  // Build the name/context text
  let contextText = '';
  if (node.name) {
    // Use a11y name when available
    contextText = ` "${node.name}"`;
  } else if (domContext) {
    // Fallback to DOM context when a11y name is missing
    const tagPart = `<${domContext.tag}`;
    const classPart =
      domContext.classes && domContext.classes.length > 0
        ? `.${domContext.classes.slice(0, 3).join('.')}`
        : '';
    const previewPart = domContext.preview ? ` "${domContext.preview}"` : '';
    contextText = ` ${tagPart}${classPart}>${previewPart}`;
  }

  // Build properties text
  const props: string[] = [];
  if (node.focusable) props.push('focusable');
  if (node.focused) props.push('focused');
  if (node.disabled) props.push('disabled');
  if (node.required) props.push('required');
  const propsText = props.length > 0 ? ` (${props.join(', ')})` : '';

  // Add inferred indicator when node is synthesized from DOM
  const inferredText = node.inferred ? ' (inferred from DOM)' : '';

  return `${roleText}${contextText}${propsText}${inferredText}`;
}

/**
 * Capitalize first letter of string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
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
async function handleDomScreenshot(
  path: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
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
 * Handle bdg dom eval <script> command
 *
 * Evaluates arbitrary JavaScript in the browser context and returns the result.
 * Requires an active session. Uses CDP Runtime.evaluate with async support.
 * Note: This command uses direct CDP connection (not IPC) so it follows a different pattern.
 *
 * @param script - JavaScript expression to evaluate (e.g., "document.title", "window.location.href")
 * @param options - Command options including port and json formatting
 */
async function handleDomEval(script: string, options: DomEvalCommandOptions): Promise<void> {
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

      const portRule = positiveIntRule({ min: 1, max: 65535, default: 9222 });
      const port = portRule.validate(options.port);
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
    .action(async (selector: string, options: DomQueryCommandOptions) => {
      await handleDomQuery(selector, options);
    });

  dom
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option('-p, --port <number>', 'Chrome debugging port (default: 9222)')
    .option('-j, --json', 'Wrap result in version/success format')
    .action(async (script: string, options: DomEvalCommandOptions) => {
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
    .action(async (selector: string, options: DomGetCommandOptions) => {
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
    .action(async (path: string, options: DomScreenshotCommandOptions) => {
      await handleDomScreenshot(path, options);
    });
}
