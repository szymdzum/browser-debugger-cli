import type { Protocol } from '@/connection/typed-cdp.js';
import {
  MAX_CONSOLE_TEXT_LENGTH,
  MIME_TYPE_RULES,
  RESOURCE_TYPE_ABBREVIATIONS,
} from '@/constants.js';
import type { BdgOutput } from '@/types.js';
import { buildSuccessResponse, stringifyEnvelope } from '@/ui/OutputBuilder.js';
import { capMessageText, formatTimestamp } from '@/ui/formatters/console/shared.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import {
  failureReason,
  formatRequestStatus,
  getRequestState,
} from '@/ui/formatters/requestStatus.js';
import { OutputFormatter, truncateUrl, truncateText } from '@/ui/formatting.js';
import {
  downloadsSummary,
  moreCharsNote,
  withPageCrashedNote,
  withTabSwitchNote,
} from '@/ui/messages/commands.js';
import { consoleDroppedNote } from '@/ui/messages/consoleMessages.js';
import { peekIssuesLine } from '@/ui/messages/issueMessages.js';
import { networkEvictedNote } from '@/ui/messages/networkMessages.js';
import {
  PREVIEW_EMPTY_STATES,
  PREVIEW_HEADERS,
  compactTipsMessage,
  verboseCommandsMessage,
} from '@/ui/messages/preview.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { capLength } from '@/utils/strings.js';

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
  /** Console message texts whole instead of cut (`--full`). */
  full?: boolean | undefined;
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
  /** When the page's renderer crashed (epoch ms), while it is not loaded again */
  pageCrashedAt?: number;
  /** Downloads that began during the session, oldest first */
  downloads?: BdgOutput['downloads'];
  /** The session's latest move to another tab */
  tabSwitch?: BdgOutput['tabSwitch'];
  network?: BdgOutput['data']['network'];
  console?: BdgOutput['data']['console'];
}

/**
 * Build the JSON payload for a preview, honoring the section and `--last`
 * filters; console texts are cut with `truncatedFrom` unless `--full`.
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
    ...(output.pageCrashedAt !== undefined && { pageCrashedAt: output.pageCrashedAt }),
    ...(output.downloads && { downloads: output.downloads }),
    ...(output.tabSwitch && { tabSwitch: output.tabSwitch }),
    ...(pick('network') && output.data.network && { network: last(output.data.network) }),
    ...(pick('console') &&
      output.data.console && {
        console: last(output.data.console)?.map((message) => capMessageText(message, options.full)),
      }),
  };
}

/**
 * Format preview as a JSON response envelope.
 *
 * @param output - Preview output
 * @param options - Preview options
 * @returns `{ version, success, data }` envelope, indented on a terminal, and
 *   always on one line in follow mode (one object per line, NDJSON)
 */
function formatPreviewAsJson(output: BdgOutput, options: PreviewOptions): string {
  const envelope = buildSuccessResponse(buildPreviewJsonData(output, options));
  return options.follow ? JSON.stringify(envelope) : stringifyEnvelope(envelope);
}

/**
 * Format preview as human-readable output, after a warning when the page
 * crashed (what is shown was collected before), and with a note when the
 * session moved to a tab whose earlier activity is not recorded.
 */
function formatPreviewHumanReadable(output: BdgOutput, options: PreviewOptions): string {
  const body = options.verbose
    ? formatPreviewVerbose(output, options)
    : formatPreviewCompact(output, options);
  const view = options.network ? 'network' : options.console ? 'console' : 'all';
  return withPageCrashedNote(withTabSwitchNote(body, output.tabSwitch, view), output.pageCrashedAt);
}

/**
 * A console message text in the compact preview: cut like `console --list`
 * cuts it and to its first two lines, or whole with `--full`. The pointer
 * naming `--full` comes after the line cut, so it is always shown.
 *
 * @param text - Message text
 * @param full - `--full`
 * @returns Text to print
 */
function compactConsoleText(text: string, full: boolean | undefined): string {
  if (full) return text;
  const capped = capLength(text, MAX_CONSOLE_TEXT_LENGTH);
  const shown = truncateText(capped.text, 2);
  return capped.truncatedFrom === undefined
    ? shown
    : `${shown}${moreCharsNote(capped.truncatedFrom - capped.text.length)}`;
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
      const evictedNote = previewEvictedNote(output);
      if (evictedNote) fmt.text(`  ${evictedNote}`);
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
    if (!options.network || hasConsoleData) {
      const messages =
        lastCount === 0 ? output.data.console : output.data.console.slice(-lastCount);
      const showingCount = messages.length;
      const totalCount = output.totals?.console ?? output.data.console.length;
      const limitHint = formatLimitHint(showingCount, totalCount);
      fmt.text(`CONSOLE (${showingCount}/${totalCount})${limitHint}:`);
      if (output.totals?.consoleDropped)
        fmt.text(`  ${consoleDroppedNote(output.totals.consoleDropped)}`);
      if (messages.length === 0) {
        fmt.text(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
      } else {
        const consoleLines = messages.map((msg) => {
          const prefix = msg.type.toUpperCase().padEnd(5);
          return `${prefix} ${compactConsoleText(msg.text, options.full)}`;
        });
        fmt.list(consoleLines, 2);
      }
      fmt.blank();
    }
  }

  const issues = issuesLine(output, options);
  if (issues) fmt.text(issues).blank();

  if (output.downloads?.length)
    fmt.text(`Downloads: ${downloadsSummary(output.downloads)}`).blank();

  if (!options.follow) {
    fmt.tip(compactTipsMessage());
  }

  return fmt.build();
}

/**
 * The count of the page's Chrome Issues, unless only network requests are
 * shown.
 *
 * @param output - Preview output with its totals
 * @param options - Preview options
 * @returns Line, or undefined when the page has none
 */
function issuesLine(output: BdgOutput, options: PreviewOptions): string | undefined {
  const count = (output.totals?.issues ?? 0) + (output.totals?.issuesDropped ?? 0);
  return count > 0 && !options.network ? peekIssuesLine(count) : undefined;
}

/**
 * Note that the session dropped requests or evicted bodies at its capture limits.
 *
 * @param output - Preview output with its totals
 * @returns Note text, or undefined when nothing was let go
 */
function previewEvictedNote(output: BdgOutput): string | undefined {
  return networkEvictedNote({
    requestsDropped: output.totals?.networkDropped ?? 0,
    bodiesEvicted: output.totals?.networkBodiesEvicted ?? 0,
  });
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
      const evictedNote = previewEvictedNote(output);
      if (evictedNote) fmt.text(evictedNote);
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
          const reason = failureReason(req);
          if (reason) fmt.text(`  Error: ${reason}`);

          if (req.resourceType) {
            fmt.text(`  Resource: ${req.resourceType}`);
          }
          if (req.mimeType) {
            fmt.text(`  MIME: ${req.mimeType}`);
          }
          fmt.text(
            `  ID: ${req.requestId} (use '${sessionCommand(`bdg details network ${req.requestId}`)}' for full details)`
          );
        });
      }
      fmt.blank();
    }
  }

  if (!options.network && output.data.console) {
    if (!options.network || hasConsoleData) {
      const messages =
        lastCount === 0 ? output.data.console : output.data.console.slice(-lastCount);
      const title =
        lastCount === 0
          ? `Console Messages (all ${messages.length})`
          : `Console Messages (last ${messages.length} of ${output.totals?.console ?? output.data.console.length})`;
      fmt.text(title).separator('━', 50);
      if (output.totals?.consoleDropped) fmt.text(consoleDroppedNote(output.totals.consoleDropped));
      if (messages.length === 0) {
        fmt.text(PREVIEW_EMPTY_STATES.NO_CONSOLE_MESSAGES);
      } else {
        messages.forEach((msg) => {
          const icon = msg.type === 'error' ? 'ERR' : msg.type === 'warning' ? 'WARN' : 'INFO';
          fmt.text(
            `${icon} [${msg.type}] ${capForDisplay(msg.text, MAX_CONSOLE_TEXT_LENGTH, options.full)}`
          );
        });
      }
      fmt.blank();
    }
  }

  const issues = issuesLine(output, options);
  if (issues) fmt.text(issues).blank();

  if (output.downloads?.length) {
    fmt.keyValue('Downloads', downloadsSummary(output.downloads), 18).blank();
  }

  if (!options.follow) {
    fmt.tip(verboseCommandsMessage());
  }

  return fmt.build();
}
