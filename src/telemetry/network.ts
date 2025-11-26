import type { CDPConnection } from '@/connection/cdp.js';
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
import type { NetworkRequest, WebSocketConnection, WebSocketFrame, CleanupFunction } from '@/types';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

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
 * Fetch response body for a request with cancellation support.
 *
 * @param cdp - CDP connection instance
 * @param requestId - Request ID to fetch body for
 * @param request - Network request object to populate with body
 * @param pendingFetches - Set to track pending fetch operations for cleanup
 */
function fetchResponseBody(
  cdp: CDPConnection,
  requestId: string,
  request: NetworkRequest,
  pendingFetches: Set<string>
): void {
  pendingFetches.add(requestId);

  void cdp
    .send('Network.getResponseBody', { requestId })
    .then((response) => {
      if (!pendingFetches.has(requestId)) return;

      const typedResponse = response as Protocol.Network.GetResponseBodyResponse;
      request.responseBody = typedResponse.body;
      if (typedResponse.body) {
        request.decodedBodyLength = typedResponse.body.length;
      }
    })
    .catch((error) => {
      log.debug(
        `Failed to fetch response body for request ${requestId}: ${getErrorMessage(error)}`
      );
    })
    .finally(() => {
      pendingFetches.delete(requestId);
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
    ...(params.type !== undefined && { resourceType: params.type }),
  };
}

/**
 * Clean up stale requests from the request map.
 *
 * Leverages Map insertion order to iterate from oldest entries first,
 * exiting early once a non-stale request is found (O(k) where k = stale count).
 */
function cleanupStaleRequests(
  requestMap: Map<string, { request: NetworkRequest; timestamp: number }>
): void {
  const now = Date.now();
  const staleRequests: string[] = [];

  for (const [requestId, value] of requestMap) {
    if (now - value.timestamp > STALE_REQUEST_TIMEOUT) {
      staleRequests.push(requestId);
    } else {
      break;
    }
  }

  if (staleRequests.length > 0) {
    log.debug(`Cleaning up ${staleRequests.length} stale network requests`);
    for (const requestId of staleRequests) {
      requestMap.delete(requestId);
    }
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
  const pendingFetches = new Set<string>();
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
    if (!entry) return;

    const { status, mimeType, headers, timing, remoteIPAddress, connectionId } = params.response;

    entry.request.status = status;
    entry.request.mimeType = mimeType;
    entry.request.responseHeaders = headers;
    entry.request.resourceType = params.type;

    if (timing) {
      const {
        requestTime,
        proxyStart,
        proxyEnd,
        dnsStart,
        dnsEnd,
        connectStart,
        connectEnd,
        sslStart,
        sslEnd,
        sendStart,
        sendEnd,
        receiveHeadersEnd,
      } = timing;

      entry.request.timing = {
        requestTime,
        proxyStart,
        proxyEnd,
        dnsStart,
        dnsEnd,
        connectStart,
        connectEnd,
        sslStart,
        sslEnd,
        sendStart,
        sendEnd,
        receiveHeadersEnd,
      };
    }

    if (remoteIPAddress) {
      entry.request.serverIPAddress = remoteIPAddress;
    }

    if (connectionId !== undefined) {
      entry.request.connection = String(connectionId);
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

    if (params.encodedDataLength !== undefined) {
      request.encodedDataLength = params.encodedDataLength;
    }

    request.loadingFinishedTime = params.timestamp;

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
      fetchResponseBody(cdp, params.requestId, request, pendingFetches);
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

    if (params.errorText) {
      entry.request.errorText = params.errorText;
    }
    if (params.canceled) {
      entry.request.canceled = true;
    }
    if (params.blockedReason) {
      entry.request.blocked = true;
      entry.request.blockedReason = params.blockedReason;
    }
    if (params.type) {
      entry.request.resourceType = params.type;
    }

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

    if (pendingFetches.size > 0) {
      log.debug(`[PERF] Cancelling ${pendingFetches.size} pending body fetches`);
    }

    clearInterval(cleanupInterval);
    registry.cleanup();
    requestMap.clear();
    pendingFetches.clear();
  };
}

/** Maximum WebSocket connections to track */
const MAX_WEBSOCKET_CONNECTIONS = 100;

/** Maximum frames to capture per WebSocket connection */
const MAX_FRAMES_PER_CONNECTION = 1000;

/** Maximum payload size to capture per frame (100KB) */
const MAX_FRAME_PAYLOAD_SIZE = 100 * 1024;

/**
 * Start collecting WebSocket connections and frames via CDP Network domain.
 *
 * Tracks WebSocket lifecycle (creation, handshake, frames, close) separately from HTTP requests.
 * Network.enable must be called before this (typically by startNetworkCollection).
 *
 * @param cdp - CDP connection instance
 * @param connections - Array to populate with WebSocket connections
 * @returns Cleanup function to remove event handlers
 */
export function startWebSocketCollection(
  cdp: CDPConnection,
  connections: WebSocketConnection[]
): CleanupFunction {
  const connectionMap = new Map<string, WebSocketConnection>();
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);

  registry.registerTyped(typed, 'Network.webSocketCreated', (params) => {
    if (connectionMap.size >= MAX_WEBSOCKET_CONNECTIONS) {
      log.debug(
        `WebSocket connection limit reached (${MAX_WEBSOCKET_CONNECTIONS}), skipping new connection`
      );
      return;
    }

    const connection: WebSocketConnection = {
      requestId: params.requestId,
      url: params.url,
      timestamp: Date.now(),
      frames: [],
    };

    if (params.initiator?.url) {
      connection.initiatorUrl = params.initiator.url;
    }

    connectionMap.set(params.requestId, connection);
    log.debug(`WebSocket created: ${params.url}`);
  });

  registry.registerTyped(typed, 'Network.webSocketHandshakeResponseReceived', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.status = params.response.status;
    if (params.response.headers) {
      connection.responseHeaders = params.response.headers;
    }
  });

  registry.registerTyped(typed, 'Network.webSocketFrameSent', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    if (connection.frames.length >= MAX_FRAMES_PER_CONNECTION) {
      return;
    }

    let payloadData = params.response.payloadData;
    if (payloadData.length > MAX_FRAME_PAYLOAD_SIZE) {
      payloadData =
        payloadData.substring(0, MAX_FRAME_PAYLOAD_SIZE) +
        `... [truncated, ${payloadData.length} bytes total]`;
    }

    const frame: WebSocketFrame = {
      timestamp: Date.now(),
      direction: 'sent',
      opcode: params.response.opcode,
      payloadData,
    };

    connection.frames.push(frame);
  });

  registry.registerTyped(typed, 'Network.webSocketFrameReceived', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    if (connection.frames.length >= MAX_FRAMES_PER_CONNECTION) {
      return;
    }

    let payloadData = params.response.payloadData;
    if (payloadData.length > MAX_FRAME_PAYLOAD_SIZE) {
      payloadData =
        payloadData.substring(0, MAX_FRAME_PAYLOAD_SIZE) +
        `... [truncated, ${payloadData.length} bytes total]`;
    }

    const frame: WebSocketFrame = {
      timestamp: Date.now(),
      direction: 'received',
      opcode: params.response.opcode,
      payloadData,
    };

    connection.frames.push(frame);
  });

  registry.registerTyped(typed, 'Network.webSocketFrameError', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.errorMessage = params.errorMessage;
    log.debug(`WebSocket frame error for ${connection.url}: ${params.errorMessage}`);
  });

  registry.registerTyped(typed, 'Network.webSocketClosed', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.closedTime = Date.now();

    connections.push(connection);
    connectionMap.delete(params.requestId);

    log.debug(`WebSocket closed: ${connection.url} (${connection.frames.length} frames captured)`);
  });

  return () => {
    for (const connection of connectionMap.values()) {
      connections.push(connection);
    }

    const totalFrames = connections.reduce((sum, c) => sum + c.frames.length, 0);
    if (connections.length > 0) {
      log.debug(
        `[PERF] WebSockets: ${connections.length} connections, ${totalFrames} frames captured`
      );
    }

    registry.cleanup();
    connectionMap.clear();
  };
}
