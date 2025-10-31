import { CDPConnection } from '../connection/cdp.js';

export interface PageLoadOptions {
  /**
   * Maximum time to wait for page load (ms)
   * @default 30000
   */
  timeout?: number;
  
  /**
   * Time to wait with no network activity before considering page idle (ms)
   * @default 2000
   */
  networkIdleTime?: number;
}

/**
 * Waits for the page to fully load including:
 * - DOM content loaded
 * - Load event fired
 * - Network idle (no new requests for specified time)
 */
export async function waitForPageLoad(
  cdp: CDPConnection,
  options: PageLoadOptions = {}
): Promise<void> {
  const {
    timeout = 30000,
    networkIdleTime = 2000
  } = options;

  const startTime = Date.now();
  
  return new Promise<void>(async (resolve, reject) => {
    let timeoutId: number;
    let networkIdleTimeoutId: number;
    let activeRequests = 0;
    
    // Overall timeout
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Page load timeout after ${timeout}ms`));
    }, timeout) as unknown as number;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (networkIdleTimeoutId) clearTimeout(networkIdleTimeoutId);
    };
    
    const checkNetworkIdle = () => {
      if (networkIdleTimeoutId) clearTimeout(networkIdleTimeoutId);
      
      if (activeRequests === 0) {
        networkIdleTimeoutId = setTimeout(() => {
          const elapsed = Date.now() - startTime;
          console.error(`Page loaded and network idle after ${elapsed}ms`);
          cleanup();
          resolve();
        }, networkIdleTime) as unknown as number;
      }
    };
    
    try {
      // Enable Page domain to listen for load events
      await cdp.send('Page.enable');
      
      // Listen for load event
      let loadEventFired = false;
      cdp.on('Page.loadEventFired', () => {
        loadEventFired = true;
        console.error('Page load event fired');
        checkNetworkIdle();
      });
      
      // Enable network tracking to monitor activity
      await cdp.send('Network.enable');
      
      // Track network requests
      cdp.on('Network.requestWillBeSent', () => {
        activeRequests++;
      });
      
      cdp.on('Network.loadingFinished', () => {
        activeRequests = Math.max(0, activeRequests - 1);
        if (loadEventFired) {
          checkNetworkIdle();
        }
      });
      
      cdp.on('Network.loadingFailed', () => {
        activeRequests = Math.max(0, activeRequests - 1);
        if (loadEventFired) {
          checkNetworkIdle();
        }
      });
      
      // Check if page is already loaded
      const { frameTree } = await cdp.send('Page.getFrameTree');
      if (frameTree) {
        // If we can get the frame tree, the page might already be loaded
        // Give it a moment to check
        setTimeout(() => {
          if (activeRequests === 0) {
            console.error('Page already loaded');
            cleanup();
            resolve();
          }
        }, 500);
      }
      
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
