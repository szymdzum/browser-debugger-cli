/**
 * Shared utilities and helper commands for network subcommands.
 *
 * Contains cookies and headers commands, plus shared data fetching utilities.
 */

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { includeSensitiveOption, jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  NetworkCookiesCommandOptions,
  NetworkHeadersCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import { getHARData, callCDP, getNetworkHeaders } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { SessionNetworkHeadersData } from '@/ipc/protocol/commands.js';
import { validateFilterString } from '@/telemetry/filterDsl.js';
import { maskHeaderFields } from '@/telemetry/networkMasking.js';
import type { NetworkRequest } from '@/types.js';
import type { Cookie, NetworkHeadersOutput } from '@/ui/formatters/index.js';
import { formatCookies, formatNetworkHeaders } from '@/ui/formatters/index.js';
import {
  NETWORK_DOCUMENT_BODY_NOTE,
  includeSensitiveWarning,
} from '@/ui/messages/networkMessages.js';
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
 * The headers `network headers` and `network document` show: credentials
 * masked, or as captured with a warning (`--include-sensitive`).
 *
 * @param data - URL and headers from the session
 * @param includeSensitive - Whether `--include-sensitive` was given
 * @returns Command result
 */
function headersResult(
  data: SessionNetworkHeadersData,
  includeSensitive: boolean | undefined
): CommandResult<NetworkHeadersOutput> {
  if (includeSensitive) return { success: true, data, warning: includeSensitiveWarning() };
  const { value, masked } = maskHeaderFields(data);
  return { success: true, data: { ...value, ...(masked && { masked: true as const }) } };
}

/**
 * Add the cookies command: `network cookies`, and the old spelling
 * `network getCookies` (a hidden, deprecated row of the rename table) with
 * the same options.
 *
 * @param networkCmd - Network parent command
 * @param name - Command name
 * @param hidden - Whether the command is hidden from help
 */
function addCookiesCommand(networkCmd: Command, name: string, hidden: boolean): void {
  networkCmd
    .command(name, { hidden })
    .description('List cookies from the current page')
    .option('--url <url>', 'Filter cookies by URL')
    .addOption(jsonOption())
    .action(async (options: NetworkCookiesCommandOptions) => {
      await runCommand(
        async (opts) => {
          const params: Record<string, unknown> = {};
          if (opts.url) {
            if (!URL.canParse(opts.url)) {
              return {
                success: false,
                error: `Invalid --url: ${opts.url}`,
                exitCode: EXIT_CODES.INVALID_ARGUMENTS,
                errorContext: { suggestion: 'Give a full URL, e.g. --url https://example.com/' },
              };
            }
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
 * Register the cookies command and its old spelling.
 *
 * @param networkCmd - Network parent command
 */
export function registerCookiesCommands(networkCmd: Command): void {
  addCookiesCommand(networkCmd, 'cookies', false);
  addCookiesCommand(networkCmd, 'getCookies', true);
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
    .addOption(includeSensitiveOption())
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
              error: 'No data returned from the session',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'No network requests captured yet. Navigate to a page first.',
              },
            };
          }

          return headersResult(response.data, opts.includeSensitive);
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
    .addOption(includeSensitiveOption())
    .addHelpText('after', `\n${NETWORK_DOCUMENT_BODY_NOTE}`)
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
              error: 'No data returned from the session',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion: 'No document request found. Navigate to a page first.',
              },
            };
          }

          return headersResult(response.data, opts.includeSensitive);
        },
        options,
        formatNetworkHeaders
      );
    });
}
