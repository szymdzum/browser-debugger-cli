import { CDPConnection } from '../connection/cdp.js';
import { NetworkRequest, CleanupFunction } from '../types.js';

const MAX_REQUESTS = 10000; // Prevent memory issues
const STALE_REQUEST_TIMEOUT = 60000; // 60 seconds

export async function startNetworkCollection(
  cdp: CDPConnection,
  requests: NetworkRequest[]
): Promise<CleanupFunction> {
  const requestMap = new Map<string, { request: NetworkRequest; timestamp: number }>();
  const handlerIds: number[] = [];

  // Enable network tracking
  await cdp.send('Network.enable');

  // Periodic cleanup of stale requests
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
  const requestWillBeSentId = cdp.on('Network.requestWillBeSent', (params: any) => {
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
  handlerIds.push(requestWillBeSentId);

  // Listen for responses
  const responseReceivedId = cdp.on('Network.responseReceived', (params: any) => {
    const entry = requestMap.get(params.requestId);
    if (entry) {
      entry.request.status = params.response.status;
      entry.request.mimeType = params.response.mimeType;
      entry.request.responseHeaders = params.response.headers;
    }
  });
  handlerIds.push(responseReceivedId);

  // Listen for finished requests
  const loadingFinishedId = cdp.on('Network.loadingFinished', async (params: any) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_REQUESTS) {
      const request = entry.request;
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
  handlerIds.push(loadingFinishedId);

  // Listen for failed requests
  const loadingFailedId = cdp.on('Network.loadingFailed', (params: any) => {
    const entry = requestMap.get(params.requestId);
    if (entry && requests.length < MAX_REQUESTS) {
      entry.request.status = 0; // Indicate failure
      requests.push(entry.request);
      requestMap.delete(params.requestId);
    } else if (requests.length >= MAX_REQUESTS) {
      requestMap.delete(params.requestId);
    }
  });
  handlerIds.push(loadingFailedId);

  // Return cleanup function
  return () => {
    // Clear interval
    clearInterval(cleanupInterval);

    // Remove event handlers
    handlerIds.forEach(id => cdp.off('Network.requestWillBeSent', id));
    handlerIds.forEach(id => cdp.off('Network.responseReceived', id));
    handlerIds.forEach(id => cdp.off('Network.loadingFinished', id));
    handlerIds.forEach(id => cdp.off('Network.loadingFailed', id));

    // Clear request map
    requestMap.clear();
  };
}
