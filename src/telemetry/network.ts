import type { CDPConnection } from '@/connection/cdp.js';
import {
  MAX_NETWORK_REQUESTS,
  STALE_REQUEST_TIMEOUT,
  STALE_REQUEST_CLEANUP_INTERVAL,
  MAX_RESPONSE_SIZE,
  CHROME_NETWORK_BUFFER_TOTAL,
  CHROME_NETWORK_BUFFER_PER_RESOURCE,
  CHROME_POST_DATA_LIMIT,
} from '@/constants.js';
import type {
  NetworkRequest,
  CleanupFunction,
  CDPNetworkRequestParams,
  CDPNetworkResponseParams,
  CDPNetworkLoadingFinishedParams,
  CDPNetworkLoadingFailedParams,
  CDPGetResponseBodyResponse,
} from '@/types';
import { CDPHandlerRegistry } from '@/utils/cdpHandlers.js';
import {
  shouldExcludeDomain,
  shouldExcludeUrl,
  shouldFetchBodyWithReason,
} from '@/utils/filters.js';

export interface NetworkCollectionOptions {
  includeAll?: boolean;
  fetchAllBodies?: boolean;
  fetchBodiesInclude?: string[];
  fetchBodiesExclude?: string[];
  networkInclude?: string[];
  networkExclude?: string[];
  maxBodySize?: number;
  getCurrentNavigationId?: (() => number) | undefined;
}

/**
 * Start collecting network requests via CDP Network domain.
 *
 * Tracks all HTTP requests and responses, including headers and bodies (for JSON/text responses).
 * Implements automatic cleanup of stale requests to prevent memory leaks during long sessions.
 *
 * @param cdp - CDP connection instance
 * @param requests - Array to populate with completed network requests
 * @param options - Collection options
 * @returns Cleanup function to remove event handlers and clear state
 *
 * @remarks
 * - Chrome buffer limits: 50MB total, 10MB per resource, 1MB POST data (with fallback)
 * - Stale requests (incomplete after 60s) are removed from tracking but NOT added to output
 * - Request limit of 10,000 prevents memory issues in long-running sessions
 * - Response bodies are automatically skipped for images, fonts, CSS, and source maps (see DEFAULT_SKIP_BODY_PATTERNS)
 * - Response bodies larger than 5MB are skipped with a placeholder message
 * - By default, common tracking/analytics domains are filtered out (use includeAll to disable)
 * - Pattern precedence: include patterns always trump exclude patterns
 */
export async function startNetworkCollection(
  cdp: CDPConnection,
  requests: NetworkRequest[],
  options: NetworkCollectionOptions = {}
): Promise<CleanupFunction> {
  const {
    includeAll = false,
    fetchAllBodies = false,
    fetchBodiesInclude = [],
    fetchBodiesExclude = [],
    networkInclude = [],
    networkExclude = [],
    maxBodySize = MAX_RESPONSE_SIZE,
    getCurrentNavigationId,
  } = options;
  const requestMap = new Map<string, { request: NetworkRequest; timestamp: number }>();
  const registry = new CDPHandlerRegistry();

  // Counters for PERF logging
  let bodiesFetched = 0;
  let bodiesSkipped = 0;

  // Enable network tracking with buffer limits (if supported)
  // These parameters are optional and experimental, but widely supported in Chrome 58+
  // See docs/chrome-cdp-compatibility.md for details
  try {
    await cdp.send('Network.enable', {
      maxTotalBufferSize: CHROME_NETWORK_BUFFER_TOTAL,
      maxResourceBufferSize: CHROME_NETWORK_BUFFER_PER_RESOURCE,
      maxPostDataSize: CHROME_POST_DATA_LIMIT,
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
      staleRequests.forEach((requestId) => requestMap.delete(requestId));
    }
  }, STALE_REQUEST_CLEANUP_INTERVAL);

  // Listen for requests
  registry.register<CDPNetworkRequestParams>(
    cdp,
    'Network.requestWillBeSent',
    (params: CDPNetworkRequestParams) => {
      if (requestMap.size >= MAX_NETWORK_REQUESTS) {
        console.error(
          `Warning: Network request limit reached (${MAX_NETWORK_REQUESTS}), dropping new requests`
        );
        return;
      }

      const request: NetworkRequest = {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        timestamp: Date.now(), // Use actual timestamp, not CDP monotonic time
        requestHeaders: params.request.headers,
        requestBody: params.request.postData,
        navigationId: getCurrentNavigationId?.(),
      };
      requestMap.set(params.requestId, {
        request,
        timestamp: Date.now(),
      });
    }
  );

  // Listen for responses
  registry.register<CDPNetworkResponseParams>(
    cdp,
    'Network.responseReceived',
    (params: CDPNetworkResponseParams) => {
      const entry = requestMap.get(params.requestId);
      if (entry) {
        entry.request.status = params.response.status;
        entry.request.mimeType = params.response.mimeType;
        entry.request.responseHeaders = params.response.headers;
      }
    }
  );

  // Listen for finished requests
  registry.register<CDPNetworkLoadingFinishedParams>(
    cdp,
    'Network.loadingFinished',
    (params: CDPNetworkLoadingFinishedParams) => {
      const entry = requestMap.get(params.requestId);
      if (entry && requests.length < MAX_NETWORK_REQUESTS) {
        const request = entry.request;

        // Apply domain filtering
        if (shouldExcludeDomain(request.url, includeAll)) {
          requestMap.delete(params.requestId);
          return;
        }

        // Apply URL pattern filtering
        if (
          shouldExcludeUrl(request.url, {
            includePatterns: networkInclude,
            excludePatterns: networkExclude,
          })
        ) {
          requestMap.delete(params.requestId);
          return;
        }

        // Determine if we should fetch the response body
        const decision = shouldFetchBodyWithReason(
          request.url,
          request.mimeType,
          params.encodedDataLength,
          {
            fetchAllBodies,
            includePatterns: fetchBodiesInclude,
            excludePatterns: fetchBodiesExclude,
            maxBodySize,
          }
        );

        if (decision.should) {
          bodiesFetched++;
          // Fetch response body asynchronously
          void cdp
            .send('Network.getResponseBody', { requestId: params.requestId })
            .then((response) => {
              const typedResponse = response as CDPGetResponseBodyResponse;
              request.responseBody = typedResponse.body;
            })
            .catch(() => {
              // Response body not available (e.g., 204 No Content, redirects, etc.)
            });
        } else {
          bodiesSkipped++;
          request.responseBody = `[SKIPPED: ${decision.reason}]`;
        }

        requests.push(request);
        requestMap.delete(params.requestId);
      } else if (requests.length >= MAX_NETWORK_REQUESTS) {
        console.error(`Warning: Network request limit reached (${MAX_NETWORK_REQUESTS})`);
        requestMap.delete(params.requestId);
      }
    }
  );

  // Listen for failed requests
  registry.register<CDPNetworkLoadingFailedParams>(
    cdp,
    'Network.loadingFailed',
    (params: CDPNetworkLoadingFailedParams) => {
      const entry = requestMap.get(params.requestId);
      if (entry && requests.length < MAX_NETWORK_REQUESTS) {
        // Apply domain filtering
        if (shouldExcludeDomain(entry.request.url, includeAll)) {
          requestMap.delete(params.requestId);
          return;
        }

        // Apply URL pattern filtering
        if (
          shouldExcludeUrl(entry.request.url, {
            includePatterns: networkInclude,
            excludePatterns: networkExclude,
          })
        ) {
          requestMap.delete(params.requestId);
          return;
        }

        entry.request.status = 0; // Indicate failure
        requests.push(entry.request);
        requestMap.delete(params.requestId);
      } else if (requests.length >= MAX_NETWORK_REQUESTS) {
        requestMap.delete(params.requestId);
      }
    }
  );

  // Return cleanup function
  return () => {
    // Log PERF metrics
    const totalBodyDecisions = bodiesFetched + bodiesSkipped;
    if (totalBodyDecisions > 0) {
      const percentageSkipped = ((bodiesSkipped / totalBodyDecisions) * 100).toFixed(1);
      console.error(
        `[PERF] Network bodies: ${bodiesFetched} fetched, ${bodiesSkipped} skipped (${percentageSkipped}% reduction)`
      );
    }

    // Clear interval
    clearInterval(cleanupInterval);

    // Remove event handlers
    registry.cleanup(cdp);

    // Clear request map
    requestMap.clear();
  };
}
