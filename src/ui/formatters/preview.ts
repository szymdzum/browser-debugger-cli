import type { Protocol } from '@/connection/typed-cdp.js';
import { RESOURCE_TYPE_ABBREVIATIONS, MIME_TYPE_RULES } from '@/constants.js';
import type { BdgOutput } from '@/types.js';
import { buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { formatTimestamp } from '@/ui/formatters/console/shared.js';
import { formatRequestStatus, getRequestState } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter, truncateUrl, truncateText } from '@/ui/formatting.js';
import {
  PREVIEW_EMPTY_STATES,
  PREVIEW_HEADERS,
  compactTipsMessage,
  verboseCommandsMessage,
} from '@/ui/messages/preview.js';

/**
 * Infer resource type from MIME type when CDP doesn't provide it.
 *
 * @param mimeType - MIME type string (e.g., 'application/json', 'text/html')
 * @returns Inferred resource type string or undefined
 */
export function inferResourceTypeFromMime(mimeType: string | undefined): string | undefined {
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
  return ` (showing last ${showing}, use --last 0 to see all)`;
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
export function getResourceTypeAbbr(
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
 * Data payload of `peek --json` / `tail --json` (goes in the envelope's `data`).
 */
export interface PreviewJsonData {
  timestamp: string;
  duration: number;
  target: BdgOutput['target'];
  partial?: boolean;
  totals?: BdgOutput['totals'];
  network?: BdgOutput['data']['network'];
  console?: BdgOutput['data']['console'];
}

/**
 * Build the JSON payload for a preview, honoring the section and `--last` filters.
 *
 * @param output - Preview output from the daemon
 * @param options - Preview options (section filters, last N)
 * @returns Payload for the response envelope's `data`
 */
export function buildPreviewJsonData(output: BdgOutput, options: PreviewOptions): PreviewJsonData {
  const only = options.network ? 'network' : options.console ? 'console' : null;
  const pick = (key: 'network' | 'console'): boolean => !only || only === key;
  const last = <T>(items: T[] | undefined): T[] | undefined =>
    items && options.last > 0 ? items.slice(-options.last) : items;

  return {
    timestamp: output.timestamp,
    duration: output.duration,
    target: output.target,
    ...(output.partial !== undefined && { partial: output.partial }),
    ...(output.totals && { totals: output.totals }),
    ...(pick('network') && output.data.network && { network: last(output.data.network) }),
    ...(pick('console') && output.data.console && { console: last(output.data.console) }),
  };
}

/**
 * Format preview as a JSON response envelope.
 *
 * @param output - Preview output
 * @param options - Preview options
 * @returns Pretty-printed `{ version, success, data }` envelope
 */
function formatPreviewAsJson(output: BdgOutput, options: PreviewOptions): string {
  return JSON.stringify(buildSuccessResponse(buildPreviewJsonData(output, options)), null, 2);
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
    `PREVIEW | Duration: ${Math.floor(output.duration / 1000)}s | Updated: ${formatTimestamp(Date.now())}`
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
      const totalCount = output.totals?.network ?? output.data.network.length;
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
          fmt.text(`  Try: bdg network list (to see all types)`);
        } else {
          fmt.text(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
        }
      } else {
        const networkLines = requests.map((req) => {
          const typeAbbr = getResourceTypeAbbr(req.resourceType, req.mimeType);
          const status = getRequestState(req) === 'pending' ? 'PND' : formatRequestStatus(req);
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
      const totalCount = output.totals?.console ?? output.data.console.length;
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
      ['Session started', formatTimestamp(Date.parse(output.timestamp))],
      ['Last updated', formatTimestamp(Date.now())],
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
          : `Network Requests (last ${requests.length} of ${output.totals?.network ?? output.data.network.length})`;
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
          fmt.text(`Try: bdg network list (to see all resource types)`);
        } else {
          fmt.text(PREVIEW_EMPTY_STATES.NO_NETWORK_REQUESTS);
        }
      } else {
        requests.forEach((req) => {
          const state = getRequestState(req);
          const isFailed = state === 'failed' || (req.status ?? 0) >= 400;
          const statusColor = state === 'pending' ? 'PND' : isFailed ? 'ERR' : 'OK';
          const status = state === 'failed' ? 'FAILED' : formatRequestStatus(req);
          fmt.text(`${statusColor} ${status} ${req.method} ${req.url}`);
          if (req.errorText) {
            fmt.text(`  Error: ${req.errorText}`);
          }
          if (req.blockedReason) {
            fmt.text(`  Blocked: ${req.blockedReason}`);
          }
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
          : `Console Messages (last ${messages.length} of ${output.totals?.console ?? output.data.console.length})`;
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
