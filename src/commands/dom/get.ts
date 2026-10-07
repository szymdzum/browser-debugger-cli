/**
 * `bdg dom get` — retrieve element details by selector or cached index.
 *
 * Two output modes:
 * - Semantic (default): a11y role + name + DOM context
 * - Raw: full HTML, attributes, and classes
 */

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import {
  getDOMElements,
  getDomContext,
  selectMatch,
  type DomGetOptions as DomGetHelperOptions,
} from '@/commands/dom/helpers/index.js';
import {
  formatSemanticNodeWithContext,
  resolveNodeWithFallback,
  type SemanticNodeWithContext,
} from '@/commands/dom/semanticUtils.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomGetCommandOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import {
  conflictingOptionsError,
  indexWithIndexOptionError,
  nodeIdNotFoundError,
  optionRequiresError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import { resolveA11yNode } from '@/telemetry/a11y.js';
import { formatDomGet } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

/** What `bdg dom get` reads without a selector */
export const DOM_GET_DEFAULT_SELECTOR = 'body';

/**
 * The element to read: a cached index or a selector match.
 *
 * @param selectorOrIndex - CSS selector or cached index
 * @param index - Which match of the selector (0-based)
 * @returns Backend node id
 * @throws CommandError (83) no match, (81) index out of range, (87) stale cached index
 */
async function targetNodeId(selectorOrIndex: string, index: number | undefined): Promise<number> {
  const resolver = DomElementResolver.getInstance();
  if (resolver.isNumericIndex(selectorOrIndex)) {
    return (await resolver.getNodeIdForIndex(Number(selectorOrIndex))).nodeId;
  }
  return selectMatch(selectorOrIndex, index ?? 0);
}

/**
 * Semantic view of one element: its accessibility node (or one inferred from
 * the DOM) and its DOM context.
 *
 * @param backendNodeId - The element
 * @param full - All of its text instead of the first 500 characters
 * @returns Node and context
 * @throws CommandError (83) when the element is gone
 */
async function semanticElement(
  backendNodeId: number,
  full: boolean
): Promise<SemanticNodeWithContext> {
  const ref = { backendNodeId };
  const [a11yNode, domContext] = await Promise.all([
    resolveA11yNode(ref),
    getDomContext(ref, { full }),
  ]);
  const node = resolveNodeWithFallback(a11yNode, domContext, backendNodeId);
  if (!node) {
    const err = nodeIdNotFoundError(backendNodeId);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return { node, domContext };
}

/**
 * Raw view: the element(s) with attributes and outer HTML.
 *
 * @param selectorOrIndex - CSS selector or cached index
 * @param options - Command options (`--all`, `--index`)
 */
async function handleRawGet(selectorOrIndex: string, options: DomGetCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const resolver = DomElementResolver.getInstance();
      const getOptions = resolver.isNumericIndex(selectorOrIndex)
        ? { nodeId: (await resolver.getNodeIdForIndex(Number(selectorOrIndex))).nodeId }
        : (filterDefined({
            selector: selectorOrIndex,
            all: options.all,
            nth: matchIndex(options),
          }) as DomGetHelperOptions);
      return { success: true, data: await getDOMElements(getOptions) };
    },
    options,
    formatDomGet
  );
}

/**
 * Semantic view of the target.
 *
 * @param selectorOrIndex - CSS selector or cached index
 * @param options - Command options (`--index`, `--full`)
 */
async function handleSemanticGet(
  selectorOrIndex: string,
  options: DomGetCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const backendNodeId = await targetNodeId(selectorOrIndex, matchIndex(options));
      return { success: true, data: await semanticElement(backendNodeId, options.full === true) };
    },
    options,
    formatSemanticNodeWithContext
  );
}

/**
 * Which match of the selector to read: `--index`, or its alias `--nth`.
 *
 * @param options - Command options
 * @returns 0-based index, undefined for the first match
 */
function matchIndex(options: DomGetCommandOptions): number | undefined {
  return options.index ?? options.nth;
}

/**
 * Options of `dom get` that cannot be combined (one would be ignored).
 *
 * @param selectorOrIndex - Selector or index argument
 * @param options - Command options
 * @returns What conflicts and how to fix it, or null
 */
function getOptionsConflict(
  selectorOrIndex: string | undefined,
  options: DomGetCommandOptions
): ErrorWithSuggestion | null {
  if (options.nodeId !== undefined && selectorOrIndex !== undefined) {
    return conflictingOptionsError('--node-id', 'a selector or index');
  }
  if (options.full && (options.raw || options.nodeId !== undefined)) {
    return conflictingOptionsError('--full', options.raw ? '--raw' : '--node-id');
  }
  if (options.index !== undefined && options.nth !== undefined) {
    return conflictingOptionsError('--index', '--nth');
  }
  if (options.all && matchIndex(options) !== undefined) {
    return conflictingOptionsError('--all', '--index');
  }
  if (options.all && !options.raw) return optionRequiresError('--all', '--raw');
  return null;
}

/**
 * Handle `bdg dom get [selectorOrIndex] [--index <n>] [--node-id <id>]`.
 *
 * `--node-id` reads that node directly (raw output); otherwise reads a cached
 * index or a selector's match (`body` without an argument).
 *
 * @param selectorOrIndex - CSS selector or cached index (default: body)
 * @param options - Command options
 */
export async function handleDomGet(
  selectorOrIndex: string | undefined,
  options: DomGetCommandOptions
): Promise<void> {
  const conflict = getOptionsConflict(selectorOrIndex, options);
  if (conflict) {
    throw new CommandError(
      conflict.message,
      { suggestion: conflict.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const { nodeId } = options;
  if (nodeId !== undefined) {
    await runCommand(
      async () => ({ success: true, data: await getDOMElements({ nodeId }) }),
      options,
      formatDomGet
    );
    return;
  }
  const target = selectorOrIndex ?? DOM_GET_DEFAULT_SELECTOR;
  if (
    DomElementResolver.getInstance().isNumericIndex(target) &&
    matchIndex(options) !== undefined
  ) {
    const err = indexWithIndexOptionError(target, 'get');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  if (options.raw) await handleRawGet(target, options);
  else await handleSemanticGet(target, options);
}
