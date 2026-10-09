import type { TelemetryStore } from './TelemetryStore.js';

import { missingMethodCause } from '@/cdp/methodTarget.js';
import type { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError, CDPProtocolError } from '@/connection/errors.js';
import { PatternDetector } from '@/daemon/patternDetector.js';
import { CdpEventListener, collectEvents } from '@/daemon/session/cdpEvents.js';
import { createInteractionRunner } from '@/daemon/session/interactions.js';
import { withTriggeredRequestCount } from '@/daemon/session/triggeredRequests.js';
import { CommandError } from '@/errors/index.js';
import {
  cdpCallError,
  cdpMethodNotImplementedError,
  formDiscoveryFailedError,
} from '@/errors/messages.js';
import type { HintDetails } from '@/errors/notices.js';
import type {
  CommandName,
  CommandSchemas,
  SessionActivity,
  SessionStatusData,
} from '@/ipc/index.js';
import type { DownloadInfo } from '@/ipc/protocol/domTypes.js';
import { searchStyleSheets } from '@/runtime/css/search.js';
import { auditPage } from '@/runtime/dom/audit.js';
import { evaluateScript, withBusyPageRecovery } from '@/runtime/dom/evalHelpers.js';
import { inspectEventListeners } from '@/runtime/dom/eventListeners.js';
import { evaluateFormDiscovery, readFormDiscovery } from '@/runtime/dom/formDiscoveryNodes.js';
import {
  fillElement,
  clickElement,
  pressKeyElement,
  scrollPage,
  withActionStability,
} from '@/runtime/dom/formFillHelpers/index.js';
import { exceptionSummary } from '@/runtime/dom/formFillHelpers/shared.js';
import { submitForm } from '@/runtime/dom/formSubmitHelpers.js';
import type { RawFormData } from '@/runtime/dom/formTypes.js';
import { evaluateInFrame, listFrames } from '@/runtime/dom/frames.js';
import { inspectElement } from '@/runtime/dom/inspect.js';
import { inspectLayout } from '@/runtime/dom/layout.js';
import { onScriptTarget } from '@/runtime/dom/targetNode.js';
import { waitForCondition } from '@/runtime/dom/wait.js';
import { sendForBdgScript } from '@/runtime/page/bdgWorld.js';
import { emulatePage, pageAppearance, type SessionEmulation } from '@/runtime/page/emulation.js';
import { readDocumentReadyState } from '@/runtime/page/loadingState.js';
import { navigatePage } from '@/runtime/page/navigation.js';
import { takeScreenshot } from '@/runtime/page/screenshot.js';
import { toDownloadInfo } from '@/telemetry/downloads.js';
import { skippedBodyReason } from '@/telemetry/networkRetention.js';
import type { NetworkRequest, WebSocketConnection } from '@/types.js';
import { consoleMessageDroppedError } from '@/ui/messages/consoleMessages.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { VERSION } from '@/utils/version.js';

/** Maximum number of items returned by peek command to prevent memory issues */
const MAX_PEEK_ITEMS = 10000;

/** Default number of items to return when not specified */
const DEFAULT_PEEK_ITEMS = 10;

/** A command's handler; `abandoned` aborts when its client disconnects */
type Handler<K extends CommandName> = (
  cdp: CDPConnection,
  params: CommandSchemas[K]['requestSchema'],
  abandoned?: AbortSignal
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
  sentTime?: number;
  navigationId?: number;
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
    sentTime: req.sentTime,
    navigationId: req.navigationId,
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
 * The session's downloads for `status` and `peek`, left out when none began.
 *
 * @param store - Telemetry store
 * @returns `downloads`, oldest first, as they stand now
 */
function sessionDownloads(store: TelemetryStore): { downloads?: DownloadInfo[] } {
  return store.downloads.length > 0 ? { downloads: store.downloads.map(toDownloadInfo) } : {};
}

/**
 * Status activity counts of what the network capture let go at its limits,
 * left out when nothing was.
 *
 * @param store - Telemetry store
 * @returns `networkRequestsDropped` and `networkBodiesEvicted` when non-zero
 */
function networkEvictionActivity(
  store: TelemetryStore
): Pick<SessionActivity, 'networkRequestsDropped' | 'networkBodiesEvicted'> {
  const { requestsDropped, bodiesEvicted } = store.networkEvictions;
  return {
    ...(requestsDropped > 0 && { networkRequestsDropped: requestsDropped }),
    ...(bodiesEvicted > 0 && { networkBodiesEvicted: bodiesEvicted }),
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
 * Present bodies bdg did not fetch or keep as their reasons
 * (`requestBodyNotCaptured`, `bodyNotCaptured`) instead of placeholder
 * strings in `requestBody` and `responseBody`.
 *
 * @param request - Captured request
 * @returns The request as `details` reports it
 */
function withBodyNotCaptured(request: NetworkRequest): NetworkRequest {
  const requestReason = skippedBodyReason(request.requestBody);
  const responseReason = skippedBodyReason(request.responseBody);
  if (requestReason === undefined && responseReason === undefined) return request;
  const result = { ...request };
  if (requestReason !== undefined) {
    delete result.requestBody;
    result.requestBodyNotCaptured = requestReason;
  }
  if (responseReason !== undefined) {
    delete result.responseBody;
    result.bodyNotCaptured = responseReason;
  }
  return result;
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
      { suggestion: `List request ids with: ${sessionCommand('bdg network list')}` },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return request;
}

/**
 * Find console message by its session index or throw.
 *
 * @param messages - Console messages kept
 * @param indexStr - Index as string
 * @param dropped - Messages dropped before the first kept one (its index)
 * @returns Found message
 * @throws CommandError if the index is invalid, dropped or not found
 */
function findConsoleMessageOrThrow<T>(messages: T[], indexStr: string, dropped: number): T {
  if (!/^\d+$/.test(indexStr)) {
    throw new CommandError(
      `Invalid console message index: ${indexStr}`,
      { suggestion: `Use a 0-based index from: ${sessionCommand('bdg console --list')}` },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const index = parseInt(indexStr, 10);
  if (index < dropped) {
    throw new CommandError(
      consoleMessageDroppedError(index, dropped),
      { suggestion: `List messages with: ${sessionCommand('bdg console --list')}` },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  if (index - dropped >= messages.length) {
    throw new CommandError(
      messages.length === 0
        ? `Console message not found at index: ${indexStr} (no messages captured yet)`
        : `Console message not found at index: ${indexStr} (available: ${dropped}-${dropped + messages.length - 1})`,
      { suggestion: `List messages with: ${sessionCommand('bdg console --list')}` },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const message = messages[index - dropped];
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
): NetworkRequest {
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

/** Chrome's "server error" code, used for failures on the page's state (a missing node, a bad id…) */
const CDP_SERVER_ERROR = -32000;

/** JSON-RPC "method not found": Chrome has no such method (for the target) */
const CDP_METHOD_NOT_FOUND = -32601;

/**
 * A `bdg cdp` failure that is the caller's: a method this Chrome doesn't
 * implement (83), wrong parameters (81), or an id of a node, target or frame
 * that does not exist (83). Other failures (internal errors, a detached
 * page) stay software errors.
 *
 * @param method - CDP method
 * @param error - What the call threw
 * @returns The error to report, or undefined to keep the original
 */
export function callerError(method: string, error: unknown): CommandError | undefined {
  if (!(error instanceof CDPProtocolError)) return undefined;
  if (error.code === CDP_METHOD_NOT_FOUND) {
    const missing = cdpMethodNotImplementedError(method, error.message, missingMethodCause(method));
    return new CommandError(
      missing.message,
      { suggestion: missing.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const err = cdpCallError(method, error.message);
  if (error.isRequestError()) {
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  if (error.code === CDP_SERVER_ERROR && err.notFound) {
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  if (
    error.code === CDP_SERVER_ERROR &&
    /must be specified|invalid|expected|missing/i.test(error.message)
  ) {
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return undefined;
}

/** CDP methods that turn Fetch interception on or off */
const FETCH_INTERCEPTION_SWITCH: Record<string, boolean> = {
  'Fetch.enable': true,
  'Fetch.disable': false,
};

/**
 * Send a `bdg cdp` (or bdg page script) call, recovering a busy page and
 * explaining Chrome's errors; notes whether Fetch interception is on, so a
 * command that times out meanwhile can name it.
 *
 * @param cdp - CDP connection
 * @param params - Method, params, and whether it is a bdg page script
 * @param store - Session state (Fetch interception flag)
 * @returns The method's result
 */
async function sendCdpCall(
  cdp: CDPConnection,
  params: CommandSchemas['cdp_call']['requestSchema'],
  store: TelemetryStore
): Promise<unknown> {
  const send = params.isolated
    ? sendForBdgScript(cdp, params.method, params.params ?? {})
    : cdp.send(params.method, params.params ?? {});
  const result = await withBusyPageRecovery(
    cdp,
    send.catch((error: unknown) => {
      throw callerError(params.method, error) ?? error;
    })
  );
  const interception = FETCH_INTERCEPTION_SWITCH[params.method];
  if (interception !== undefined) store.fetchInterceptionEnabled = interception;
  return result;
}

/** The session's page emulation, which `page emulate` reads and changes */
export interface EmulationState {
  get: () => SessionEmulation;
  set: (emulation: SessionEmulation) => void;
}

/**
 * The handlers of the session commands.
 *
 * @param store - Telemetry of the session
 * @param emulation - The session's page emulation
 * @returns Command registry
 */
export function createCommandRegistry(
  store: TelemetryStore,
  emulation: EmulationState
): CommandRegistry {
  const patternDetector = new PatternDetector();
  const interact = createInteractionRunner(store);
  /** Frame id behind each index of the last `dom frames` listing */
  let listedFrameIds: string[] | undefined;
  /** Events `bdg cdp --listen` buffers between commands (gone with the session) */
  const eventListener = new CdpEventListener();

  return {
    session_peek: async (_cdp, params) => {
      const lastN = calculateLastN(params.lastN);
      const offset = params.offset ?? 0;
      const duration = Date.now() - store.sessionStartTime;

      const allNetwork = allNetworkRequests(store);
      const totalNetwork = allNetwork.length;
      const totalConsole = store.consoleMessages.length;
      const dropped = store.consoleDropped;
      const { requestsDropped, bodiesEvicted } = store.networkEvictions;

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
              .map((msg, i) => mapConsoleMessageToPreview(msg, dropped + consoleBounds.start + i));

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
        ...(store.pageCrashedAt !== undefined && { pageCrashedAt: store.pageCrashedAt }),
        network: recentNetwork,
        console: recentConsole,
        totalNetwork,
        totalConsole,
        ...(dropped > 0 && { droppedConsole: dropped }),
        ...(requestsDropped > 0 && { droppedNetwork: requestsDropped }),
        ...(bodiesEvicted > 0 && { evictedNetworkBodies: bodiesEvicted }),
        ...sessionDownloads(store),
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
        const message = findConsoleMessageOrThrow(
          store.consoleMessages,
          params.id,
          store.consoleDropped
        );
        return Promise.resolve({ item: message });
      }

      return Promise.reject(
        new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
      );
    },

    session_status: async (cdp, _params) => {
      const duration = Date.now() - store.sessionStartTime;
      const lastNetworkRequest = store.networkRequests[store.networkRequests.length - 1];
      const lastConsoleMessage = store.consoleMessages[store.consoleMessages.length - 1];

      const result: SessionStatusData = {
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
          ...(store.pageCrashedAt === undefined
            ? await pageAppearance(cdp)
            : { crashedAt: store.pageCrashedAt }),
        },
        activeTelemetry: store.activeTelemetry,
        activity: {
          networkRequestsCaptured: store.networkRequests.length,
          consoleMessagesCaptured: store.consoleMessages.length,
          ...(lastNetworkRequest && { lastNetworkRequestAt: lastNetworkRequest.timestamp }),
          ...(lastConsoleMessage && { lastConsoleMessageAt: lastConsoleMessage.timestamp }),
          ...networkEvictionActivity(store),
          ...sessionDownloads(store),
          ...(store.downloadsWarning !== undefined && {
            downloadsWarning: store.downloadsWarning,
          }),
        },
        navigationId: store.getCurrentNavigationId?.() ?? 0,
      };

      return result;
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
        method: targetRequest.method,
        ...(targetRequest.status !== undefined && { status: targetRequest.status }),
        ...(targetRequest.statusText && { statusText: targetRequest.statusText }),
        ...(targetRequest.errorText && { errorText: targetRequest.errorText }),
        requestHeaders,
        responseHeaders,
      });
    },

    cdp_call: async (cdp, params, abandoned) => {
      const call = (): Promise<unknown> => sendCdpCall(cdp, params, store);
      const { result, collected } = params.collect
        ? await collectEvents(cdp, call, { ...params.collect, signal: abandoned })
        : { result: await call(), collected: undefined };

      const detectionResult = params.isolated
        ? { shouldShow: false, pattern: undefined }
        : patternDetector.trackCommand(params.method);
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

      return {
        result,
        ...(hint !== undefined && { hint }),
        ...(collected !== undefined && { collected }),
      };
    },

    cdp_events: async (cdp, params, abandoned) => {
      if (params.action === 'listen')
        return Promise.resolve(eventListener.listen(cdp, params.events));
      if (params.action === 'unlisten') return Promise.resolve(eventListener.unlisten());
      return eventListener.read(params, abandoned);
    },

    dom_eval: async (cdp, params) =>
      params.frame === undefined
        ? evaluateScript(cdp, params.script, { full: params.full ?? false })
        : evaluateInFrame(
            cdp,
            pageWebSocketUrl(store),
            params.script,
            params.frame,
            listedFrameIds,
            params.full ?? false
          ),

    dom_frames: async (cdp) => {
      const { frames, frameIds } = await listFrames(cdp, pageWebSocketUrl(store));
      listedFrameIds = frameIds;
      return { frames };
    },

    dom_fill: async (cdp, params) =>
      interact(
        cdp,
        async () =>
          onScriptTarget(cdp, params, (target) =>
            withActionStability(
              cdp,
              () =>
                fillElement(
                  target.cdp,
                  target.selector,
                  params.value,
                  filterDefined({ index: target.index, blur: params.blur, cwd: params.cwd })
                ),
              params.wait !== false
            )
          ),
        { dialogs: params }
      ),

    dom_click: async (cdp, params) =>
      interact(
        cdp,
        async () =>
          onScriptTarget(cdp, params, (target) =>
            withActionStability(
              cdp,
              () =>
                clickElement(
                  target.cdp,
                  target.selector,
                  filterDefined({
                    index: target.index,
                    action: params.action,
                    strict: params.strict,
                  })
                ),
              params.wait !== false
            )
          ),
        {
          detectNoEffect:
            params.wait !== false && params.action !== 'hover' && params.action !== 'right',
          reportShown: params.action === 'hover',
          detectUnsettled: params.wait !== false && params.action !== 'hover',
          dialogs: params,
        }
      ),

    dom_submit: async (cdp, params) =>
      withTriggeredRequestCount(
        await interact(
          cdp,
          async () =>
            onScriptTarget(cdp, params, (target) =>
              submitForm(target.cdp, target.selector, {
                ...filterDefined({
                  index: target.index,
                  waitNavigation: params.waitNavigation,
                  waitNetwork: params.waitNetwork,
                  timeout: params.timeout,
                }),
                pendingRequests: () => store.pendingNetworkRequests.values(),
              })
            ),
          {
            detectNoEffect: params.waitNetwork !== 0 || params.waitNavigation === true,
            dialogs: params,
          }
        )
      ),

    dom_press_key: async (cdp, params) =>
      interact(
        cdp,
        async () =>
          onScriptTarget(cdp, params, (target) =>
            withActionStability(
              cdp,
              () =>
                pressKeyElement(
                  target.cdp,
                  target.selector,
                  params.key,
                  filterDefined({
                    index: target.index,
                    times: params.times,
                    modifiers: params.modifiers,
                  })
                ),
              params.wait !== false
            )
          ),
        { reportShown: true, detectUnsettled: params.wait !== false, dialogs: params }
      ),

    dom_scroll: async (cdp, params) =>
      interact(
        cdp,
        async () =>
          onScriptTarget(cdp, params, (target) =>
            withActionStability(
              cdp,
              () =>
                scrollPage(
                  target.cdp,
                  target.selector || undefined,
                  filterDefined({
                    index: target.index,
                    down: params.down,
                    up: params.up,
                    left: params.left,
                    right: params.right,
                    top: params.top,
                    bottom: params.bottom,
                  })
                ),
              params.wait !== false
            )
          ),
        { dialogs: params }
      ),

    dom_listeners: async (cdp, params) =>
      withBusyPageRecovery(cdp, inspectEventListeners(cdp, params)),

    dom_layout: async (cdp, params) => withBusyPageRecovery(cdp, inspectLayout(cdp, params)),

    dom_audit: async (cdp, params) => withBusyPageRecovery(cdp, auditPage(cdp, params)),

    css_search: async (cdp, params) => searchStyleSheets(cdp, params),

    dom_inspect: async (cdp, params) =>
      withBusyPageRecovery(
        cdp,
        inspectElement(cdp, params).then((result) =>
          result.theme === 'dark' && emulation.get().colorScheme === 'dark'
            ? { ...result, themeFrom: 'emulation' as const }
            : result
        )
      ),

    dom_screenshot: async (cdp, params, abandoned) =>
      takeScreenshot(cdp, params, () => emulation.get().viewport, { abandoned }),

    dom_wait: async (cdp, params) => waitForCondition(cdp, params),

    page_navigate: async (cdp, params) =>
      interact(
        cdp,
        () =>
          navigatePage(cdp, params.action, {
            ...filterDefined({ url: params.url, wait: params.wait }),
            pendingRequests: () => store.pendingNetworkRequests.values(),
          }),
        { reportRequests: false, reportEffects: false }
      ),

    page_emulate: async (cdp, params) => {
      const emulated = await emulatePage(cdp, emulation.get(), params, emulation.set);
      return { emulated, ...(await pageAppearance(cdp)) };
    },

    dom_form_discover: async (cdp): Promise<RawFormData> => {
      const response = await withBusyPageRecovery(cdp, evaluateFormDiscovery(cdp));
      if (response.exceptionDetails) {
        const readyState = await readDocumentReadyState(cdp);
        const loading = readyState !== undefined && readyState !== 'complete';
        const err = formDiscoveryFailedError(
          exceptionSummary(response.exceptionDetails),
          readyState
        );
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          loading ? EXIT_CODES.RESOURCE_NOT_FOUND : EXIT_CODES.SOFTWARE_ERROR
        );
      }
      return readFormDiscovery(cdp, response.result.objectId);
    },
  } as CommandRegistry;
}
