import * as fs from 'fs';
import * as path from 'path';

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  NetworkCookiesCommandOptions,
  NetworkHarCommandOptions,
  NetworkHeadersCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { getHARData, callCDP, getNetworkHeaders } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { getSessionFilePath } from '@/session/paths.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import type { BdgOutput, NetworkRequest } from '@/types.js';
import { isDaemonConnectionError } from '@/ui/errors/utils.js';
import type { Cookie } from '@/ui/formatters/index.js';
import { formatCookies, formatNetworkHeaders } from '@/ui/formatters/index.js';
import { sessionNotActiveError } from '@/ui/messages/errors.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

/**
 * Generate timestamped filename for HAR export in ~/.bdg/ directory.
 *
 * @returns Full path to HAR file in ~/.bdg/capture-YYYY-MM-DD-HHMMSS.har
 *
 * @example
 * ```typescript
 * generateHARFilename(); // "~/.bdg/capture-2025-11-19-143045.har"
 * ```
 */
function generateHARFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const filename = `capture-${year}-${month}-${day}-${hours}${minutes}${seconds}.har`;
  const sessionDir = path.dirname(getSessionFilePath('OUTPUT'));
  return path.join(sessionDir, filename);
}

/**
 * Fetch network requests from live daemon session.
 *
 * @returns Network requests array
 * @throws Error if daemon connection fails or no network data available
 */
async function fetchFromLiveSession(): Promise<NetworkRequest[]> {
  const response = await getHARData();
  validateIPCResponse(response);

  if (!response.data?.requests) {
    throw new Error('No network data in response');
  }

  return response.data.requests;
}

/**
 * Fetch network requests from offline session.json file.
 *
 * @returns Network requests array
 * @throws Error if session file not found or no network data available
 */
function fetchFromOfflineSession(): NetworkRequest[] {
  const sessionPath = getSessionFilePath('OUTPUT');

  if (!fs.existsSync(sessionPath)) {
    throw new Error(sessionNotActiveError('export network data'), {
      cause: { code: EXIT_CODES.RESOURCE_NOT_FOUND },
    });
  }

  const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as BdgOutput;

  if (!sessionData.data?.network) {
    throw new Error('No network data in session file', {
      cause: { code: EXIT_CODES.RESOURCE_NOT_FOUND },
    });
  }

  return sessionData.data.network;
}

/**
 * Check if error indicates daemon is unavailable.
 *
 * @param error - Error to check
 * @returns True if error indicates no active session or daemon connection failure
 */
function isDaemonUnavailable(error: unknown): boolean {
  if (isDaemonConnectionError(error)) {
    return true;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  return errorMessage.includes('No active session');
}

/**
 * Get network requests from live session or session.json.
 *
 * Tries live daemon first, falls back to offline session file.
 *
 * @returns Network requests array
 * @throws Error if no session available (live or offline)
 */
async function getNetworkRequests(): Promise<NetworkRequest[]> {
  try {
    return await fetchFromLiveSession();
  } catch (error) {
    if (isDaemonUnavailable(error)) {
      return fetchFromOfflineSession();
    }
    throw error;
  }
}

/**
 * Format HAR export success message for human output.
 *
 * @param data - HAR export result data
 * @returns Formatted success message
 */
function formatHARExport(data: { file: string; entries: number }): string {
  return `✓ Exported ${data.entries} requests to ${data.file}`;
}

/**
 * Register network commands.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerNetworkCommands(program: Command): void {
  const networkCmd = program.command('network').description('Inspect network state and resources');

  networkCmd
    .command('har [output-file]')
    .description('Export network data as HAR 1.2 format')
    .addOption(jsonOption())
    .action(async (outputFile: string | undefined, options: NetworkHarCommandOptions) => {
      await runCommand(
        async () => {
          const requests = await getNetworkRequests();

          const outputPath = outputFile ?? generateHARFilename();

          const dir = path.dirname(outputPath);
          if (dir !== '.' && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const har = buildHAR(requests, {
            version: VERSION,
          });

          await AtomicFileWriter.writeAsync(outputPath, JSON.stringify(har, null, 2));

          return {
            success: true,
            data: {
              file: outputPath,
              entries: har.log.entries.length,
            },
          };
        },
        options,
        formatHARExport
      );
    });

  networkCmd
    .command('getCookies')
    .description('List cookies from the current page')
    .option('--url <url>', 'Filter cookies by URL')
    .addOption(jsonOption())
    .action(async (options: NetworkCookiesCommandOptions) => {
      await runCommand(
        async (opts) => {
          const params: Record<string, unknown> = {};
          if (opts.url) {
            params['urls'] = [opts.url];
          }

          const response = await callCDP('Network.getCookies', params);

          validateIPCResponse(response);

          const cookies = (response.data?.result as { cookies?: Cookie[] })?.cookies ?? [];

          return {
            success: true,
            data: cookies,
          };
        },
        options,
        formatCookies
      );
    });

  networkCmd
    .command('headers [id]')
    .description('Show HTTP headers (defaults to current main document)')
    .option('--header <name>', 'Filter to specific header name')
    .addOption(jsonOption())
    .addHelpText(
      'after',
      '\nNote: Without [id], shows headers for the current main document.\n      If the page has navigated, this will be the latest navigation, not the original URL.'
    )
    .action(async (id: string | undefined, options: NetworkHeadersCommandOptions) => {
      await runCommand(
        async (opts) => {
          const response = await getNetworkHeaders({
            ...(id && { id }),
            ...(opts.header && { headerName: opts.header }),
          });

          validateIPCResponse(response);

          if (!response.data) {
            return {
              success: false,
              error: 'No data returned from worker',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            };
          }

          return {
            success: true,
            data: response.data,
          };
        },
        options,
        formatNetworkHeaders
      );
    });

  networkCmd
    .command('document')
    .description('Show main HTML document request details (alias for headers without ID)')
    .option('--header <name>', 'Filter to specific header name')
    .addOption(jsonOption())
    .action(async (options: NetworkHeadersCommandOptions) => {
      await runCommand(
        async (opts) => {
          const response = await getNetworkHeaders({
            ...(opts.header && { headerName: opts.header }),
          });

          validateIPCResponse(response);

          if (!response.data) {
            return {
              success: false,
              error: 'No data returned from worker',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            };
          }

          return {
            success: true,
            data: response.data,
          };
        },
        options,
        formatNetworkHeaders
      );
    });
}
