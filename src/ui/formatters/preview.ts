import type { BdgOutput } from '@/types';
import { truncateUrl, truncateText } from '@/ui/formatting.js';
import {
  PREVIEW_EMPTY_STATES,
  PREVIEW_HEADERS,
  compactTipsMessage,
  verboseCommandsMessage,
} from '@/ui/messages/preview.js';

/**
 * Flags that shape how preview output is rendered for `bdg peek`.
 */
export interface PreviewOptions {
  /** Emit raw JSON instead of formatted text. */
  json?: boolean;
  /** Limit output to network requests (ignores console data). */
  network?: boolean;
  /** Limit output to console messages (ignores network data). */
  console?: boolean;
  /** Number of recent entries to include (parsed as integer). */
  last: string;
  /** Use the expanded, human-friendly layout. */
  verbose?: boolean;
  /** Stream updates until interrupted (tail-like behaviour). */
  follow?: boolean;
  /** Current view timestamp (for follow mode to show refresh time). */
  viewedAt?: Date;
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
 * Returns the output wrapped in a preview object to maintain the
 * IPC response structure (.preview.data path for JSON consumers).
 */
function formatPreviewAsJson(output: BdgOutput, options: PreviewOptions): string {
  const jsonOutput: BdgOutput = {
    ...output,
  };

  // Apply filters
  if (options.network) {
    delete jsonOutput.data.console;
  }
  if (options.console) {
    delete jsonOutput.data.network;
  }

  // Apply --last limit
  const lastCount = parseInt(options.last);
  if (jsonOutput.data.network && jsonOutput.data.network.length > lastCount) {
    jsonOutput.data.network = jsonOutput.data.network.slice(-lastCount);
  }
  if (jsonOutput.data.console && jsonOutput.data.console.length > lastCount) {
    jsonOutput.data.console = jsonOutput.data.console.slice(-lastCount);
  }

  // Wrap in preview object to maintain .preview.data path for JSON consumers
  return JSON.stringify({ preview: jsonOutput }, null, 2);
}

/**
 * Format preview as human-readable output
 */
function formatPreviewHumanReadable(output: BdgOutput, options: PreviewOptions): string {
  // Use verbose format if requested, otherwise use compact
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
  const lines: string[] = [];

  // Header with data collection timestamp
  lines.push(
    `PREVIEW | Duration: ${Math.floor(output.duration / 1000)}s | Updated: ${output.timestamp}`
  );

  // In follow mode, add current refresh time to show live updates
  if (options.follow && options.viewedAt) {
    lines.push(`Viewed at: ${options.viewedAt.toISOString()}`);
  }

  lines.push('');

  const lastCount = parseInt(options.last);
  const hasNetworkData = output.data.network && output.data.network.length > 0;
  const hasConsoleData = output.data.console && output.data.console.length > 0;

  // Show network requests only if not filtered out or has data
  if (!options.console && output.data.network) {
    // Hide empty section if console filter is active and there's no network data
    if (options.console === undefined || hasNetworkData) {
      const requests = output.data.network.slice(-lastCount);
      lines.push(`NETWORK (${requests.length}/${output.data.network.length}):`);
      if (requests.length === 0) {
        lines.push(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
      } else {
        requests.forEach((req) => {
          const status = req.status ?? 'pending';
          const url = truncateUrl(req.url, 50);
          lines.push(`  ${status} ${req.method} ${url} [${req.requestId}]`);
        });
      }
      lines.push('');
    }
  }

  // Show console messages only if not filtered out or has data
  if (!options.network && output.data.console) {
    // Hide empty section if network filter is active and there's no console data
    if (options.network === undefined || hasConsoleData) {
      const messages = output.data.console.slice(-lastCount);
      lines.push(`CONSOLE (${messages.length}/${output.data.console.length}):`);
      if (messages.length === 0) {
        lines.push(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
      } else {
        messages.forEach((msg) => {
          const prefix = msg.type.toUpperCase().padEnd(5);
          const text = truncateText(msg.text, 2);
          lines.push(`  ${prefix} ${text}`);
        });
      }
      lines.push('');
    }
  }

  // Suppress tips in follow mode to reduce screen clutter during live updates
  if (!options.follow) {
    lines.push(compactTipsMessage());
  }

  return lines.join('\n');
}

/**
 * Format preview in verbose format (opt-in with --verbose)
 * Original human-friendly output with Unicode formatting
 */
function formatPreviewVerbose(output: BdgOutput, options: PreviewOptions): string {
  const lines: string[] = [];

  lines.push(PREVIEW_HEADERS.LIVE_PREVIEW);
  lines.push('━'.repeat(50));
  lines.push(`Duration:         ${Math.floor(output.duration / 1000)}s`);
  lines.push(`Last updated:     ${output.timestamp}`);

  // In follow mode, add current refresh time to show live updates
  if (options.follow && options.viewedAt) {
    lines.push(`Viewed at:        ${options.viewedAt.toISOString()}`);
  }

  lines.push('');

  const lastCount = parseInt(options.last);
  const hasNetworkData = output.data.network && output.data.network.length > 0;
  const hasConsoleData = output.data.console && output.data.console.length > 0;

  // Show network requests only if not filtered out or has data
  if (!options.console && output.data.network) {
    // Hide empty section if console filter is active and there's no network data
    if (options.console === undefined || hasNetworkData) {
      const requests = output.data.network.slice(-lastCount);
      lines.push(`Network Requests (last ${requests.length} of ${output.data.network.length})`);
      lines.push('━'.repeat(50));
      if (requests.length === 0) {
        lines.push(PREVIEW_EMPTY_STATES.NO_NETWORK_REQUESTS);
      } else {
        requests.forEach((req) => {
          const statusColor = req.status && req.status >= 400 ? 'ERR' : 'OK';
          const status = req.status ?? 'pending';
          lines.push(`${statusColor} ${status} ${req.method} ${req.url}`);
          if (req.mimeType) {
            lines.push(`  Type: ${req.mimeType}`);
          }
          lines.push(
            `  ID: ${req.requestId} (use 'bdg details network ${req.requestId}' for full details)`
          );
        });
      }
      lines.push('');
    }
  }

  // Show console messages only if not filtered out or has data
  if (!options.network && output.data.console) {
    // Hide empty section if network filter is active and there's no console data
    if (options.network === undefined || hasConsoleData) {
      const messages = output.data.console.slice(-lastCount);
      lines.push(`Console Messages (last ${messages.length} of ${output.data.console.length})`);
      lines.push('━'.repeat(50));
      if (messages.length === 0) {
        lines.push(PREVIEW_EMPTY_STATES.NO_CONSOLE_MESSAGES);
      } else {
        messages.forEach((msg) => {
          const icon = msg.type === 'error' ? 'ERR' : msg.type === 'warning' ? 'WARN' : 'INFO';
          lines.push(`${icon} [${msg.type}] ${msg.text}`);
        });
      }
      lines.push('');
    }
  }

  // Suppress tips in follow mode to reduce screen clutter during live updates
  if (!options.follow) {
    lines.push(verboseCommandsMessage());
  }

  return lines.join('\n');
}
