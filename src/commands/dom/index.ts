import type { Command } from 'commander';
import type * as FsModule from 'fs';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { registerA11yCommands } from '@/commands/dom/a11y.js';
import {
  queryDOMElements,
  getDOMElements,
  capturePageScreenshot,
  captureElementScreenshot,
  resolveSelector,
  getDomContext,
} from '@/commands/dom/helpers.js';
import type { DomGetOptions as DomGetHelperOptions, DomContext } from '@/commands/dom/helpers.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
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
import type { A11yNode, ScreenshotResult, ElementBounds } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  formatDomQuery,
  formatDomGet,
  formatDomEval,
  formatDomScreenshot,
} from '@/ui/formatters/dom.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  missingArgumentError,
  elementAtIndexNotFoundError,
  noNodesFoundError,
} from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('dom');

/**
 * Screenshot options after filtering undefined values.
 */
type FilteredScreenshotOptions = {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  noResize?: boolean;
  scroll?: string;
};

/**
 * Element screenshot options after filtering undefined values.
 */
type FilteredElementOptions = { format?: 'png' | 'jpeg'; quality?: number; noResize?: boolean };

/**
 * Data structure for semantic node with DOM context.
 */
interface SemanticNodeWithContext {
  node: A11yNode;
  domContext: DomContext | null;
}

/**
 * Build filtered screenshot options from command options.
 *
 * @param options - Raw command options
 * @returns Filtered options with undefined values removed
 */
function buildPageScreenshotOptions(
  options: DomScreenshotCommandOptions
): FilteredScreenshotOptions {
  return filterDefined({
    format: options.format,
    quality: options.quality,
    fullPage: options.fullPage,
    noResize: options.resize === false,
    scroll: options.scroll,
  }) as FilteredScreenshotOptions;
}

/**
 * Build filtered element screenshot options from command options.
 *
 * @param options - Raw command options
 * @returns Filtered options with undefined values removed
 */
function buildElementScreenshotOptions(
  options: DomScreenshotCommandOptions
): FilteredElementOptions {
  return filterDefined({
    format: options.format,
    quality: options.quality,
    noResize: options.resize === false,
  }) as FilteredElementOptions;
}

/**
 * Check if options specify an element target.
 *
 * @param options - Screenshot command options
 * @returns True if selector or index is specified
 */
function hasElementTarget(options: DomScreenshotCommandOptions): boolean {
  return options.selector !== undefined || options.index !== undefined;
}

/**
 * Resolve element nodeId from selector or cached index.
 *
 * @param options - Options containing selector or index
 * @returns CDP nodeId
 * @throws CommandError if neither selector nor index provided
 */
async function resolveElementNodeId(options: DomScreenshotCommandOptions): Promise<number> {
  if (options.index !== undefined) {
    const resolver = DomElementResolver.getInstance();
    const node = await resolver.getNodeIdForIndex(options.index);
    return node.nodeId;
  }

  if (options.selector !== undefined) {
    return resolveSelector(options.selector);
  }

  const err = missingArgumentError('--selector "css-selector" or --index N from a previous query');
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Add element metadata to screenshot result.
 *
 * @param result - Base screenshot result
 * @param options - Options containing selector or index
 * @returns Screenshot result with element info
 */
function addElementInfo(
  result: ScreenshotResult,
  options: DomScreenshotCommandOptions
): ScreenshotResult {
  const bounds: ElementBounds = {
    x: 0,
    y: 0,
    width: result.width,
    height: result.height,
  };

  return {
    ...result,
    element: {
      ...(options.selector !== undefined && { selector: options.selector }),
      ...(options.index !== undefined && { index: options.index }),
      bounds,
    },
  };
}

/**
 * Ensure directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 * @param fs - File system module
 */
function ensureDirectory(dirPath: string, fs: typeof FsModule): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Format frame filename with zero-padded number.
 *
 * @param frameNumber - Frame number (1-based)
 * @param format - Image format extension
 * @returns Formatted filename
 */
function formatFrameFilename(frameNumber: number, format: string): string {
  return `${String(frameNumber).padStart(3, '0')}.${format}`;
}

/**
 * Capitalize first letter of string.
 *
 * @param str - Input string
 * @returns String with first letter capitalized
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Build role text for accessibility node display.
 *
 * @param node - Accessibility node
 * @returns Formatted role text
 */
function buildRoleText(node: A11yNode): string {
  if (node.role.toLowerCase() === 'heading' && node.properties?.['level'] !== undefined) {
    const level = node.properties['level'];
    const levelNum = typeof level === 'number' ? level : Number(level);
    if (!isNaN(levelNum)) {
      return `[Heading L${levelNum}]`;
    }
  }
  return `[${capitalize(node.role)}]`;
}

/**
 * Build context text from a11y name or DOM context fallback.
 *
 * @param node - Accessibility node
 * @param domContext - DOM context for fallback
 * @returns Formatted context text
 */
function buildContextText(node: A11yNode, domContext: DomContext | null): string {
  if (node.name) {
    return ` "${node.name}"`;
  }

  if (domContext) {
    const tagPart = `<${domContext.tag}`;
    const classPart =
      domContext.classes && domContext.classes.length > 0
        ? `.${domContext.classes.slice(0, 3).join('.')}`
        : '';
    const previewPart = domContext.preview ? ` "${domContext.preview}"` : '';
    return ` ${tagPart}${classPart}>${previewPart}`;
  }

  return '';
}

/**
 * Build properties text from accessibility node state.
 *
 * @param node - Accessibility node
 * @returns Formatted properties text
 */
function buildPropertiesText(node: A11yNode): string {
  const props: string[] = [];
  if (node.focusable) props.push('focusable');
  if (node.focused) props.push('focused');
  if (node.disabled) props.push('disabled');
  if (node.required) props.push('required');
  return props.length > 0 ? ` (${props.join(', ')})` : '';
}

/**
 * Format semantic node with DOM context for display.
 *
 * @param data - Node and context data
 * @returns Formatted string representation
 */
function formatSemanticNodeWithContext(data: SemanticNodeWithContext): string {
  const { node, domContext } = data;
  const roleText = buildRoleText(node);
  const contextText = buildContextText(node, domContext);
  const propsText = buildPropertiesText(node);
  const inferredText = node.inferred ? ' (inferred from DOM)' : '';

  return `${roleText}${contextText}${propsText}${inferredText}`;
}

/**
 * Resolve node with graceful degradation to synthesized node.
 *
 * @param a11yNode - Accessibility node or null
 * @param domContext - DOM context for synthesis fallback
 * @param nodeId - Node ID for synthesis
 * @returns Resolved node or null
 */
function resolveNodeWithFallback(
  a11yNode: A11yNode | null,
  domContext: DomContext | null,
  nodeId: number | undefined
): A11yNode | null {
  if (a11yNode) return a11yNode;
  if (domContext && nodeId) return synthesizeA11yNode(domContext, nodeId);
  return null;
}

/**
 * Query DOM context by selector when a11y node is unavailable.
 *
 * @param selector - CSS selector
 * @returns Object with nodeId and domContext
 */
async function queryDomContextBySelector(
  selector: string
): Promise<{ nodeId: number | undefined; domContext: DomContext | null }> {
  const { callCDP } = await import('@/ipc/client.js');
  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as { root?: { nodeId?: number } } | undefined;

  if (!doc?.root?.nodeId) {
    return { nodeId: undefined, domContext: null };
  }

  const queryResponse = await callCDP('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as { nodeId?: number } | undefined;

  if (!queryResult?.nodeId) {
    return { nodeId: undefined, domContext: null };
  }

  const domContext = await getDomContext(queryResult.nodeId);
  return { nodeId: queryResult.nodeId, domContext };
}

/**
 * Handle bdg dom query command.
 *
 * @param selector - CSS selector to query
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
 * Handle get command with numeric index in raw mode.
 *
 * @param index - Element index
 * @param options - Command options
 */
async function handleIndexGetRaw(index: number, options: DomGetCommandOptions): Promise<void> {
  const resolver = DomElementResolver.getInstance();
  await runCommand(
    async () => {
      const targetNode = await resolver.getNodeIdForIndex(index);
      const getOptions = filterDefined({ nodeId: targetNode.nodeId }) as DomGetHelperOptions;
      const result = await getDOMElements(getOptions);
      return { success: true, data: result };
    },
    options,
    formatDomGet
  );
}

/**
 * Handle get command with numeric index in semantic mode.
 *
 * @param index - Element index
 * @param options - Command options
 */
async function handleIndexGetSemantic(index: number, options: DomGetCommandOptions): Promise<void> {
  const resolver = DomElementResolver.getInstance();
  await runCommand(
    async () => {
      const targetNode = await resolver.getNodeIdForIndex(index);
      const [a11yNode, domContext] = await Promise.all([
        resolveA11yNode('', targetNode.nodeId),
        getDomContext(targetNode.nodeId),
      ]);

      const node = resolveNodeWithFallback(a11yNode, domContext, targetNode.nodeId);

      if (!node) {
        const err = elementAtIndexNotFoundError(index, 'cached query');
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }

      return { success: true, data: { node, domContext } };
    },
    options,
    formatSemanticNodeWithContext
  );
}

/**
 * Handle get command with numeric index.
 *
 * @param index - Element index
 * @param options - Command options
 */
async function handleIndexGet(index: number, options: DomGetCommandOptions): Promise<void> {
  if (options.raw) {
    await handleIndexGetRaw(index, options);
  } else {
    await handleIndexGetSemantic(index, options);
  }
}

/**
 * Handle get command with CSS selector in raw mode.
 *
 * @param selector - CSS selector
 * @param options - Command options
 */
async function handleSelectorGetRaw(
  selector: string,
  options: DomGetCommandOptions
): Promise<void> {
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
}

/**
 * Handle get command with CSS selector in semantic mode.
 *
 * @param selector - CSS selector
 * @param options - Command options
 */
async function handleSelectorGetSemantic(
  selector: string,
  options: DomGetCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const a11yNode = await resolveA11yNode(selector);

      let domContext: DomContext | null = null;
      let nodeId: number | undefined;

      if (a11yNode?.backendDOMNodeId) {
        nodeId = a11yNode.backendDOMNodeId;
        domContext = await getDomContext(nodeId);
      } else if (!a11yNode) {
        const queryResult = await queryDomContextBySelector(selector);
        nodeId = queryResult.nodeId;
        domContext = queryResult.domContext;
      }

      const node = resolveNodeWithFallback(a11yNode, domContext, nodeId);

      if (!node) {
        const err = noNodesFoundError(selector);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }

      return { success: true, data: { node, domContext } };
    },
    options,
    formatSemanticNodeWithContext
  );
}

/**
 * Handle get command with CSS selector.
 *
 * @param selector - CSS selector
 * @param options - Command options
 */
async function handleSelectorGet(selector: string, options: DomGetCommandOptions): Promise<void> {
  if (options.raw) {
    await handleSelectorGetRaw(selector, options);
  } else {
    await handleSelectorGetSemantic(selector, options);
  }
}

/**
 * Handle bdg dom get command.
 *
 * @param selectorOrIndex - CSS selector or numeric index
 * @param options - Command options
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
 * Handle page-level screenshot capture.
 *
 * @param outputPath - Output file path
 * @param options - Screenshot options
 */
async function handlePageScreenshot(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const screenshotOptions = buildPageScreenshotOptions(options);
      const result = await capturePageScreenshot(outputPath, screenshotOptions);
      return { success: true, data: result };
    },
    options,
    formatDomScreenshot
  );
}

/**
 * Handle element-level screenshot capture.
 *
 * @param outputPath - Output file path
 * @param options - Screenshot options with selector or index
 */
async function handleElementScreenshot(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const nodeId = await resolveElementNodeId(options);
      const screenshotOptions = buildElementScreenshotOptions(options);
      const result = await captureElementScreenshot(outputPath, nodeId, screenshotOptions);
      const elementResult = addElementInfo(result, options);
      return { success: true, data: elementResult };
    },
    options,
    formatDomScreenshot
  );
}

/**
 * Capture a single frame in sequence mode.
 *
 * @param outputPath - Full path for the frame file
 * @param options - Screenshot options
 */
async function captureSequenceFrame(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  if (hasElementTarget(options)) {
    const nodeId = await resolveElementNodeId(options);
    const elementOptions = buildElementScreenshotOptions(options);
    await captureElementScreenshot(outputPath, nodeId, elementOptions);
  } else {
    const pageOptions = buildPageScreenshotOptions(options);
    await capturePageScreenshot(outputPath, pageOptions);
  }
}

/**
 * Handle screenshot sequence capture to directory.
 *
 * @param outputDir - Output directory path
 * @param options - Screenshot options with interval and limit
 */
async function handleSequenceCapture(
  outputDir: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const absoluteDir = path.resolve(outputDir);
  ensureDirectory(absoluteDir, fs);

  const intervalRule = positiveIntRule({ min: 100, max: 60000, default: 1000 });
  const limitRule = positiveIntRule({ min: 1, max: 10000, required: false });

  const interval = intervalRule.validate(options.interval);
  const limit = options.limit ? limitRule.validate(options.limit) : 0;

  const format = options.format ?? 'png';
  let frameCount = 0;

  const captureFrame = async (): Promise<void> => {
    frameCount++;
    const filename = formatFrameFilename(frameCount, format);
    const outputPath = path.join(absoluteDir, filename);

    await captureSequenceFrame(outputPath, options);
    log.info(`Frame ${frameCount}: ${filename}`);

    if (limit > 0 && frameCount >= limit) {
      process.emit('SIGINT');
    }
  };

  await setupFollowMode(captureFrame, {
    startMessage: () => `Capturing to ${absoluteDir} every ${interval}ms...`,
    stopMessage: () => `Captured ${frameCount} frames`,
    intervalMs: interval,
  });
}

/**
 * Handle bdg dom screenshot command.
 *
 * @param outputPath - Output file path or directory
 * @param options - Screenshot options
 */
async function handleDomScreenshot(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  if (options.follow) {
    await handleSequenceCapture(outputPath, options);
    return;
  }

  if (hasElementTarget(options)) {
    await handleElementScreenshot(outputPath, options);
    return;
  }

  await handlePageScreenshot(outputPath, options);
}

/**
 * Handle bdg dom eval command.
 *
 * @param script - JavaScript expression to evaluate
 * @param options - Command options
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
 * Register DOM telemetry commands.
 *
 * @param program - Commander.js Command instance
 */
export function registerDomCommands(program: Command): void {
  const dom = program
    .command('dom')
    .description('DOM inspection and manipulation')
    .enablePositionalOptions();

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
    .description('Capture page or element screenshot')
    .argument('<path>', 'Output file path, or directory for --follow mode')
    .option('--selector <selector>', 'CSS selector for element capture')
    .option('--index <number>', 'Cached element index (0-based) from previous query', parseInt)
    .option('--format <format>', 'Image format: png or jpeg (default: png)')
    .option('--quality <number>', 'JPEG quality 0-100 (default: 90)', parseInt)
    .option('--no-full-page', 'Capture viewport only (default: full page)')
    .option('--no-resize', 'Disable auto-resize (full resolution)')
    .option('--scroll <selector>', 'Scroll element into view before capture')
    .option('-f, --follow', 'Continuous capture mode to directory')
    .option('--interval <ms>', 'Capture interval for --follow (default: 1000)')
    .option('--limit <count>', 'Max frames for --follow')
    .option('-j, --json', 'Output as JSON')
    .action(async (path: string, options: DomScreenshotCommandOptions) => {
      await handleDomScreenshot(path, options);
    });
}
