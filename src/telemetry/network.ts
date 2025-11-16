import type { CDPConnection } from '@/connection/cdp.js';
import { getErrorMessage } from '@/connection/errors.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import {
  MAX_NETWORK_REQUESTS,
  STALE_REQUEST_TIMEOUT,
  STALE_REQUEST_CLEANUP_INTERVAL,
  MAX_RESPONSE_SIZE,
  CHROME_NETWORK_BUFFER_TOTAL,
  CHROME_NETWORK_BUFFER_PER_RESOURCE,
  CHROME_POST_DATA_LIMIT,
} from '@/constants.js';
import type { NetworkRequest, CleanupFunction } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

import { shouldExcludeDomain, shouldExcludeUrl, shouldFetchBodyWithReason } from './filters.js';

const log = createLogger('network');

/**
 * Check if a request should be filtered out based on domain and URL patterns.
 */
function shouldFilterRequest(
  url: string,
  includeAll: boolean,
  networkInclude: string[],
  networkExclude: string[]
): boolean {
  if (shouldExcludeDomain(url, includeAll)) {
    return true;
  }
  if (shouldExcludeUrl(url, { includePatterns: networkInclude, excludePatterns: networkExclude })) {
    return true;
  }
  return false;
}

/**
 * Fetch response body for a request.
 */
function fetchResponseBody(cdp: CDPConnection, requestId: string, request: NetworkRequest): void {
  void cdp
    .send('Network.getResponseBody', { requestId })
    .then((response) => {
      const typedResponse = response as Protocol.Network.GetResponseBodyResponse;
      request.responseBody = typedResponse.body;
    })
    .catch((error) => {
      log.debug(
        `Failed to fetch response body for request ${requestId}: ${getErrorMessage(error)}`
      );
    });
}

/**
 * Create a network request from CDP event parameters.
 */
function createNetworkRequest(
  params: Protocol.Network.RequestWillBeSentEvent,
  getCurrentNavigationId?: () => number
): NetworkRequest {
  const navigationId = getCurrentNavigationId?.();
  return {
    requestId: params.requestId,
    url: params.request.url,
    method: params.request.method,
    timestamp: Date.now(),
    requestHeaders: params.request.headers,
    ...(params.request.postData !== undefined && { requestBody: params.request.postData }),
    ...(navigationId !== undefined && { navigationId }),
  };
}

/**
 * Clean up stale requests from the request map.
 */
function cleanupStaleRequests(
  requestMap: Map<string, { request: NetworkRequest; timestamp: number }>
): void {
  const now = Date.now();
  const staleRequests: string[] = [];

  requestMap.forEach((value, requestId) => {
    if (now - value.timestamp > STALE_REQUEST_TIMEOUT) {
      staleRequests.push(requestId);
    }
  });

  if (staleRequests.length > 0) {
    log.debug(`Cleaning up ${staleRequests.length} stale network requests`);
    staleRequests.forEach((requestId) => requestMap.delete(requestId));
  }
}

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
  const typed = new TypedCDPConnection(cdp);

  let bodiesFetched = 0;
  let bodiesSkipped = 0;

  try {
    await cdp.send('Network.enable', {
      maxTotalBufferSize: CHROME_NETWORK_BUFFER_TOTAL,
      maxResourceBufferSize: CHROME_NETWORK_BUFFER_PER_RESOURCE,
      maxPostDataSize: CHROME_POST_DATA_LIMIT,
    });
  } catch {
    log.debug('Network buffer limits not supported, using default settings');
    await cdp.send('Network.enable');
  }

  const cleanupInterval = setInterval(
    () => cleanupStaleRequests(requestMap),
    STALE_REQUEST_CLEANUP_INTERVAL
  );

  registry.registerTyped(typed, 'Network.requestWillBeSent', (params) => {
    if (requestMap.size >= MAX_NETWORK_REQUESTS) {
      log.debug(
        `Warning: Network request limit reached (${MAX_NETWORK_REQUESTS}), dropping new requests`
      );
      return;
    }

    const request = createNetworkRequest(params, getCurrentNavigationId);
    requestMap.set(params.requestId, {
      request,
      timestamp: Date.now(),
    });
  });

  registry.registerTyped(typed, 'Network.responseReceived', (params) => {
    const entry = requestMap.get(params.requestId);
    if (entry) {
      entry.request.status = params.response.status;
      entry.request.mimeType = params.response.mimeType;
      entry.request.responseHeaders = params.response.headers;
    }
  });

  registry.registerTyped(typed, 'Network.loadingFinished', (params) => {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;

    if (requests.length >= MAX_NETWORK_REQUESTS) {
      log.debug(`Warning: Network request limit reached (${MAX_NETWORK_REQUESTS})`);
      requestMap.delete(params.requestId);
      return;
    }

    const request = entry.request;

    if (shouldFilterRequest(request.url, includeAll, networkInclude, networkExclude)) {
      requestMap.delete(params.requestId);
      return;
    }

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
      fetchResponseBody(cdp, params.requestId, request);
    } else {
      bodiesSkipped++;
      request.responseBody = `[SKIPPED: ${decision.reason}]`;
    }

    requests.push(request);
    requestMap.delete(params.requestId);
  });

  registry.registerTyped(typed, 'Network.loadingFailed', (params) => {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;

    if (requests.length >= MAX_NETWORK_REQUESTS) {
      requestMap.delete(params.requestId);
      return;
    }

    if (shouldFilterRequest(entry.request.url, includeAll, networkInclude, networkExclude)) {
      requestMap.delete(params.requestId);
      return;
    }

    entry.request.status = 0;
    requests.push(entry.request);
    requestMap.delete(params.requestId);
  });

  return () => {
    const totalBodyDecisions = bodiesFetched + bodiesSkipped;
    if (totalBodyDecisions > 0) {
      const percentageSkipped = ((bodiesSkipped / totalBodyDecisions) * 100).toFixed(1);
      log.debug(
        `[PERF] Network bodies: ${bodiesFetched} fetched, ${bodiesSkipped} skipped (${percentageSkipped}% reduction)`
      );
    }

    clearInterval(cleanupInterval);
    registry.cleanup(cdp);
    requestMap.clear();
  };
}
