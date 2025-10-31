import { CDPConnection } from '../connection/cdp.js';
import { DOMData, CleanupFunction } from '../types.js';

/**
 * Prepare CDP domains for DOM collection.
 *
 * Enables Page and DOM domains required for capturing DOM snapshots.
 *
 * @param cdp - CDP connection instance
 * @returns Cleanup function (no-op for DOM since it's snapshot-based)
 */
export async function prepareDOMCollection(cdp: CDPConnection): Promise<CleanupFunction> {
  // Enable Page domain for frame tree
  await cdp.send('Page.enable');

  // Enable DOM domain for document access
  await cdp.send('DOM.enable');

  // Return cleanup function (minimal for DOM since it's snapshot-based)
  return () => {
    // No event handlers to clean up for DOM
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
  try {
    // Add a timeout wrapper to prevent hanging
    const timeout = 5000; // 5 seconds should be plenty for DOM capture

    const captureWithTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
        )
      ]);
    };

    // Get document
    console.error('Getting document...');
    const { root } = await captureWithTimeout(
      cdp.send('DOM.getDocument', { depth: -1 }),
      'DOM.getDocument'
    );
    console.error(`Got document root (nodeId: ${root.nodeId})`);

    // Get outer HTML
    console.error('Getting outer HTML...');
    const { outerHTML } = await captureWithTimeout(
      cdp.send('DOM.getOuterHTML', { nodeId: root.nodeId }),
      'DOM.getOuterHTML'
    );
    console.error(`Got outer HTML (${outerHTML.length} chars)`);

    // Get page info
    console.error('Getting page info...');
    const frameTree = await captureWithTimeout(
      cdp.send('Page.getFrameTree'),
      'Page.getFrameTree'
    );
    const frame = frameTree.frameTree.frame;
    console.error(`Got page info (url: ${frame.url})`);

    return {
      url: frame.url,
      title: frame.name || 'Untitled',
      outerHTML
    };
  } catch (error) {
    console.error('Error in collectDOM:', error);
    throw error;
  }
}
