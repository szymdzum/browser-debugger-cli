import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { DOMData, CleanupFunction, A11yNode } from '@/types';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { buildTreeFromRawNodes } from './a11y.js';
import { withTimeout } from './utils.js';

const log = createLogger('dom');
const CDP_TIMEOUT = 5000;

/**
 * Prepare CDP domains for DOM collection.
 *
 * Enables Page, DOM, and Runtime domains required for capturing DOM snapshots.
 *
 * @param cdp - CDP connection instance
 * @returns Cleanup function that disables Runtime domain
 */
export async function prepareDOMCollection(cdp: CDPConnection): Promise<CleanupFunction> {
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  return () => {
    try {
      cdp.send('Runtime.disable').catch((error) => {
        log.debug(`Failed to disable Runtime: ${getErrorMessage(error)}`);
      });
    } catch (error) {
      log.debug(`Failed to disable Runtime: ${getErrorMessage(error)}`);
    }
  };
}

/**
 * Get the root node of the DOM tree.
 */
async function getDocumentRoot(cdp: CDPConnection): Promise<Protocol.DOM.Node> {
  const response = await withTimeout(
    cdp.send('DOM.getDocument', { depth: -1 }) as Promise<Protocol.DOM.GetDocumentResponse>,
    CDP_TIMEOUT,
    'DOM.getDocument'
  );
  return response.root;
}

/**
 * Get the outer HTML of a node.
 */
async function getOuterHTML(cdp: CDPConnection, nodeId: number): Promise<string> {
  const response = await withTimeout(
    cdp.send('DOM.getOuterHTML', { nodeId }) as Promise<Protocol.DOM.GetOuterHTMLResponse>,
    CDP_TIMEOUT,
    'DOM.getOuterHTML'
  );
  return response.outerHTML;
}

/**
 * Get the main frame information.
 */
async function getMainFrame(cdp: CDPConnection): Promise<Protocol.Page.Frame> {
  const response = await withTimeout(
    cdp.send('Page.getFrameTree') as Promise<Protocol.Page.GetFrameTreeResponse>,
    CDP_TIMEOUT,
    'Page.getFrameTree'
  );
  return response.frameTree.frame;
}

/**
 * Get the document title using Runtime.evaluate.
 */
async function getDocumentTitle(cdp: CDPConnection): Promise<string> {
  try {
    const result = await withTimeout(
      cdp.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      }) as Promise<Protocol.Runtime.EvaluateResponse>,
      CDP_TIMEOUT,
      'Runtime.evaluate'
    );

    if (result.result.value !== undefined && typeof result.result.value === 'string') {
      return result.result.value;
    }
  } catch (error) {
    log.debug(`Failed to get document title: ${getErrorMessage(error)}`);
  }
  return 'Untitled';
}

/**
 * Capture accessibility tree from the current page.
 *
 * @param cdp - CDP connection instance
 * @returns A11y tree with nodes serialized as plain object, or undefined on error
 */
async function collectA11yTree(
  cdp: CDPConnection
): Promise<{ root: A11yNode; nodes: Record<string, A11yNode>; count: number } | undefined> {
  try {
    await cdp.send('Accessibility.enable');
    const response = (await withTimeout(
      cdp.send('Accessibility.getFullAXTree', {}),
      CDP_TIMEOUT,
      'Accessibility.getFullAXTree'
    )) as Protocol.Accessibility.GetFullAXTreeResponse;

    if (!response.nodes) {
      return undefined;
    }

    const tree = buildTreeFromRawNodes(response.nodes);

    await cdp.send('Accessibility.disable').catch(() => {
      /* Ignore errors */
    });

    return {
      root: tree.root,
      nodes: Object.fromEntries(tree.nodes),
      count: tree.count,
    };
  } catch (error) {
    log.debug(`A11y tree capture failed: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * Capture a complete DOM snapshot of the current page.
 *
 * Called during session shutdown to get the final state of the page.
 * Parallelizes independent CDP calls for better performance.
 *
 * @param cdp - CDP connection instance
 * @returns DOM data including URL, title, full HTML, and A11y tree
 */
export async function collectDOM(cdp: CDPConnection): Promise<DOMData> {
  try {
    // Run independent CDP calls in parallel for better performance
    const [root, frame, title, a11yTree] = await Promise.all([
      getDocumentRoot(cdp),
      getMainFrame(cdp),
      getDocumentTitle(cdp),
      collectA11yTree(cdp),
    ]);

    // getOuterHTML depends on root.nodeId, so it must be sequential
    const outerHTML = await getOuterHTML(cdp, root.nodeId);

    return {
      url: frame.url,
      title,
      outerHTML,
      ...(a11yTree && { a11yTree }),
    };
  } catch (error) {
    log.info(`DOM capture failed: ${getErrorMessage(error)}`);
    throw error;
  }
}
