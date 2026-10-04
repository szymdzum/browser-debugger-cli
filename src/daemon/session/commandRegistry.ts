import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { PatternDetector } from '@/daemon/patternDetector.js';
import { createInteractionRunner } from '@/daemon/session/interactions.js';
import { CommandError } from '@/errors/index.js';
import type { HintDetails } from '@/errors/notices.js';
import type { CommandName, CommandSchemas, SessionStatusData } from '@/ipc/index.js';
import { evaluateScript, withBusyPageRecovery } from '@/runtime/dom/evalHelpers.js';
import { inspectEventListeners } from '@/runtime/dom/eventListeners.js';
import { FORM_DISCOVERY_SCRIPT, isRawFormData } from '@/runtime/dom/formDiscovery.js';
import {
  fillElement,
  clickElement,
  pressKeyElement,
  scrollPage,
  waitForActionStability,
} from '@/runtime/dom/formFillHelpers/index.js';
import { submitForm } from '@/runtime/dom/formSubmitHelpers.js';
import type { RawFormData } from '@/runtime/dom/formTypes.js';
import { evaluateInFrame, listFrames } from '@/runtime/dom/frames.js';
import { resolveScriptTarget, withUserSelector } from '@/runtime/dom/targetNode.js';
import { navigatePage } from '@/runtime/page/navigation.js';
import { skippedBodyReason } from '@/telemetry/network.js';
import type { NetworkRequest, WebSocketConnection } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { VERSION } from '@/utils/version.js';

/** Maximum number of items returned by peek command to prevent memory issues */
const MAX_PEEK_ITEMS = 10000;

/** Default number of items to return when not specified */
const DEFAULT_PEEK_ITEMS = 10;

type Handler<K extends CommandName> = (
  cdp: CDPConnection,
  params: CommandSchemas[K]['requestSchema']
) => Promise<CommandSchemas[K]['responseSchema']>;

export type CommandRegistry = {
  [K in CommandName]: Handler<K>;
};

/**
 * Calculate effective lastN value from request params.
 *
 * @param requestLastN - Value from request (0 = all, undefined = default)
 * @returns Effective limit (Infinity for all, capped otherwise)
 */
function calculateLastN(requestLastN: number | undefined): number {
  if (requestLastN === 0) return Infinity;
  return Math.min(requestLastN ?? DEFAULT_PEEK_ITEMS, MAX_PEEK_ITEMS);
}

/**
 * Calculate slice bounds for pagination.
 *
 * @param total - Total number of items
 * @param lastN - Number of items to return
 * @param offset - Offset from end
 * @returns Start and end indices for slice
 */
function calculateSliceBounds(
  total: number,
  lastN: number,
  offset: number
): { start: number; end: number } {
  return {
    start: Math.max(0, total - lastN - offset),
    end: Math.max(0, total - offset),
  };
}

/** Network request fields used by the peek preview. */
interface NetworkPreview {
  requestId: string;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  mimeType?: string;
  resourceType?: string;
  encodedDataLength?: number;
  errorText?: string;
  fromCache?: boolean;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

/**
 * Map network request to preview format.
 *
 * @param req - Full network request
 * @param withHeaders - Include request/response headers
 * @returns Filtered request with only preview fields
 */
function mapNetworkRequestToPreview(
  req: NetworkPreview,
  withHeaders = false
): Partial<NetworkPreview> {
  return filterDefined({
    requestId: req.requestId,
    timestamp: req.timestamp,
    method: req.method,
    url: req.url,
    status: req.status,
    mimeType: req.mimeType,
    resourceType: req.resourceType,
    encodedDataLength: req.encodedDataLength,
    errorText: req.errorText,
    fromCache: req.fromCache,
    duration: req.duration,
    ...(withHeaders && {
      requestHeaders: req.requestHeaders,
      responseHeaders: req.responseHeaders,
    }),
  });
}

interface ConsolePreview {
  /** Position in the session's message list (what `details console <n>` takes) */
  index?: number;
  timestamp: number;
  type: string;
  text: string;
  stackTrace?: unknown[];
  navigationId?: number;
  source?: string;
}

/**
 * Map console message to preview format.
 *
 * @param msg - Full console message
 * @param index - The message's position in the session's message list
 * @returns Filtered message with only preview fields
 */
function mapConsoleMessageToPreview(msg: ConsolePreview, index: number): ConsolePreview {
  const result: ConsolePreview = {
    index,
    timestamp: msg.timestamp,
    type: msg.type,
    text: msg.text,
  };
  if (msg.stackTrace) {
    result.stackTrace = msg.stackTrace;
  }
  if (msg.navigationId !== undefined) {
    result.navigationId = msg.navigationId;
  }
  if (msg.source) {
    result.source = msg.source;
  }
  return result;
}

/** Error of a WebSocket that closed without completing its handshake */
const WEBSOCKET_HANDSHAKE_FAILED = 'WebSocket closed before the handshake completed';

/**
 * Present a WebSocket connection as a network request, so it lists, filters
 * (`--type WebSocket`) and exports like any other request.
 *
 * A connection that closed without a handshake response is a failed request
 * (status 0 with an error), not a pending one.
 *
 * @param connection - Captured WebSocket connection
 * @returns Request for the handshake, carrying the frames
 */
function webSocketAsRequest(connection: WebSocketConnection): NetworkRequest {
  const { closedTime, statusText, requestHeaders, responseHeaders } = connection;
  const failed = connection.status === undefined && closedTime !== undefined;
  const status = failed ? 0 : connection.status;
  const errorMessage = connection.errorMessage ?? (failed ? WEBSOCKET_HANDSHAKE_FAILED : undefined);
  return {
    requestId: connection.requestId,
    url: connection.url,
    method: 'GET',
    timestamp: connection.timestamp,
    resourceType: 'WebSocket',
    ...(status !== undefined && { status }),
    ...(statusText !== undefined && { statusText }),
    ...(requestHeaders && { requestHeaders }),
    ...(responseHeaders && { responseHeaders }),
    ...(errorMessage !== undefined && { errorText: errorMessage }),
    webSocket: { frames: connection.frames, ...(closedTime !== undefined && { closedTime }) },
  };
}

/**
 * All captured network activity: finished and in-flight requests and
 * WebSocket connections, in start order.
 *
 * @param store - Telemetry store
 * @returns Requests sorted by start time
 */
function allNetworkRequests(store: TelemetryStore): NetworkRequest[] {
  return [
    ...store.networkRequests,
    ...[...store.pendingNetworkRequests.values()].map((pending) => pending.request),
    ...store.websocketConnections.map(webSocketAsRequest),
  ].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Present a body bdg chose not to fetch as `bodyNotCaptured` (the reason)
 * instead of a placeholder string in `responseBody`.
 *
 * @param request - Captured request
 * @returns The request as `details` reports it
 */
function withBodyNotCaptured(request: NetworkRequest): NetworkRequest {
  const reason = skippedBodyReason(request.responseBody);
  if (reason === undefined) return request;
  const { responseBody: _placeholder, ...rest } = request;
  return { ...rest, bodyNotCaptured: reason };
}

/**
 * Find a network request by ID: finished, in flight, or a WebSocket.
 *
 * `peek` lists all of these, so ids it shows must resolve here.
 *
 * @param store - Telemetry store
 * @param id - Request ID to find
 * @returns Found request
 * @throws Error if not found
 */
function findNetworkRequestOrThrow(store: TelemetryStore, id: string): NetworkRequest {
  const webSocket = store.websocketConnections.find((c) => c.requestId === id);
  const request =
    store.networkRequests.find((r) => r.requestId === id) ??
    store.pendingNetworkRequests.get(id)?.request ??
    (webSocket && webSocketAsRequest(webSocket));
  if (!request) {
    throw new CommandError(
      `Network request not found: ${id}`,
      { suggestion: 'List request ids with: bdg network list' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return request;
}

/**
 * Find console message by index or throw.
 *
 * @param messages - Array of console messages
 * @param indexStr - Index as string
 * @returns Found message
 * @throws Error if invalid index or not found
 */
function findConsoleMessageOrThrow<T>(messages: T[], indexStr: string): T {
  if (!/^\d+$/.test(indexStr)) {
    throw new CommandError(
      `Invalid console message index: ${indexStr}`,
      { suggestion: 'Use a 0-based index from: bdg console --list' },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const index = parseInt(indexStr, 10);
  if (index >= messages.length) {
    throw new CommandError(
      messages.length === 0
        ? `Console message not found at index: ${indexStr} (no messages captured yet)`
        : `Console message not found at index: ${indexStr} (available: 0-${messages.length - 1})`,
      { suggestion: 'List messages with: bdg console --list' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const message = messages[index];
  if (!message) {
    throw new CommandError(
      `Console message not found at index: ${indexStr}`,
      {},
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return message;
}

/**
 * Find target request for headers command.
 *
 * Without an id, prefers the main document of the current page: the Document
 * request whose URL matches the last main-frame navigation (the document
 * request is sent before the navigation commits, so it cannot be matched by
 * navigation id).
 *
 * @param store - Telemetry store
 * @param requestId - Optional specific request ID
 * @returns Target request with headers
 * @throws Error if no suitable request found
 */
function findTargetRequestForHeaders(
  store: TelemetryStore,
  requestId: string | undefined
): {
  url: string;
  requestId: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
} {
  if (requestId) {
    return findNetworkRequestOrThrow(store, requestId);
  }

  const currentUrl = store.navigationEvents.at(-1)?.url;
  const byDocument =
    store.networkRequests.findLast((r) => r.resourceType === 'Document' && r.url === currentUrl) ??
    store.networkRequests.findLast((r) => r.resourceType === 'Document');
  if (byDocument) return byDocument;

  const byHtml = store.networkRequests.findLast((r) => r.mimeType?.includes('html'));
  if (byHtml) return byHtml;

  const byHeaders = store.networkRequests.findLast(
    (r) => r.responseHeaders && Object.keys(r.responseHeaders).length > 0
  );
  if (byHeaders) return byHeaders;

  throw new CommandError(
    'No network requests with headers found',
    { suggestion: 'Wait for the page to load, then retry' },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Filter headers by name (case-insensitive).
 *
 * @param headers - Headers object
 * @param headerName - Header name to filter by
 * @returns Filtered headers
 */
function filterHeadersByName(
  headers: Record<string, string>,
  headerName: string
): Record<string, string> {
  const name = headerName.toLowerCase();
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() === name));
}

/**
 * WebSocket URL of the session's page target (frame commands open a second
 * connection to it).
 *
 * @param store - Store holding the target
 * @returns The URL
 * @throws CDPConnectionError when no target is known
 */
function pageWebSocketUrl(store: TelemetryStore): string {
  const url = store.targetInfo?.webSocketDebuggerUrl;
  if (!url) throw new CDPConnectionError('No page target');
  return url;
}

export function createCommandRegistry(store: TelemetryStore): CommandRegistry {
  const patternDetector = new PatternDetector();
  const interact = createInteractionRunner(store);

  return {
    session_peek: async (_cdp, params) => {
      const lastN = calculateLastN(params.lastN);
      const offset = params.offset ?? 0;
      const duration = Date.now() - store.sessionStartTime;

      const allNetwork = allNetworkRequests(store);
      const totalNetwork = allNetwork.length;
      const totalConsole = store.consoleMessages.length;

      const networkBounds = calculateSliceBounds(totalNetwork, lastN, offset);
      const consoleBounds = calculateSliceBounds(totalConsole, lastN, offset);

      const recentNetwork =
        params.only === 'console'
          ? []
          : allNetwork
              .slice(networkBounds.start, networkBounds.end)
              .map((req) => mapNetworkRequestToPreview(req, params.withHeaders));

      const recentConsole =
        params.only === 'network'
          ? []
          : store.consoleMessages
              .slice(consoleBounds.start, consoleBounds.end)
              .map((msg, i) => mapConsoleMessageToPreview(msg, consoleBounds.start + i));

      return Promise.resolve({
        version: VERSION,
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        currentNavigationId: store.getCurrentNavigationId?.() ?? 0,
        network: recentNetwork,
        console: recentConsole,
        totalNetwork,
        totalConsole,
        hasMoreNetwork: networkBounds.start > 0,
        hasMoreConsole: consoleBounds.start > 0,
      });
    },

    session_details: async (_cdp, params) => {
      if (params.itemType === 'network') {
        const request = findNetworkRequestOrThrow(store, params.id);
        return Promise.resolve({ item: withBodyNotCaptured(request) });
      }

      if (params.itemType === 'console') {
        const message = findConsoleMessageOrThrow(store.consoleMessages, params.id);
        return Promise.resolve({ item: message });
      }

      return Promise.reject(
        new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
      );
    },

    session_status: async (_cdp, _params) => {
      const duration = Date.now() - store.sessionStartTime;
      const lastNetworkRequest = store.networkRequests[store.networkRequests.length - 1];
      const lastConsoleMessage = store.consoleMessages[store.consoleMessages.length - 1];

      const result: SessionStatusData = {
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        activity: filterDefined({
          networkRequestsCaptured: store.networkRequests.length,
          consoleMessagesCaptured: store.consoleMessages.length,
          lastNetworkRequestAt: lastNetworkRequest?.timestamp,
          lastConsoleMessageAt: lastConsoleMessage?.timestamp,
        }) as {
          networkRequestsCaptured: number;
          consoleMessagesCaptured: number;
          lastNetworkRequestAt?: number;
          lastConsoleMessageAt?: number;
        },
        navigationId: store.getCurrentNavigationId?.() ?? 0,
      };

      return Promise.resolve(result);
    },

    session_har_data: async (_cdp, _params) => {
      return Promise.resolve({
        requests: [...store.networkRequests, ...store.websocketConnections.map(webSocketAsRequest)],
      });
    },

    session_network_headers: async (_cdp, params) => {
      const targetRequest = findTargetRequestForHeaders(store, params.id);

      let requestHeaders = targetRequest.requestHeaders ?? {};
      let responseHeaders = targetRequest.responseHeaders ?? {};

      if (params.headerName) {
        requestHeaders = filterHeadersByName(requestHeaders, params.headerName);
        responseHeaders = filterHeadersByName(responseHeaders, params.headerName);
      }

      return Promise.resolve({
        url: targetRequest.url,
        requestId: targetRequest.requestId,
        requestHeaders,
        responseHeaders,
      });
    },

    cdp_call: async (cdp, params) => {
      const result = await withBusyPageRecovery(cdp, cdp.send(params.method, params.params ?? {}));

      const detectionResult = patternDetector.trackCommand(params.method);
      let hint: HintDetails | undefined;

      if (detectionResult.shouldShow && detectionResult.pattern) {
        hint = {
          code: 'PATTERN_HINT',
          context: {
            alternative: detectionResult.pattern.alternative,
            cdpMethods: detectionResult.pattern.cdpMethods,
          },
        };
      }

      return { result, ...(hint !== undefined && { hint }) };
    },

    dom_eval: async (cdp, params) =>
      params.frame === undefined
        ? evaluateScript(cdp, params.script)
        : evaluateInFrame(cdp, pageWebSocketUrl(store), params.script, params.frame),

    dom_frames: async (cdp) => ({ frames: await listFrames(cdp, pageWebSocketUrl(store)) }),

    dom_fill: async (cdp, params) =>
      interact(cdp, async () => {
        const target = await resolveScriptTarget(cdp, params);
        const fillOptions = filterDefined({
          index: target.index,
          blur: params.blur,
          cwd: params.cwd,
        });
        const result = withUserSelector(
          await fillElement(cdp, target.selector, params.value, fillOptions),
          params.selector
        );
        if (result.success && params.wait !== false) await waitForActionStability(cdp);
        return result;
      }),

    dom_click: async (cdp, params) =>
      interact(cdp, async () => {
        const target = await resolveScriptTarget(cdp, params);
        const clickOptions = filterDefined({ index: target.index, action: params.action });
        const result = withUserSelector(
          await clickElement(cdp, target.selector, clickOptions),
          params.selector
        );
        if (result.success && params.wait !== false) await waitForActionStability(cdp);
        return result;
      }),

    dom_submit: async (cdp, params) =>
      interact(cdp, async () => {
        const target = await resolveScriptTarget(cdp, params);
        const submitOptions = filterDefined({
          index: target.index,
          waitNavigation: params.waitNavigation,
          waitNetwork: params.waitNetwork,
          timeout: params.timeout,
        });
        return withUserSelector(
          await submitForm(cdp, target.selector, submitOptions),
          params.selector
        );
      }),

    dom_press_key: async (cdp, params) =>
      interact(cdp, async () => {
        const target = await resolveScriptTarget(cdp, params);
        const pressKeyOptions = filterDefined({
          index: target.index,
          times: params.times,
          modifiers: params.modifiers,
        });
        const result = withUserSelector(
          await pressKeyElement(cdp, target.selector, params.key, pressKeyOptions),
          params.selector
        );
        if (result.success && params.wait !== false) await waitForActionStability(cdp);
        return result;
      }),

    dom_scroll: async (cdp, params) =>
      interact(cdp, async () => {
        const target = await resolveScriptTarget(cdp, params);
        const scrollOptions = filterDefined({
          index: target.index,
          down: params.down,
          up: params.up,
          left: params.left,
          right: params.right,
          top: params.top,
          bottom: params.bottom,
        });
        const result = withUserSelector(
          await scrollPage(cdp, target.selector || undefined, scrollOptions),
          params.selector
        );
        if (result.success && params.wait !== false) await waitForActionStability(cdp);
        return result;
      }),

    dom_listeners: async (cdp, params) =>
      withBusyPageRecovery(cdp, inspectEventListeners(cdp, params)),

    page_navigate: async (cdp, params) =>
      interact(cdp, () =>
        navigatePage(cdp, params.action, filterDefined({ url: params.url, wait: params.wait }))
      ),

    dom_form_discover: async (cdp): Promise<RawFormData> => {
      const response = await withBusyPageRecovery(
        cdp,
        cdp.send('Runtime.evaluate', {
          expression: FORM_DISCOVERY_SCRIPT,
          returnByValue: true,
        })
      );
      const cdpResponse = response as {
        exceptionDetails?: Protocol.Runtime.ExceptionDetails;
        result?: { value?: unknown };
      };
      if (cdpResponse.exceptionDetails) {
        throw new Error(`Form discovery failed: ${cdpResponse.exceptionDetails.text}`);
      }
      const rawData = cdpResponse.result?.value;
      if (!isRawFormData(rawData)) {
        throw new Error('Unexpected form discovery response');
      }
      return rawData;
    },
  } as CommandRegistry;
}
