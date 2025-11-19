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
    if (options.console === undefined || hasNetworkData) {
      const requests = output.data.network.slice(-lastCount);
      fmt.text(`NETWORK (${requests.length}/${output.data.network.length}):`);
      if (requests.length === 0) {
        fmt.text(`  ${PREVIEW_EMPTY_STATES.NO_DATA}`);
      } else {
        const networkLines = requests.map((req) => {
          const status = req.status ?? 'pending';
          const url = truncateUrl(req.url, 50);
          return `${status} ${req.method} ${url} [${req.requestId}]`;
        });
        fmt.list(networkLines, 2);
      }
      fmt.blank();
    }
  }

  if (!options.network && output.data.console) {
    if (options.network === undefined || hasConsoleData) {
      const messages = output.data.console.slice(-lastCount);
      fmt.text(`CONSOLE (${messages.length}/${output.data.console.length}):`);
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
    if (options.console === undefined || hasNetworkData) {
      const requests = output.data.network.slice(-lastCount);
      fmt
        .text(`Network Requests (last ${requests.length} of ${output.data.network.length})`)
        .separator('━', 50);
      if (requests.length === 0) {
        fmt.text(PREVIEW_EMPTY_STATES.NO_NETWORK_REQUESTS);
      } else {
        requests.forEach((req) => {
          const statusColor = req.status && req.status >= 400 ? 'ERR' : 'OK';
          const status = req.status ?? 'pending';
          fmt.text(`${statusColor} ${status} ${req.method} ${req.url}`);
          if (req.mimeType) {
            fmt.text(`  Type: ${req.mimeType}`);
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
      const messages = output.data.console.slice(-lastCount);
      fmt
        .text(`Console Messages (last ${messages.length} of ${output.data.console.length})`)
        .separator('━', 50);
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
