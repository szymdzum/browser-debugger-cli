import type { Protocol } from '@/connection/typed-cdp.js';
import type { BdgOutput } from '@/types';
import { OutputFormatter, truncateUrl, truncateText } from '@/ui/formatting.js';
import {
  PREVIEW_EMPTY_STATES,
  PREVIEW_HEADERS,
  compactTipsMessage,
  verboseCommandsMessage,
} from '@/ui/messages/preview.js';

import { semantic } from './semantic.js';

/**
 * Resource type abbreviation mapping for compact display.
 * Defined at module level to avoid recreation on every call.
 */
const RESOURCE_TYPE_ABBREVIATIONS: Record<string, string> = {
  Document: 'DOC',
  Stylesheet: 'CSS',
  Image: 'IMG',
  Media: 'MED',
  Font: 'FNT',
  Script: 'SCR',
  TextTrack: 'TXT',
  XHR: 'XHR',
  Fetch: 'FET',
  Prefetch: 'PRE',
  EventSource: 'EVT',
  WebSocket: 'WS',
  Manifest: 'MAN',
  SignedExchange: 'SGX',
  Ping: 'PNG',
  CSPViolationReport: 'CSP',
  Preflight: 'FLT',
  FedCM: 'FED',
  Other: 'OTH',
};

/**
 * Rules for inferring resource types from MIME patterns.
 * Ordered by precedence (first match wins).
 */
const MIME_TYPE_RULES: Array<{
  type: Protocol.Network.ResourceType;
  match: RegExp;
}> = [
  { type: 'Document', match: /text\/html/i },
  { type: 'Stylesheet', match: /text\/css/i },
  { type: 'Script', match: /(java|ecma)script/i },
  { type: 'Image', match: /^image\//i },
  { type: 'Font', match: /font/i },
  { type: 'Media', match: /^(video|audio)\//i },
  { type: 'XHR', match: /json|xml/i },
];

/**
 * Infer resource type from MIME type when CDP doesn't provide it.
 *
 * @param mimeType - MIME type string (e.g., 'application/json', 'text/html')
 * @returns Inferred Protocol.Network.ResourceType or undefined
 */
function inferResourceTypeFromMime(
  mimeType: string | undefined
): Protocol.Network.ResourceType | undefined {
  if (!mimeType) return undefined;
  return MIME_TYPE_RULES.find((rule) => rule.match.test(mimeType))?.type;
}

/**
 * Format limit hint when data is truncated.
 *
 * @param showing - Number of items currently shown
 * @param total - Total number of items available
 * @returns Hint string with suggestion to use --last, or empty string if showing all
 */
function formatLimitHint(showing: number, total: number): string {
  if (showing >= total) return '';
  return ` (showing last ${showing}, use --last ${total} to see all)`;
}

/**
 * Get compact abbreviation for resource type.
 *
 * Falls back to MIME type inference when CDP doesn't provide resourceType.
 *
 * @param resourceType - CDP ResourceType value
 * @param mimeType - MIME type for fallback inference
 * @returns 3-4 character abbreviation (e.g., DOC, XHR, SCR)
 */
function getResourceTypeAbbr(
  resourceType: Protocol.Network.ResourceType | undefined,
  mimeType: string | undefined
): string {
  const type = resourceType ?? inferResourceTypeFromMime(mimeType);
  if (!type) return 'OTH';
  return RESOURCE_TYPE_ABBREVIATIONS[type] ?? 'UNK';
}

/**
 * Flags that shape how preview output is rendered for `bdg peek`.
 */
export interface PreviewOptions {
  /** Emit raw JSON instead of formatted text. */
  json?: boolean | undefined;
  /** Limit output to network requests (ignores console data). */
  network?: boolean | undefined;
  /** Limit output to console messages (ignores network data). */
  console?: boolean | undefined;
  /** Show DOM/A11y tree data. */
  dom?: boolean | undefined;
  /** Number of recent entries to include. */
  last: number;
  /** Use the expanded, human-friendly layout. */
  verbose?: boolean | undefined;
  /** Stream updates until interrupted (tail-like behaviour). */
  follow?: boolean | undefined;
  /** Current view timestamp (for follow mode to show refresh time). */
  viewedAt?: Date | undefined;
  /** Resource types that were filtered (for showing feedback when no matches). */
  filteredTypes?: string[] | undefined;
  /** Total network requests before filtering (for showing feedback when no matches). */
  unfilteredNetworkCount?: number | undefined;
}

/**
 * Format preview output (peek command)
 */
export function formatPreview(output: BdgOutput, options: PreviewOptions): string {
  if (options.json) {
    return formatPreviewAsJson(output, options);
  }

  return formatPreviewHumanReadable(output, options);
}

/**
 * Format preview as JSON
 *
 * Returns the output in standard bdg JSON format (consistent with stop command).
 * BREAKING CHANGE: Previously wrapped in preview object, now returns at root level.
 */
function formatPreviewAsJson(output: BdgOutput, options: PreviewOptions): string {
  const data = { ...output.data };

  if (options.network) {
    delete data.console;
    delete data.dom;
  }
  if (options.console) {
    delete data.network;
    delete data.dom;
  }
  if (options.dom) {
    delete data.network;
    delete data.console;
  }

  const lastCount = options.last;
  if (lastCount > 0) {
    if (data.network && data.network.length > lastCount) {
      data.network = data.network.slice(-lastCount);
    }
    if (data.console && data.console.length > lastCount) {
      data.console = data.console.slice(-lastCount);
    }
  }

  const jsonOutput: BdgOutput = {
    ...output,
    data,
  };

  return JSON.stringify(jsonOutput, null, 2);
}

/**
 * Format preview as human-readable output
 */
function formatPreviewHumanReadable(output: BdgOutput, options: PreviewOptions): string {
  if (options.verbose) {
    return formatPreviewVerbose(output, options);
  }
  return formatPreviewCompact(output, options);
}

/**
 * Format preview in compact format (default)
 * Token-efficient output optimized for AI agents
 */
function formatPreviewCompact(output: BdgOutput, options: PreviewOptions): string {
  const fmt = new OutputFormatter();

  fmt.text(
    `PREVIEW | Duration: ${Math.floor(output.duration / 1000)}s | Updated: ${output.timestamp}`
  );

  if (options.follow && options.viewedAt) {
    fmt.text(`Viewed at: ${options.viewedAt.toISOString()}`);
  }

  fmt.blank();

  const lastCount = options.last;
  const hasNetworkData = output.data.network && output.data.network.length > 0;
  const hasConsoleData = output.data.console && output.data.console.length > 0;

  if (!options.console && output.data.network) {
    if (!options.console || hasNetworkData) {
      const requests =
        lastCount === 0 ? output.data.network : output.data.network.slice(-lastCount);
      const showingCount = requests.length;
      const totalCount = output.data.network.length;
      const limitHint = formatLimitHint(showingCount, totalCount);
      fmt.text(`NETWORK (${showingCount}/${totalCount})${limitHint}:`);
      if (requests.length === 0) {
        if (
          options.filteredTypes &&
          options.filteredTypes.length > 0 &&
          options.unfilteredNetworkCount &&
          options.unfilteredNetworkCount > 0
        ) {
          const typesStr = options.filteredTypes.join(', ');
          fmt.text(
            `  No ${typesStr} requests found (filtered from ${options.unfilteredNetworkCount} total requests)`
          );
          fmt.text(`  Try: bdg peek --network (to see all types)`);
        } else {
          fmt.text(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
        }
      } else {
        const networkLines = requests.map((req) => {
          const typeAbbr = getResourceTypeAbbr(req.resourceType, req.mimeType);
          const status = req.status ?? 'pending';
          const url = truncateUrl(req.url, 50);
          return `[${req.requestId}] [${typeAbbr}] ${status} ${req.method} ${url}`;
        });
        fmt.list(networkLines, 2);
      }
      fmt.blank();
    }
  }

  if (!options.network && output.data.console) {
    if (options.network === undefined || hasConsoleData) {
      const messages =
        lastCount === 0 ? output.data.console : output.data.console.slice(-lastCount);
      const showingCount = messages.length;
      const totalCount = output.data.console.length;
      const limitHint = formatLimitHint(showingCount, totalCount);
      fmt.text(`CONSOLE (${showingCount}/${totalCount})${limitHint}:`);
      if (messages.length === 0) {
        fmt.text(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
      } else {
        const consoleLines = messages.map((msg) => {
          const prefix = msg.type.toUpperCase().padEnd(5);
          const text = truncateText(msg.text, 2);
          return `${prefix} ${text}`;
        });
        fmt.list(consoleLines, 2);
      }
      fmt.blank();
    }
  }

  if (options.dom && output.data.dom?.a11yTree) {
    const tree = output.data.dom.a11yTree;
    fmt.text(`DOM/A11Y TREE (${tree.count} nodes):`);
    const treeWithMap = {
      root: tree.root,
      nodes: new Map(Object.entries(tree.nodes)),
      count: tree.count,
    };
    fmt.text(semantic(treeWithMap));
    fmt.blank();
  } else if (options.dom) {
    fmt.text(`DOM: ${PREVIEW_EMPTY_STATES.NO_DATA}`);
    fmt.blank();
  }

  if (!options.follow) {
    fmt.text(compactTipsMessage());
  }

  return fmt.build();
}

/**
 * Format preview in verbose format (opt-in with --verbose)
 * Original human-friendly output with Unicode formatting
 */
function formatPreviewVerbose(output: BdgOutput, options: PreviewOptions): string {
  const fmt = new OutputFormatter();

  fmt.text(PREVIEW_HEADERS.LIVE_PREVIEW).separator('━', 50);
  fmt.keyValueList(
    [
      ['Duration', `${Math.floor(output.duration / 1000)}s`],
      ['Last updated', output.timestamp],
    ],
    18
  );

  if (options.follow && options.viewedAt) {
    fmt.keyValue('Viewed at', options.viewedAt.toISOString(), 18);
  }

  fmt.blank();

  const lastCount = options.last;
  const hasNetworkData = output.data.network && output.data.network.length > 0;
  const hasConsoleData = output.data.console && output.data.console.length > 0;

  if (!options.console && output.data.network) {
    if (!options.console || hasNetworkData) {
      const requests =
        lastCount === 0 ? output.data.network : output.data.network.slice(-lastCount);
      const title =
        lastCount === 0
          ? `Network Requests (all ${requests.length})`
          : `Network Requests (last ${requests.length} of ${output.data.network.length})`;
      fmt.text(title).separator('━', 50);
      if (requests.length === 0) {
        if (
          options.filteredTypes &&
          options.filteredTypes.length > 0 &&
          options.unfilteredNetworkCount &&
          options.unfilteredNetworkCount > 0
        ) {
          const typesStr = options.filteredTypes.join(', ');
          fmt.text(
            `No ${typesStr} requests found (filtered from ${options.unfilteredNetworkCount} total requests)`
          );
          fmt.text(`Try: bdg peek --network (to see all resource types)`);
        } else {
          fmt.text(PREVIEW_EMPTY_STATES.NO_NETWORK_REQUESTS);
        }
      } else {
        requests.forEach((req) => {
          const statusColor = req.status && req.status >= 400 ? 'ERR' : 'OK';
          const status = req.status ?? 'pending';
          fmt.text(`${statusColor} ${status} ${req.method} ${req.url}`);
          if (req.resourceType) {
            fmt.text(`  Resource: ${req.resourceType}`);
          }
          if (req.mimeType) {
            fmt.text(`  MIME: ${req.mimeType}`);
          }
          fmt.text(
            `  ID: ${req.requestId} (use 'bdg details network ${req.requestId}' for full details)`
          );
        });
      }
      fmt.blank();
    }
  }

  if (!options.network && output.data.console) {
    if (options.network === undefined || hasConsoleData) {
      const messages =
        lastCount === 0 ? output.data.console : output.data.console.slice(-lastCount);
      const title =
        lastCount === 0
          ? `Console Messages (all ${messages.length})`
          : `Console Messages (last ${messages.length} of ${output.data.console.length})`;
      fmt.text(title).separator('━', 50);
      if (messages.length === 0) {
        fmt.text(PREVIEW_EMPTY_STATES.NO_CONSOLE_MESSAGES);
      } else {
        messages.forEach((msg) => {
          const icon = msg.type === 'error' ? 'ERR' : msg.type === 'warning' ? 'WARN' : 'INFO';
          fmt.text(`${icon} [${msg.type}] ${msg.text}`);
        });
      }
      fmt.blank();
    }
  }

  if (!options.follow) {
    fmt.text(verboseCommandsMessage());
  }

  return fmt.build();
}
