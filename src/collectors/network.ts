import { CDPConnection } from '../connection/cdp.js';
import {
  NetworkRequest,
  CleanupFunction,
  CDPNetworkRequestParams,
  CDPNetworkResponseParams,
  CDPNetworkLoadingFinishedParams,
  CDPNetworkLoadingFailedParams
} from '../types.js';
import { shouldExcludeDomain } from '../utils/filters.js';

const MAX_REQUESTS = 10000; // Prevent memory issues
const STALE_REQUEST_TIMEOUT = 60000; // 60 seconds

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
 * - Stale requests (incomplete after 60s) are removed from tracking but NOT added to output
 * - Request limit of 10,000 prevents memory issues in long-running sessions
 * - Response bodies are only fetched for JSON/JavaScript/text MIME types
 * - By default, common tracking/analytics domains are filtered out (use includeAll to disable)
 */
export async function startNetworkCollection(
  cdp: CDPConnection,
  requests: NetworkRequest[],
  includeAll: boolean = false
): Promise<CleanupFunction> {
  const requestMap = new Map<string, { request: NetworkRequest; timestamp: number }>();
  const handlers: Array<{ event: string; id: number }> = [];

  // Enable network tracking
  await cdp.send('Network.enable');

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
  }, 30000); // Check every 30 seconds

  // Listen for requests
  const requestWillBeSentId = cdp.on('Network.requestWillBeSent', (params: CDPNetworkRequestParams) => {
    if (requestMap.size >= MAX_REQUESTS) {
      console.error(`Warning: Network request limit reached (${MAX_REQUESTS}), dropping new requests`);
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
  const loadingFinishedId = cdp.on('Network.loadingFinished', async (params: CDPNetworkLoadingFinishedParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_REQUESTS) {
      const request = entry.request;

      // Apply domain filtering
      if (shouldExcludeDomain(request.url, includeAll)) {
        requestMap.delete(params.requestId);
        return;
      }

      // Try to get response body for API calls
      if (request.mimeType?.includes('json') || request.mimeType?.includes('javascript') || request.mimeType?.includes('text')) {
        try {
          const { body } = await cdp.send('Network.getResponseBody', { requestId: params.requestId });
          request.responseBody = body;
        } catch (error) {
          // Response body not available (e.g., 204 No Content, redirects, etc.)
        }
      }
      requests.push(request);
      requestMap.delete(params.requestId);
    } else if (requests.length >= MAX_REQUESTS) {
      console.error(`Warning: Network request limit reached (${MAX_REQUESTS})`);
      requestMap.delete(params.requestId);
    }
  });
  handlers.push({ event: 'Network.loadingFinished', id: loadingFinishedId });

  // Listen for failed requests
  const loadingFailedId = cdp.on('Network.loadingFailed', (params: CDPNetworkLoadingFailedParams) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_REQUESTS) {
      // Apply domain filtering
      if (shouldExcludeDomain(entry.request.url, includeAll)) {
        requestMap.delete(params.requestId);
        return;
      }

      entry.request.status = 0; // Indicate failure
      requests.push(entry.request);
      requestMap.delete(params.requestId);
    } else if (requests.length >= MAX_REQUESTS) {
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
