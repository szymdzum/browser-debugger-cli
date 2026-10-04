import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import {
  MAX_NETWORK_REQUESTS,
  MAX_RESPONSE_SIZE,
  CHROME_NETWORK_BUFFER_TOTAL,
  CHROME_NETWORK_BUFFER_PER_RESOURCE,
  CHROME_POST_DATA_LIMIT,
} from '@/constants.js';
import { attachChildTargets } from '@/telemetry/attachedTargets.js';
import type {
  NetworkRequest,
  WebSocketConnection,
  WebSocketFrame,
  CleanupFunction,
} from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { filterDefined } from '@/utils/objects.js';

import { shouldExcludeDomain, shouldExcludeUrl, shouldFetchBodyWithReason } from './filters.js';
import { ExtraInfoTracker } from './networkExtraInfo.js';

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
  pendingFetches: Set<string>,
  sessionId?: string
): void {
  pendingFetches.add(requestId);

  void cdp
    .send('Network.getResponseBody', { requestId }, sessionId)
    .then((response) => {
      if (!pendingFetches.has(requestId)) return;

      const typedResponse = response as Protocol.Network.GetResponseBodyResponse;
      request.responseBody = typedResponse.body;
      if (typedResponse.base64Encoded) request.responseBodyBase64 = true;
      if (typedResponse.body) {
        request.decodedBodyLength = Buffer.byteLength(
          typedResponse.body,
          typedResponse.base64Encoded ? 'base64' : 'utf-8'
        );
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

const SKIPPED_BODY_PATTERN = /^\[SKIPPED: (.*)\]$/s;

/**
 * Placeholder stored instead of a response body that was not fetched.
 *
 * @param reason - Why the body was skipped
 * @returns Placeholder text shown by `bdg details`
 */
export function skippedBodyPlaceholder(reason: string): string {
  return `[SKIPPED: ${reason}]`;
}

/**
 * Extract the reason from a skipped-body placeholder.
 *
 * @param body - Stored response body
 * @returns Reason if `body` is a placeholder, otherwise undefined
 */
export function skippedBodyReason(body: string | undefined): string | undefined {
  return body === undefined ? undefined : SKIPPED_BODY_PATTERN.exec(body)?.[1];
}

/**
 * Copy response fields (status, headers, timing, connection) onto a request.
 *
 * @param request - Request to update
 * @param response - CDP response
 * @param resourceType - Resource type reported with the response
 */
function applyResponse(
  request: NetworkRequest,
  response: Protocol.Network.Response,
  resourceType?: Protocol.Network.ResourceType
): void {
  const { status, mimeType, headers, timing, remoteIPAddress, connectionId } = response;
  request.status = status;
  if (response.statusText) request.statusText = response.statusText;
  request.mimeType = mimeType;
  request.responseHeaders = headers;
  if (response.fromDiskCache || response.fromPrefetchCache) request.fromCache = true;
  if (resourceType) request.resourceType = resourceType;
  if (timing) {
    request.timing = {
      requestTime: timing.requestTime,
      proxyStart: timing.proxyStart,
      proxyEnd: timing.proxyEnd,
      dnsStart: timing.dnsStart,
      dnsEnd: timing.dnsEnd,
      connectStart: timing.connectStart,
      connectEnd: timing.connectEnd,
      sslStart: timing.sslStart,
      sslEnd: timing.sslEnd,
      sendStart: timing.sendStart,
      sendEnd: timing.sendEnd,
      receiveHeadersEnd: timing.receiveHeadersEnd,
    };
  }
  if (remoteIPAddress) request.serverIPAddress = remoteIPAddress;
  if (connectionId !== undefined) request.connection = String(connectionId);
}

/**
 * Turn the in-flight request into a completed redirect hop.
 *
 * Chrome reuses the requestId for every hop of a redirect chain and reports
 * the previous hop's 3xx response on the next `requestWillBeSent`. Each hop
 * gets its own id (`<requestId>:redirect:<n>`) so it can be looked up and
 * exported to HAR; the final request keeps the original id.
 *
 * @param request - The request that was redirected
 * @param params - The `requestWillBeSent` event for the next hop
 * @param redirectHops - Per-requestId hop counter
 * @returns The completed hop
 */
function completeRedirectHop(
  request: NetworkRequest,
  params: Protocol.Network.RequestWillBeSentEvent,
  redirectHops: Map<string, number>
): NetworkRequest {
  const hop = (redirectHops.get(params.requestId) ?? 0) + 1;
  redirectHops.set(params.requestId, hop);
  if (params.redirectResponse) {
    applyResponse(request, params.redirectResponse, request.resourceType);
  }
  request.requestId = `${params.requestId}:redirect:${hop}`;
  request.redirectURL = params.request.url;
  request.loadingFinishedTime = params.timestamp;
  request.duration = Date.now() - request.timestamp;
  return request;
}

/**
 * A request that has started but not finished or failed yet.
 */
export interface PendingRequest {
  request: NetworkRequest;
  /** When the entry was (re)inserted */
  timestamp: number;
  /** Frame that made the request */
  frameId?: string;
  /** Document load the request belongs to (a new one cancels the old one's requests) */
  loaderId?: string;
  /** Session of the attached target (iframe, worker) that made it; undefined for the page */
  sessionId?: string;
}

/**
 * In-flight requests kept at most; beyond it the oldest is recorded as not
 * finished. Requests are never dropped for taking long (long polls, SSE).
 */
const MAX_PENDING_REQUESTS = 2000;

/** Error of a request whose document was replaced before it finished */
const NAVIGATED_AWAY_ERROR = 'net::ERR_ABORTED (the page navigated away)';

/** Error of a request evicted from tracking by {@link MAX_PENDING_REQUESTS} */
const TOO_MANY_PENDING_ERROR = 'not finished (too many requests in flight to track)';

/** Error of a request whose iframe or worker went away before it finished */
const TARGET_GONE_ERROR = 'net::ERR_ABORTED (its frame or worker went away)';

/**
 * How long a request of a page that navigated away (or of a closed frame or
 * worker) may still finish before it is recorded as cancelled: Chrome usually
 * reports the cancellation itself, and keepalive requests may still complete.
 */
const ABANDONED_REQUEST_GRACE_MS = 5000;

/** How a request failed (fields of `Network.loadingFailed`) */
interface RequestFailure {
  errorText?: string;
  canceled?: boolean;
  blockedReason?: string;
  resourceType?: Protocol.Network.ResourceType;
}

/**
 * Error text of a failed request, with the CORS reason when CORS blocked it
 * (Chrome only says `net::ERR_FAILED` otherwise).
 *
 * @param params - `Network.loadingFailed` event
 * @returns Error text
 */
function describeLoadingError(params: Protocol.Network.LoadingFailedEvent): string {
  const cors = params.corsErrorStatus;
  if (!cors) return params.errorText;
  const detail = cors.failedParameter ? `: ${cors.failedParameter}` : '';
  return `${params.errorText} (CORS ${cors.corsError}${detail})`;
}

/**
 * Record a failure on a request. A request that already got a response keeps
 * its HTTP status; one without becomes status 0.
 *
 * @param request - Request to update
 * @param failure - How it failed
 */
function applyFailure(request: NetworkRequest, failure: RequestFailure): void {
  request.status ??= 0;
  request.duration = Date.now() - request.timestamp;
  if (failure.errorText) request.errorText = failure.errorText;
  if (failure.canceled) request.canceled = true;
  if (failure.blockedReason) {
    request.blocked = true;
    request.blockedReason = failure.blockedReason;
  }
  if (failure.resourceType) request.resourceType = failure.resourceType;
}

/**
 * Give the main document request the navigation id of the page it loads.
 *
 * The request is sent before the navigation commits, so it was tagged with
 * the previous page's id; the id is assigned once the navigation tracker has
 * counted the new page (after the current event).
 *
 * @param documentsByLoader - Document requests by loader id
 * @param loaderId - Loader of the committed main-frame navigation
 * @param getCurrentNavigationId - Navigation counter
 */
function assignDocumentNavigation(
  documentsByLoader: Map<string, NetworkRequest>,
  loaderId: string,
  getCurrentNavigationId: (() => number) | undefined
): void {
  const document = documentsByLoader.get(loaderId);
  documentsByLoader.clear();
  if (!document || !getCurrentNavigationId) return;
  setImmediate(() => {
    document.navigationId = getCurrentNavigationId();
  });
}

/**
 * Collect network events of the page's out-of-process iframes and workers
 * too: their requests are reported on their own sessions.
 *
 * @param cdp - CDP connection
 * @returns Cleanup that stops attaching to new targets
 */
async function collectChildTargetNetwork(cdp: CDPConnection): Promise<CleanupFunction> {
  try {
    return await attachChildTargets(cdp, async (sessionId) => {
      await cdp.send('Network.enable', {}, sessionId);
    });
  } catch (error) {
    log.debug(`Iframe/worker network unavailable: ${getErrorMessage(error)}`);
    return () => undefined;
  }
}

export interface NetworkCollectionOptions {
  /**
   * Map to keep in-flight requests in. Pass one to expose them to readers
   * (e.g. `is:running`); otherwise the collector keeps a private map.
   */
  pendingRequests?: Map<string, PendingRequest> | undefined;
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
  const requestMap = options.pendingRequests ?? new Map<string, PendingRequest>();
  const pendingFetches = new Set<string>();
  const redirectHops = new Map<string, number>();
  const extraInfo = new ExtraInfoTracker((requestId) => requestMap.get(requestId)?.request);
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
  const detachChildren = await collectChildTargetNetwork(cdp);

  const failRequest = (requestId: string, failure: RequestFailure): void => {
    const entry = requestMap.get(requestId);
    if (!entry) return;
    if (requests.length < MAX_NETWORK_REQUESTS) {
      applyFailure(entry.request, failure);
      requests.push(entry.request);
      extraInfo.complete(requestId, entry.request);
    }
    requestMap.delete(requestId);
    redirectHops.delete(requestId);
  };
  const documentsByLoader = new Map<string, NetworkRequest>();
  const abandonTimers = new Set<NodeJS.Timeout>();
  const failLater = (requestIds: string[], errorText: string): void => {
    if (requestIds.length === 0) return;
    const timer = setTimeout(() => {
      abandonTimers.delete(timer);
      for (const requestId of requestIds) failRequest(requestId, { errorText, canceled: true });
    }, ABANDONED_REQUEST_GRACE_MS);
    abandonTimers.add(timer);
  };

  registry.registerTyped(typed, 'Page.frameNavigated', ({ frame }) => {
    const superseded = [...requestMap]
      .filter(([, e]) => e.frameId === frame.id && e.loaderId && e.loaderId !== frame.loaderId)
      .map(([requestId]) => requestId);
    failLater(superseded, NAVIGATED_AWAY_ERROR);
    if (frame.parentId === undefined) {
      assignDocumentNavigation(documentsByLoader, frame.loaderId, getCurrentNavigationId);
    }
  });

  registry.registerTyped(typed, 'Target.detachedFromTarget', ({ sessionId }) => {
    const orphaned = [...requestMap]
      .filter(([, entry]) => entry.sessionId === sessionId)
      .map(([requestId]) => requestId);
    failLater(orphaned, TARGET_GONE_ERROR);
  });

  registry.registerTyped(typed, 'Network.requestWillBeSent', (params, sessionId) => {
    const previous = requestMap.get(params.requestId);
    if (previous && params.redirectResponse) {
      requestMap.delete(params.requestId);
      const hop = completeRedirectHop(previous.request, params, redirectHops);
      extraInfo.applyResponse(params.requestId, hop);
      extraInfo.recordRedirectHop(params.requestId, hop);
      if (requests.length < MAX_NETWORK_REQUESTS) requests.push(hop);
    }

    if (shouldFilterRequest(params.request.url, includeAll, networkInclude, networkExclude)) {
      return;
    }
    if (requestMap.size >= MAX_NETWORK_REQUESTS) {
      log.debug(
        `Warning: Network request limit reached (${MAX_NETWORK_REQUESTS}), dropping new requests`
      );
      return;
    }

    const request = createNetworkRequest(params, getCurrentNavigationId);
    extraInfo.applyRequest(params.requestId, request);
    if (params.type === 'Document' && params.loaderId) {
      documentsByLoader.set(params.loaderId, request);
    }
    requestMap.set(params.requestId, {
      request,
      timestamp: Date.now(),
      loaderId: params.loaderId,
      ...(params.frameId && { frameId: params.frameId }),
      ...(sessionId && { sessionId }),
    });
    if (requestMap.size > MAX_PENDING_REQUESTS) {
      const oldest = requestMap.keys().next().value;
      if (oldest !== undefined) failRequest(oldest, { errorText: TOO_MANY_PENDING_ERROR });
    }
  });

  registry.registerTyped(typed, 'Network.responseReceived', (params) => {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;
    applyResponse(entry.request, params.response, params.type);
    extraInfo.applyResponse(params.requestId, entry.request);
  });

  registry.registerTyped(typed, 'Network.requestWillBeSentExtraInfo', (params) => {
    extraInfo.onRequestExtraInfo(params.requestId, params.headers);
  });

  registry.registerTyped(typed, 'Network.responseReceivedExtraInfo', (params) => {
    extraInfo.onResponseExtraInfo(params.requestId, params.headers, params.statusCode);
  });

  registry.registerTyped(typed, 'Network.requestServedFromCache', (params) => {
    const entry = requestMap.get(params.requestId);
    if (entry) entry.request.fromCache = true;
  });

  registry.registerTyped(typed, 'Network.loadingFinished', (params) => {
    const entry = requestMap.get(params.requestId);
    if (!entry) return;

    if (requests.length >= MAX_NETWORK_REQUESTS) {
      log.debug(`Warning: Network request limit reached (${MAX_NETWORK_REQUESTS})`);
      requestMap.delete(params.requestId);
      redirectHops.delete(params.requestId);
      return;
    }

    const request = entry.request;

    if (params.encodedDataLength !== undefined) {
      request.encodedDataLength = params.encodedDataLength;
    }

    request.loadingFinishedTime = params.timestamp;
    request.duration = Date.now() - request.timestamp;

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
      fetchResponseBody(cdp, params.requestId, request, pendingFetches, entry.sessionId);
    } else {
      bodiesSkipped++;
      request.responseBody = skippedBodyPlaceholder(decision.reason ?? 'not captured');
    }

    requests.push(request);
    extraInfo.complete(params.requestId, request);
    requestMap.delete(params.requestId);
    redirectHops.delete(params.requestId);
  });

  registry.registerTyped(typed, 'Network.loadingFailed', (params) => {
    failRequest(
      params.requestId,
      filterDefined({
        errorText: describeLoadingError(params),
        canceled: params.canceled,
        blockedReason: params.blockedReason,
        resourceType: params.type,
      })
    );
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

    registry.cleanup();
    void detachChildren();
    abandonTimers.forEach((timer) => clearTimeout(timer));
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

/** WebSocket opcode of binary frames (payload is base64) */
const BINARY_OPCODE = 2;

/**
 * Append a frame to a tracked connection, truncating oversized payloads.
 *
 * Binary payloads are cut at a multiple of 4 characters so they stay valid base64.
 *
 * @param connection - Connection the frame belongs to (untracked frames are ignored)
 * @param direction - Whether the page sent or received the frame
 * @param frame - CDP frame data
 */
function recordFrame(
  connection: WebSocketConnection | undefined,
  direction: WebSocketFrame['direction'],
  frame: Protocol.Network.WebSocketFrame
): void {
  if (!connection || connection.frames.length >= MAX_FRAMES_PER_CONNECTION) return;

  const { payloadData, opcode } = frame;
  const limit =
    opcode === BINARY_OPCODE
      ? MAX_FRAME_PAYLOAD_SIZE - (MAX_FRAME_PAYLOAD_SIZE % 4)
      : MAX_FRAME_PAYLOAD_SIZE;
  connection.frames.push({
    timestamp: Date.now(),
    direction,
    opcode,
    payloadData: payloadData.substring(0, limit),
    ...(payloadData.length > limit && { truncatedFrom: payloadData.length }),
  });
}

/**
 * Start collecting WebSocket connections and frames via CDP Network domain.
 *
 * Tracks WebSocket lifecycle (creation, handshake, frames, close) separately from HTTP requests.
 * Connections are added when created and updated in place, so open connections
 * are visible while they run. A main-frame navigation ends the page and so
 * every connection it held (Chrome sends no close event for them).
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
    if (connections.length >= MAX_WEBSOCKET_CONNECTIONS) {
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
    connections.push(connection);
    log.debug(`WebSocket created: ${params.url}`);
  });

  registry.registerTyped(typed, 'Network.webSocketWillSendHandshakeRequest', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.requestHeaders = params.request.headers;
  });

  registry.registerTyped(typed, 'Network.webSocketHandshakeResponseReceived', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.status = params.response.status;
    if (params.response.statusText) {
      connection.statusText = params.response.statusText;
    }
    if (params.response.headers) {
      connection.responseHeaders = params.response.headers;
    }
  });

  registry.registerTyped(typed, 'Network.webSocketFrameSent', (params) => {
    recordFrame(connectionMap.get(params.requestId), 'sent', params.response);
  });

  registry.registerTyped(typed, 'Network.webSocketFrameReceived', (params) => {
    recordFrame(connectionMap.get(params.requestId), 'received', params.response);
  });

  registry.registerTyped(typed, 'Network.webSocketFrameError', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.errorMessage = params.errorMessage;
    log.debug(`WebSocket frame error for ${connection.url}: ${params.errorMessage}`);
  });

  registry.registerTyped(typed, 'Page.frameNavigated', ({ frame }) => {
    if (frame.parentId !== undefined) return;
    const now = Date.now();
    for (const connection of connectionMap.values()) {
      connection.closedTime ??= now;
    }
    connectionMap.clear();
  });

  registry.registerTyped(typed, 'Network.webSocketClosed', (params) => {
    const connection = connectionMap.get(params.requestId);
    if (!connection) return;

    connection.closedTime = Date.now();
    connectionMap.delete(params.requestId);

    log.debug(`WebSocket closed: ${connection.url} (${connection.frames.length} frames captured)`);
  });

  return () => {
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
