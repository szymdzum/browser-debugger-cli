import { BdgOutput } from '../../types.js';

export interface PreviewOptions {
  json?: boolean;
  network?: boolean;
  console?: boolean;
  last: string;
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
 */
function formatPreviewAsJson(output: BdgOutput, options: PreviewOptions): string {
  const jsonOutput: any = {
    ...output
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

  return JSON.stringify(jsonOutput, null, 2);
}

/**
 * Format preview as human-readable output
 */
function formatPreviewHumanReadable(output: BdgOutput, options: PreviewOptions): string {
  const lines: string[] = [];

  lines.push('Live Preview (Partial Data)');
  lines.push('━'.repeat(50));
  lines.push(`Duration:         ${Math.floor(output.duration / 1000)}s`);
  lines.push(`Last updated:     ${output.timestamp}`);
  lines.push('');

  const lastCount = parseInt(options.last);

  // Show network requests
  if (!options.console && output.data.network) {
    const requests = output.data.network.slice(-lastCount);
    lines.push(`Network Requests (last ${requests.length} of ${output.data.network.length})`);
    lines.push('━'.repeat(50));
    if (requests.length === 0) {
      lines.push('No network requests yet');
    } else {
      requests.forEach(req => {
        const statusColor = req.status && req.status >= 400 ? '❌' : '✓';
        const status = req.status || 'pending';
        lines.push(`${statusColor} ${status} ${req.method} ${req.url}`);
        if (req.mimeType) {
          lines.push(`  Type: ${req.mimeType}`);
        }
        lines.push(`  ID: ${req.requestId} (use 'bdg details network ${req.requestId}' for full details)`);
      });
    }
    lines.push('');
  }

  // Show console messages
  if (!options.network && output.data.console) {
    const messages = output.data.console.slice(-lastCount);
    lines.push(`Console Messages (last ${messages.length} of ${output.data.console.length})`);
    lines.push('━'.repeat(50));
    if (messages.length === 0) {
      lines.push('No console messages yet');
    } else {
      messages.forEach(msg => {
        const icon = msg.type === 'error' ? '❌' : msg.type === 'warning' ? '⚠️ ' : 'ℹ️ ';
        lines.push(`${icon} [${msg.type}] ${msg.text}`);
      });
    }
    lines.push('');
  }

  lines.push('💡 Commands:');
  lines.push('  Stop session:    bdg stop');
  lines.push('  Full preview:    bdg peek --last 50');
  lines.push('  Watch live:      bdg peek --follow');

  return lines.join('\n');
}

/**
 * Format "no preview data" message
 */
export function formatNoPreviewDataMessage(): string {
  return `No preview data available
Session may not be running or preview not yet written

💡 Suggestions:
  Check session status:  bdg status
  Start a session:       bdg <url>`;
}
