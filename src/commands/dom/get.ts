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
  type DomGetOptions as DomGetHelperOptions,
  type DomContext,
} from '@/commands/dom/helpers/index.js';
import {
  formatSemanticNodeWithContext,
  queryDomContextBySelector,
  resolveNodeWithFallback,
} from '@/commands/dom/semanticUtils.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomGetCommandOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { elementAtIndexNotFoundError, noNodesFoundError } from '@/errors/messages.js';
import { resolveA11yNode } from '@/telemetry/a11y.js';
import { formatDomGet } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

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

async function handleIndexGet(index: number, options: DomGetCommandOptions): Promise<void> {
  if (options.raw) {
    await handleIndexGetRaw(index, options);
  } else {
    await handleIndexGetSemantic(index, options);
  }
}

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

async function handleSelectorGet(selector: string, options: DomGetCommandOptions): Promise<void> {
  if (options.raw) {
    await handleSelectorGetRaw(selector, options);
  } else {
    await handleSelectorGetSemantic(selector, options);
  }
}

/**
 * Handle `bdg dom get <selectorOrIndex>`.
 *
 * Dispatches to selector or index handler based on whether the argument
 * parses as a numeric index.
 */
export async function handleDomGet(
  selectorOrIndex: string,
  options: DomGetCommandOptions
): Promise<void> {
  const isNumericIndex = /^\d+$/.test(selectorOrIndex);

  if (isNumericIndex) {
    await handleIndexGet(parseInt(selectorOrIndex, 10), options);
  } else {
    await handleSelectorGet(selectorOrIndex, options);
  }
}
