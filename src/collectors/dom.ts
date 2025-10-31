import { CDPConnection } from '../connection/cdp.js';
import { DOMData, CleanupFunction } from '../types.js';

export async function prepareDOMCollection(cdp: CDPConnection): Promise<CleanupFunction> {
  // Enable Page domain for frame tree
  await cdp.send('Page.enable');

  // Return cleanup function (minimal for DOM since it's snapshot-based)
  return () => {
    // No event handlers to clean up for DOM
  };
}

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
