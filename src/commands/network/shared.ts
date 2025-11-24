/**
 * Shared utilities and helper commands for network subcommands.
 *
 * Contains getCookies and headers commands, plus shared data fetching utilities.
 */

import * as fs from 'fs';

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  NetworkCookiesCommandOptions,
  NetworkHeadersCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { getHARData, callCDP, getNetworkHeaders } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { getSessionFilePath } from '@/session/paths.js';
import type { BdgOutput, NetworkRequest } from '@/types.js';
import { isDaemonConnectionError } from '@/ui/errors/utils.js';
import type { Cookie } from '@/ui/formatters/index.js';
import { formatCookies, formatNetworkHeaders } from '@/ui/formatters/index.js';
import { sessionNotActiveError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Fetch network requests from live daemon session.
 *
 * @returns Network requests array
 * @throws Error if daemon connection fails or no network data available
 */
export async function fetchFromLiveSession(): Promise<NetworkRequest[]> {
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
export function fetchFromOfflineSession(): NetworkRequest[] {
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
export function isDaemonUnavailable(error: unknown): boolean {
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
export async function getNetworkRequests(): Promise<NetworkRequest[]> {
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
 * Register getCookies command.
 *
 * @param networkCmd - Network parent command
 */
export function registerGetCookiesCommand(networkCmd: Command): void {
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
}

/**
 * Register headers command.
 *
 * @param networkCmd - Network parent command
 */
export function registerHeadersCommand(networkCmd: Command): void {
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
}

/**
 * Register document command.
 *
 * @param networkCmd - Network parent command
 */
export function registerDocumentCommand(networkCmd: Command): void {
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
