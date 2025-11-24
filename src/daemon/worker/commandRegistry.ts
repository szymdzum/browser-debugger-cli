import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { PatternDetector } from '@/daemon/patternDetector.js';
import type { CommandName, CommandSchemas, WorkerStatusData } from '@/ipc/index.js';
import { generatePatternHint } from '@/ui/messages/hints.js';
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

/**
 * Map network request to preview format.
 *
 * @param req - Full network request
 * @returns Filtered request with only preview fields
 */
interface NetworkPreview {
  requestId: string;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  mimeType?: string;
  resourceType?: string;
}

function mapNetworkRequestToPreview(req: NetworkPreview): Partial<NetworkPreview> {
  return filterDefined({
    requestId: req.requestId,
    timestamp: req.timestamp,
    method: req.method,
    url: req.url,
    status: req.status,
    mimeType: req.mimeType,
    resourceType: req.resourceType,
  });
}

interface ConsolePreview {
  timestamp: number;
  type: string;
  text: string;
  stackTrace?: unknown[];
  navigationId?: number;
}

/**
 * Map console message to preview format.
 *
 * @param msg - Full console message
 * @returns Filtered message with only preview fields
 */
function mapConsoleMessageToPreview(msg: ConsolePreview): ConsolePreview {
  const result: ConsolePreview = {
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
  return result;
}

/**
 * Find network request by ID or throw.
 *
 * @param requests - Array of network requests
 * @param id - Request ID to find
 * @returns Found request
 * @throws Error if not found
 */
function findNetworkRequestOrThrow(
  requests: { requestId: string }[],
  id: string
): { requestId: string } {
  const request = requests.find((r) => r.requestId === id);
  if (!request) {
    throw new Error(`Network request not found: ${id}`);
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
  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0 || index >= messages.length) {
    throw new Error(
      `Console message not found at index: ${indexStr} (available: 0-${messages.length - 1})`
    );
  }
  const message = messages[index];
  if (!message) {
    throw new Error(`Console message not found at index: ${indexStr}`);
  }
  return message;
}

/**
 * Find target request for headers command.
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
    const request = store.networkRequests.find((r) => r.requestId === requestId);
    if (!request) {
      throw new Error(`Network request not found: ${requestId}`);
    }
    return request;
  }

  const currentNavId = store.getCurrentNavigationId?.() ?? 0;

  const byDocument = store.networkRequests.findLast(
    (r) => r.navigationId === currentNavId && r.resourceType === 'Document'
  );
  if (byDocument) return byDocument;

  const byHtml = store.networkRequests.findLast((r) => r.mimeType?.includes('html'));
  if (byHtml) return byHtml;

  const byHeaders = store.networkRequests.findLast(
    (r) => r.responseHeaders && Object.keys(r.responseHeaders).length > 0
  );
  if (byHeaders) return byHeaders;

  throw new Error('No network requests with headers found');
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

export function createCommandRegistry(store: TelemetryStore): CommandRegistry {
  const patternDetector = new PatternDetector();

  return {
    worker_peek: async (_cdp, params) => {
      const lastN = calculateLastN(params.lastN);
      const offset = params.offset ?? 0;
      const duration = Date.now() - store.sessionStartTime;

      const totalNetwork = store.networkRequests.length;
      const totalConsole = store.consoleMessages.length;

      const networkBounds = calculateSliceBounds(totalNetwork, lastN, offset);
      const consoleBounds = calculateSliceBounds(totalConsole, lastN, offset);

      const recentNetwork = store.networkRequests
        .slice(networkBounds.start, networkBounds.end)
        .map(mapNetworkRequestToPreview);

      const recentConsole = store.consoleMessages
        .slice(consoleBounds.start, consoleBounds.end)
        .map(mapConsoleMessageToPreview);

      return Promise.resolve({
        version: VERSION,
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        network: recentNetwork,
        console: recentConsole,
        totalNetwork,
        totalConsole,
        hasMoreNetwork: networkBounds.start > 0,
        hasMoreConsole: consoleBounds.start > 0,
      });
    },

    worker_details: async (_cdp, params) => {
      if (params.itemType === 'network') {
        const request = findNetworkRequestOrThrow(store.networkRequests, params.id);
        return Promise.resolve({ item: request });
      }

      if (params.itemType === 'console') {
        const message = findConsoleMessageOrThrow(store.consoleMessages, params.id);
        return Promise.resolve({ item: message });
      }

      return Promise.reject(
        new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
      );
    },

    worker_status: async (_cdp, _params) => {
      const duration = Date.now() - store.sessionStartTime;
      const lastNetworkRequest = store.networkRequests[store.networkRequests.length - 1];
      const lastConsoleMessage = store.consoleMessages[store.consoleMessages.length - 1];

      const result: WorkerStatusData = {
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

    worker_har_data: async (_cdp, _params) => {
      return Promise.resolve({
        requests: store.networkRequests,
      });
    },

    worker_network_headers: async (_cdp, params) => {
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
      const result = await cdp.send(params.method, params.params ?? {});

      const detectionResult = patternDetector.trackCommand(params.method);
      let hint: string | undefined;

      if (detectionResult.shouldShow && detectionResult.pattern) {
        hint = generatePatternHint(detectionResult.pattern);
      }

      return { result, hint };
    },
  } as CommandRegistry;
}
