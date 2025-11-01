import type { CDPConnection } from '@/connection/cdp.js';
import {
  MAX_NETWORK_REQUESTS,
  STALE_REQUEST_TIMEOUT,
  STALE_REQUEST_CLEANUP_INTERVAL,
  MAX_RESPONSE_SIZE,
  CHROME_NETWORK_BUFFER_TOTAL,
  CHROME_NETWORK_BUFFER_PER_RESOURCE,
  CHROME_POST_DATA_LIMIT
} from '@/constants';
import type { NetworkRequest, CleanupFunction, CDPNetworkRequestParams, CDPNetworkResponseParams, CDPNetworkLoadingFinishedParams, CDPNetworkLoadingFailedParams, CDPGetResponseBodyResponse } from '@/types';
import { shouldExcludeDomain } from '@/utils/filters.js';

/**
 * Start collecting network requests via CDP Network domain.
 *
 * Tracks all HTTP requests and responses, including headers and bodies (for JSON/text responses).
 * Implements automatic cleanup of stale requests to prevent memory leaks during long sessions.
 *
 * @param cdp - CDP connection instance
 * @param requests - Array to populate with completed network requests
 * @param includeAll - If true, disable default domain filtering (default: false)
 * @returns Cleanup function to remove event handlers and clear state
 *
 * @remarks
 * - Chrome buffer limits: 50MB total, 10MB per resource, 1MB POST data (with fallback)
 * - Stale requests (incomplete after 60s) are removed from tracking but NOT added to output
 * - Request limit of 10,000 prevents memory issues in long-running sessions
 * - Response bodies are only fetched for JSON/JavaScript/text MIME types
 * - Response bodies larger than 5MB are skipped with a placeholder message
 * - By default, common tracking/analytics domains are filtered out (use includeAll to disable)
 */
export async function startNetworkCollection(
  cdp: CDPConnection,
  requests: NetworkRequest[],
  includeAll: boolean = false
): Promise<CleanupFunction> {
  const requestMap = new Map<string, { request: NetworkRequest; timestamp: number }>();
  const handlers: Array<{ event: string; id: number }> = [];

  // Enable network tracking with buffer limits (if supported)
  // These parameters are optional and experimental, but widely supported in Chrome 58+
  // See docs/chrome-cdp-compatibility.md for details
  try {
    await cdp.send('Network.enable', {
      maxTotalBufferSize: CHROME_NETWORK_BUFFER_TOTAL,
      maxResourceBufferSize: CHROME_NETWORK_BUFFER_PER_RESOURCE,
      maxPostDataSize: CHROME_POST_DATA_LIMIT
    });
  } catch {
    // Fallback to basic Network.enable if buffer parameters not supported
    console.error('Network buffer limits not supported, using default settings');
    await cdp.send('Network.enable');
  }

  // Periodic cleanup of stale requests (see JSDoc @remarks for behavior)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const staleRequests: string[] = [];

    requestMap.forEach((value, requestId) => {
      if (now - value.timestamp > STALE_REQUEST_TIMEOUT) {
        staleRequests.push(requestId);
      }
    });

    if (staleRequests.length > 0) {
      console.error(`Cleaning up ${staleRequests.length} stale network requests`);
      staleRequests.forEach(requestId => requestMap.delete(requestId));
    }
  }, STALE_REQUEST_CLEANUP_INTERVAL);

  // Listen for requests
  const requestWillBeSentId = cdp.on('Network.requestWillBeSent', (params: CDPNetworkRequestParams) => {
    if (requestMap.size >= MAX_NETWORK_REQUESTS) {
      console.error(`Warning: Network request limit reached (${MAX_NETWORK_REQUESTS}), dropping new requests`);
      return;
    }

    const request: NetworkRequest = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      timestamp: params.timestamp,
      requestHeaders: params.request.headers,
      requestBody: params.request.postData
    };
    requestMap.set(params.requestId, {
      request,
      timestamp: Date.now()
    });
  });
  handlers.push({ event: 'Network.requestWillBeSent', id: requestWillBeSentId });

  // Listen for responses
  const responseReceivedId = cdp.on('Network.responseReceived', (params: CDPNetworkResponseParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry) {
      entry.request.status = params.response.status;
      entry.request.mimeType = params.response.mimeType;
      entry.request.responseHeaders = params.response.headers;
    }
  });
  handlers.push({ event: 'Network.responseReceived', id: responseReceivedId });

  // Listen for finished requests
  const loadingFinishedId = cdp.on('Network.loadingFinished', (params: CDPNetworkLoadingFinishedParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_NETWORK_REQUESTS) {
      const request = entry.request;

      // Apply domain filtering
      if (shouldExcludeDomain(request.url, includeAll)) {
        requestMap.delete(params.requestId);
        return;
      }

      // Try to get response body for API calls
      // Skip if response is too large to prevent memory issues
      const isTextResponse = (request.mimeType?.includes('json') ?? false) ||
                            (request.mimeType?.includes('javascript') ?? false) ||
                            (request.mimeType?.includes('text') ?? false);
      const isSizeAcceptable = params.encodedDataLength <= MAX_RESPONSE_SIZE;

      if (isTextResponse && isSizeAcceptable) {
        // Fetch response body asynchronously
        void cdp.send('Network.getResponseBody', { requestId: params.requestId })
          .then((response) => {
            const typedResponse = response as CDPGetResponseBodyResponse;
            request.responseBody = typedResponse.body;
          })
          .catch(() => {
            // Response body not available (e.g., 204 No Content, redirects, etc.)
          });
      } else if (isTextResponse && !isSizeAcceptable) {
        // Mark large responses as skipped
        request.responseBody = `[SKIPPED: Response too large (${(params.encodedDataLength / 1024 / 1024).toFixed(2)}MB > ${MAX_RESPONSE_SIZE / 1024 / 1024}MB)]`;
      }
      requests.push(request);
      requestMap.delete(params.requestId);
    } else if (requests.length >= MAX_NETWORK_REQUESTS) {
      console.error(`Warning: Network request limit reached (${MAX_NETWORK_REQUESTS})`);
      requestMap.delete(params.requestId);
    }
  });
  handlers.push({ event: 'Network.loadingFinished', id: loadingFinishedId });

  // Listen for failed requests
  const loadingFailedId = cdp.on('Network.loadingFailed', (params: CDPNetworkLoadingFailedParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_NETWORK_REQUESTS) {
      // Apply domain filtering
      if (shouldExcludeDomain(entry.request.url, includeAll)) {
        requestMap.delete(params.requestId);
        return;
      }

      entry.request.status = 0; // Indicate failure
      requests.push(entry.request);
      requestMap.delete(params.requestId);
    } else if (requests.length >= MAX_NETWORK_REQUESTS) {
      requestMap.delete(params.requestId);
    }
  });
  handlers.push({ event: 'Network.loadingFailed', id: loadingFailedId });

  // Return cleanup function
  return () => {
    // Clear interval
    clearInterval(cleanupInterval);

    // Remove event handlers
    handlers.forEach(({ event, id }) => cdp.off(event, id));

    // Clear request map
    requestMap.clear();
  };
}
