import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { CDPConnection } from '@/connection/cdp.js';
import { readSessionMetadata } from '@/session/metadata.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { writeQueryCache, getNodeIdByIndex } from './helpers/domCache.js';
import {
  queryBySelector,
  getNodeInfo,
  createNodePreview,
  type DomNodeInfo,
} from './helpers/domQuery.js';
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
 * Color presets for highlight overlay
 */
const HIGHLIGHT_COLORS = {
  red: { r: 255, g: 0, b: 0, a: 0.5 },
  blue: { r: 0, g: 0, b: 255, a: 0.5 },
  green: { r: 0, g: 255, b: 0, a: 0.5 },
  yellow: { r: 255, g: 255, b: 0, a: 0.5 },
  orange: { r: 255, g: 165, b: 0, a: 0.5 },
  purple: { r: 128, g: 0, b: 128, a: 0.5 },
} as const;

/**
 * Connect to active session's CDP target
 *
 * @returns CDP connection instance
 * @throws Error if no active session or connection fails
 */
async function connectToActiveSession(): Promise<CDPConnection> {
  // Check if session is running
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    throw new Error('No active session running. Start a session with: bdg <url>');
  }

  // Read session metadata to get webSocketDebuggerUrl
  const metadata = readSessionMetadata();
  if (!metadata?.webSocketDebuggerUrl) {
    throw new Error('No target information in session metadata');
  }

  // Connect to CDP target
  const cdp = new CDPConnection();
  await cdp.connect(metadata.webSocketDebuggerUrl);

  // Enable required CDP domains
  await cdp.send('DOM.enable');
  await cdp.send('Overlay.enable');

  // Get document to establish DOM tree (required for nodeIds to be valid)
  await cdp.send('DOM.getDocument', { depth: -1 });

  return cdp;
}

/**
 * Handle bdg dom query <selector> command
 *
 * @param selector - CSS selector to query
 * @param options - Command options
 */
async function handleDomQuery(selector: string, options: DomQueryOptions): Promise<void> {
  try {
    // Connect to active session
    const cdp = await connectToActiveSession();

    // Query elements
    const nodeIds = await queryBySelector(cdp, selector);

    if (nodeIds.length === 0) {
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
      cdp.close();
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Get information for each node
    const nodes: Array<{
      index: number;
      nodeId: number;
      tag?: string;
      classes?: string[];
      preview?: string;
    }> = [];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (nodeId === undefined) continue;

      const nodeInfo = await getNodeInfo(cdp, nodeId);
      nodes.push({
        index: i + 1,
        nodeId: nodeInfo.nodeId,
        ...(nodeInfo.tag !== undefined && { tag: nodeInfo.tag }),
        ...(nodeInfo.classes !== undefined && { classes: nodeInfo.classes }),
        preview: createNodePreview(nodeInfo),
      });
    }

    // Write cache for index-based lookups
    writeQueryCache({
      selector,
      timestamp: new Date().toISOString(),
      nodes,
    });

    // Output results
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            selector,
            count: nodes.length,
            nodes,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `Found ${nodes.length} element${nodes.length === 1 ? '' : 's'} matching "${selector}":`
      );
      for (const node of nodes) {
        const classInfo =
          node.classes && node.classes.length > 0 ? ` class="${node.classes.join(' ')}"` : '';
        console.log(`  [${node.index}] <${node.tag}${classInfo}> ${node.preview}`);
      }
    }

    cdp.close();
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
    // Connect to active session
    const cdp = await connectToActiveSession();

    let nodeIds: number[] = [];

    // Direct nodeId provided (advanced users)
    if (options.nodeId !== undefined) {
      nodeIds = [options.nodeId];
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
        nodeIds = [nodeId];
      } else {
        // Query by selector
        nodeIds = await queryBySelector(cdp, parsed.value as string);

        if (nodeIds.length === 0) {
          throw new Error(`No elements found matching "${parsed.value}"`);
        }

        // Apply selector filters
        if (options.first) {
          const firstNode = nodeIds[0];
          if (firstNode === undefined) {
            throw new Error('No elements found');
          }
          nodeIds = [firstNode];
        } else if (options.nth !== undefined) {
          if (options.nth < 1 || options.nth > nodeIds.length) {
            throw new Error(`--nth ${options.nth} out of range (found ${nodeIds.length} elements)`);
          }
          const nthNode = nodeIds[options.nth - 1];
          if (nthNode === undefined) {
            throw new Error(`Element at index ${options.nth} not found`);
          }
          nodeIds = [nthNode];
        }
      }
    }

    // Prepare highlight color
    const colorName = (options.color ?? 'red') as keyof typeof HIGHLIGHT_COLORS;
    const color = HIGHLIGHT_COLORS[colorName] ?? HIGHLIGHT_COLORS.red;
    const opacity = options.opacity ?? color.a;

    // Highlight each node
    for (const nodeId of nodeIds) {
      await cdp.send('Overlay.highlightNode', {
        highlightConfig: {
          contentColor: { ...color, a: opacity },
        },
        nodeId,
      });
    }

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            highlighted: nodeIds.length,
            nodeIds,
          },
          null,
          2
        )
      );
    } else {
      console.log(`✓ Highlighted ${nodeIds.length} element${nodeIds.length === 1 ? '' : 's'}`);
    }

    cdp.close();
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
    // Connect to active session
    const cdp = await connectToActiveSession();

    let nodeIds: number[] = [];

    // Direct nodeId provided (advanced users)
    if (options.nodeId !== undefined) {
      nodeIds = [options.nodeId];
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
        nodeIds = [nodeId];
      } else {
        // Query by selector
        nodeIds = await queryBySelector(cdp, parsed.value as string);

        if (nodeIds.length === 0) {
          throw new Error(`No elements found matching "${parsed.value}"`);
        }

        // Apply selector filters
        if (options.nth !== undefined) {
          if (options.nth < 1 || options.nth > nodeIds.length) {
            throw new Error(`--nth ${options.nth} out of range (found ${nodeIds.length} elements)`);
          }
          const nthNode = nodeIds[options.nth - 1];
          if (nthNode === undefined) {
            throw new Error(`Element at index ${options.nth} not found`);
          }
          nodeIds = [nthNode];
        } else if (!options.all) {
          // Default: first match only
          const firstNode = nodeIds[0];
          if (firstNode === undefined) {
            throw new Error('No elements found');
          }
          nodeIds = [firstNode];
        }
      }
    }

    // Get information for each node
    const nodesInfo: DomNodeInfo[] = [];
    for (const nodeId of nodeIds) {
      const info = await getNodeInfo(cdp, nodeId);
      nodesInfo.push(info);
    }

    // Output results
    if (options.json) {
      console.log(JSON.stringify(nodesInfo.length === 1 ? nodesInfo[0] : nodesInfo, null, 2));
    } else {
      if (nodesInfo.length === 1) {
        const firstNode = nodesInfo[0];
        if (firstNode) {
          console.log(firstNode.outerHTML);
        }
      } else {
        for (let i = 0; i < nodesInfo.length; i++) {
          const node = nodesInfo[i];
          if (node) {
            console.log(`[${i + 1}] ${node.outerHTML}`);
          }
        }
      }
    }

    cdp.close();
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
