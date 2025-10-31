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
  // Get document
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });

  // Get outer HTML
  const { outerHTML } = await cdp.send('DOM.getOuterHTML', {
    nodeId: root.nodeId
  });

  // Get page info
  const frameTree = await cdp.send('Page.getFrameTree');
  const frame = frameTree.frameTree.frame;

  return {
    url: frame.url,
    title: frame.name || 'Untitled',
    outerHTML
  };
}
