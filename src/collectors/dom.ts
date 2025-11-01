import type { CDPConnection } from '@/connection/cdp.js';
import type {
  DOMData,
  CleanupFunction,
  CDPGetDocumentResponse,
  CDPGetOuterHTMLResponse,
  CDPGetFrameTreeResponse,
  CDPRuntimeEvaluateResponse,
} from '@/types';

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
  try {
    // Add a timeout wrapper to prevent hanging
    const timeout = 5000; // 5 seconds should be plenty for DOM capture

    const captureWithTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
        ),
      ]);
    };

    // Get document
    console.error('Getting document...');
    const documentResponse = await captureWithTimeout(
      cdp.send('DOM.getDocument', { depth: -1 }) as Promise<CDPGetDocumentResponse>,
      'DOM.getDocument'
    );
    const root = documentResponse.root;
    console.error(`Got document root (nodeId: ${root.nodeId})`);

    // Get outer HTML
    console.error('Getting outer HTML...');
    const htmlResponse = await captureWithTimeout(
      cdp.send('DOM.getOuterHTML', { nodeId: root.nodeId }) as Promise<CDPGetOuterHTMLResponse>,
      'DOM.getOuterHTML'
    );
    const outerHTML = htmlResponse.outerHTML;
    console.error(`Got outer HTML (${outerHTML.length} chars)`);

    // Get page info
    console.error('Getting page info...');
    const frameTreeResponse = await captureWithTimeout(
      cdp.send('Page.getFrameTree') as Promise<CDPGetFrameTreeResponse>,
      'Page.getFrameTree'
    );
    const frame = frameTreeResponse.frameTree.frame;
    console.error(`Got page info (url: ${frame.url})`);

    // Get real document title using Runtime.evaluate
    console.error('Getting document title...');
    let title = 'Untitled';
    try {
      const titleResult = await captureWithTimeout(
        cdp.send('Runtime.evaluate', {
          expression: 'document.title',
          returnByValue: true,
        }) as Promise<CDPRuntimeEvaluateResponse>,
        'Runtime.evaluate (document.title)'
      );

      if (titleResult.result.value !== undefined && typeof titleResult.result.value === 'string') {
        title = titleResult.result.value;
      }
    } catch (titleError) {
      console.error('Failed to get document title, using fallback:', titleError);
    }
    console.error(`Got document title: ${title}`);

    const url = frame.url;

    return {
      url,
      title,
      outerHTML,
    };
  } catch (error) {
    console.error('Error in collectDOM:', error);
    throw error;
  }
}
