import type { CDPConnection } from '@/connection/cdp.js';
import { getErrorMessage } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { DOMData, CleanupFunction } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

import { withTimeout } from './utils.js';

const log = createLogger('dom');

/**
 * Prepare CDP domains for DOM collection.
 *
 * Enables Page, DOM, and Runtime domains required for capturing DOM snapshots.
 *
 * @param cdp - CDP connection instance
 * @returns Cleanup function that disables Runtime domain
 */
export async function prepareDOMCollection(cdp: CDPConnection): Promise<CleanupFunction> {
  // Enable Page domain for frame tree
  await cdp.send('Page.enable');

  // Enable DOM domain for document access
  await cdp.send('DOM.enable');

  // Enable Runtime domain for document.title evaluation
  await cdp.send('Runtime.enable');

  // Return cleanup function that disables Runtime domain
  return () => {
    // Disable Runtime domain to clean up resources
    // Note: This is best-effort during shutdown; errors are ignored
    try {
      cdp.send('Runtime.disable').catch(() => {
        // Ignore errors during cleanup (Chrome may be closing)
      });
    } catch {
      // Ignore synchronous errors
    }
  };
}

/**
 * Capture a complete DOM snapshot of the current page.
 *
 * Called during session shutdown to get the final state of the page.
 *
 * @param cdp - CDP connection instance
 * @returns DOM data including URL, title, and full HTML
 */
export async function collectDOM(cdp: CDPConnection): Promise<DOMData> {
  const domCaptureStart = Date.now();

  try {
    // Timeout for CDP operations (5 seconds should be plenty for DOM capture)
    const CDP_TIMEOUT = 5000;

    // Get document
    log.debug('Getting document...');
    const docStart = Date.now();
    const documentResponse = await withTimeout(
      cdp.send('DOM.getDocument', { depth: -1 }) as Promise<Protocol.DOM.GetDocumentResponse>,
      CDP_TIMEOUT,
      'DOM.getDocument'
    );
    const root = documentResponse.root;
    log.debug(`[PERF] DOM.getDocument: ${Date.now() - docStart}ms (nodeId: ${root.nodeId})`);

    // Get outer HTML
    log.debug('Getting outer HTML...');
    const htmlStart = Date.now();
    const htmlResponse = await withTimeout(
      cdp.send('DOM.getOuterHTML', {
        nodeId: root.nodeId,
      }) as Promise<Protocol.DOM.GetOuterHTMLResponse>,
      CDP_TIMEOUT,
      'DOM.getOuterHTML'
    );
    const outerHTML = htmlResponse.outerHTML;
    log.debug(`[PERF] DOM.getOuterHTML: ${Date.now() - htmlStart}ms (${outerHTML.length} chars)`);

    // Get page info
    log.debug('Getting page info...');
    const frameStart = Date.now();
    const frameTreeResponse = await withTimeout(
      cdp.send('Page.getFrameTree') as Promise<Protocol.Page.GetFrameTreeResponse>,
      CDP_TIMEOUT,
      'Page.getFrameTree'
    );
    const frame = frameTreeResponse.frameTree.frame;
    log.debug(`[PERF] Page.getFrameTree: ${Date.now() - frameStart}ms (url: ${frame.url})`);

    // Get real document title using Runtime.evaluate
    log.debug('Getting document title...');
    let title = 'Untitled';
    try {
      const titleStart = Date.now();
      const titleResult = await withTimeout(
        cdp.send('Runtime.evaluate', {
          expression: 'document.title',
          returnByValue: true,
        }) as Promise<Protocol.Runtime.EvaluateResponse>,
        CDP_TIMEOUT,
        'Runtime.evaluate (document.title)'
      );

      if (titleResult.result.value !== undefined && typeof titleResult.result.value === 'string') {
        title = titleResult.result.value;
      }
      log.debug(`[PERF] Runtime.evaluate (title): ${Date.now() - titleStart}ms`);
    } catch (titleError) {
      log.debug(`Failed to get document title, using fallback: ${getErrorMessage(titleError)}`);
    }
    log.debug(`Got document title: ${title}`);

    const url = frame.url;

    const totalDuration = Date.now() - domCaptureStart;
    log.debug(`[PERF] Total DOM capture: ${totalDuration}ms`);

    return {
      url,
      title,
      outerHTML,
    };
  } catch (error) {
    log.info(`DOM capture failed: ${getErrorMessage(error)}`);
    throw error;
  }
}
