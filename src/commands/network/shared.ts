/**
 * Shared utilities and helper commands for network subcommands.
 *
 * Contains getCookies and headers commands, plus shared data fetching utilities.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  NetworkCookiesCommandOptions,
  NetworkHeadersCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import { getHARData, callCDP, getNetworkHeaders } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { validateFilterString } from '@/telemetry/filterDsl.js';
import type { NetworkRequest } from '@/types.js';
import type { Cookie } from '@/ui/formatters/index.js';
import { formatCookies, formatNetworkHeaders } from '@/ui/formatters/index.js';
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
 * Get network requests from live daemon session.
 *
 * @returns Network requests array
 * @throws Error if daemon connection fails or no network data available
 */
export async function getNetworkRequests(): Promise<NetworkRequest[]> {
  return fetchFromLiveSession();
}

/**
 * Validate a filter DSL string and throw a CommandError on invalid input.
 *
 * Centralises the parse-validate-throw flow used by network commands so each
 * command site stays a single line.
 *
 * @param filterString - Filter DSL string to validate
 * @throws CommandError with INVALID_ARGUMENTS exit code on invalid syntax
 */
export function validateFilterOption(filterString: string): void {
  const validation = validateFilterString(filterString);
  if (validation.valid) return;
  const err = operationFailedError(
    'validate filter',
    validation.suggestion ?? 'Check filter syntax'
  );
  throw new CommandError(
    validation.error,
    { suggestion: err.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
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
            data: { cookies },
          };
        },
        options,
        (data: { cookies: Cookie[] }) => formatCookies(data.cookies)
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

          if (response.status === 'error') {
            return {
              success: false,
              error: response.error ?? 'Network request not found',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: id
                  ? 'List captured requests: bdg network list'
                  : 'No main document captured. Navigate to a page first.',
              },
            };
          }

          if (!response.data) {
            return {
              success: false,
              error: 'No data returned from worker',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'No network requests captured yet. Navigate to a page first.',
              },
            };
          }

          if (!id && !opts.json) {
            return {
              success: true,
              data: response.data,
              hint: 'Hint: no request ID given — showing main document. List requests: bdg network list',
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

          if (response.status === 'error') {
            return {
              success: false,
              error: response.error ?? 'No main document captured',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'No main document captured. Navigate to a page first.',
              },
            };
          }

          if (!response.data) {
            return {
              success: false,
              error: 'No data returned from worker',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'No document request found. Navigate to a page first.',
              },
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
