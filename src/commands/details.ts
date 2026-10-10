import { Option, type Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { DetailsCommandOptions } from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import type { DetailsResult } from '@/commands/types.js';
import { CommandError } from '@/errors/index.js';
import {
  conflictingOptionsError,
  networkOnlyDetailsOptionError,
  responseBodyMissingError,
} from '@/errors/messages.js';
import { getDetails } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { capResponseBody, missingBodyReason } from '@/telemetry/responseBody.js';
import type { NetworkRequest } from '@/types.js';
import { formatNetworkDetails, formatConsoleDetails } from '@/ui/formatters/details.js';
import { base64BodyHint, bodyCutHint } from '@/ui/messages/networkMessages.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { validateDetailsItem } from '@/utils/typeGuards.js';

/**
 * `details network <id> --body` result (the `data` of `--json`).
 */
interface NetworkBodyResult {
  type: 'network-body';
  requestId: string;
  /** The response body, whole unless `--body-max` cut it */
  body: string;
  /** Characters of the whole body */
  bodyLength: number;
  /** The body is base64 (binary) */
  base64Encoded?: true;
  /** `--body-max` cut the body */
  bodyTruncated?: true;
  mimeType?: string;
}

type DetailsOutput = DetailsResult | NetworkBodyResult;

/**
 * Format details for human-readable output.
 * Dispatches to the appropriate formatter based on type.
 *
 * @param data - Details result
 * @param options - Body options of `details network`
 * @returns Text (the raw body for `--body`)
 */
function formatDetails(data: DetailsOutput, options: DetailsCommandOptions): string {
  if (data.type === 'network-body') return data.body;
  if (data.type === 'network') {
    return formatNetworkDetails(data.item, {
      noBody: options.body === false,
      bodyMax: options.bodyMax,
    });
  }
  return formatConsoleDetails(data.item);
}

/**
 * Throw a usage error (exit 81).
 *
 * @param error - Message and suggestion
 * @throws CommandError always
 */
function throwInvalid(error: { message: string; suggestion: string }): never {
  throw new CommandError(
    error.message,
    { suggestion: error.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}

/**
 * Check the body options: network only, and `--body-max` needs a body.
 *
 * @param options - Command options
 * @throws CommandError (exit 81) for a combination that does not apply
 */
function validateBodyOptions(options: DetailsCommandOptions): void {
  const flag = options.body === true ? '--body' : options.body === false ? '--no-body' : undefined;
  if (options.type === 'console') {
    const used = flag ?? (options.bodyMax !== undefined ? '--body-max' : undefined);
    if (used) throwInvalid(networkOnlyDetailsOptionError(used));
  }
  if (options.body === false && options.bodyMax !== undefined) {
    throwInvalid(conflictingOptionsError('--no-body', '--body-max'));
  }
}

/**
 * The response body alone (`--body`): whole unless `--body-max` is given.
 *
 * @param request - Captured request
 * @param bodyMax - `--body-max` (default: all)
 * @returns Body result, with a hint for a base64 body
 * @throws CommandError (exit 83) when the request has no body to print
 */
function bodyOnly(
  request: NetworkRequest,
  bodyMax: number | undefined
): CommandResult<NetworkBodyResult> {
  const reason = missingBodyReason(request);
  if (reason !== undefined) {
    const err = responseBodyMissingError(request.requestId, reason);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const capped = capResponseBody(request, { bodyMax: bodyMax ?? 0 });
  const body = capped.responseBody ?? '';
  const hints = [
    ...(capped.bodyTruncated && capped.bodyLength !== undefined
      ? [bodyCutHint(body.length, capped.bodyLength)]
      : []),
    ...(request.responseBodyBase64 ? [base64BodyHint()] : []),
  ];
  return {
    success: true,
    raw: true,
    ...(hints.length > 0 && { hint: hints.join('\n') }),
    data: {
      type: 'network-body',
      requestId: request.requestId,
      body,
      bodyLength: capped.bodyLength ?? body.length,
      ...(request.responseBodyBase64 && { base64Encoded: true as const }),
      ...(capped.bodyTruncated && { bodyTruncated: true as const }),
      ...(request.mimeType !== undefined && { mimeType: request.mimeType }),
    },
  };
}

/**
 * The network request as `details network` shows it: the response body cut
 * at the cap in `--json` (human output cuts it in the formatter), the body
 * alone with `--body`.
 *
 * @param request - Captured request
 * @param options - Command options
 * @returns Command result
 */
function networkDetails(
  request: NetworkRequest,
  options: DetailsCommandOptions
): CommandResult<DetailsOutput> {
  if (options.body === true) return bodyOnly(request, options.bodyMax);
  const item = options.json
    ? capResponseBody(request, { noBody: options.body === false, bodyMax: options.bodyMax })
    : request;
  return { success: true, data: { type: 'network', item } };
}

/**
 * Register details command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerDetailsCommand(program: Command): void {
  program
    .command('details')
    .description('Get detailed information for a specific request or console message')
    .argument('<type>', 'Type of item: "network" or "console"')
    .argument('<id>', 'Request ID (for network) or index (for console)')
    .addOption(jsonOption())
    .addOption(
      new Option('--body', 'Network: print only the response body, whole and raw (for piping)')
    )
    .addOption(new Option('--no-body', 'Network: leave the response body out'))
    .addOption(
      new Option(
        '--body-max <chars>',
        'Network: characters of the response body to show (default 20000; 0 = all)'
      ).argParser(integerOption(0))
    )
    .action(async (type: string, id: string, options: DetailsCommandOptions) => {
      options.type = type as 'network' | 'console';
      options.id = id;

      await runCommand<DetailsCommandOptions, DetailsOutput>(
        async (opts) => {
          if (opts.type !== 'network' && opts.type !== 'console') {
            return {
              success: false,
              error: `Unknown type: ${String(opts.type)}. Valid types: network, console`,
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: 'Usage: bdg details network <requestId> or bdg details console <index>',
              },
            };
          }

          if (!opts.id.trim()) {
            return {
              success: false,
              error: `The ${opts.type === 'network' ? 'request id' : 'message index'} is empty`,
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: 'Usage: bdg details network <requestId> or bdg details console <index>',
              },
            };
          }

          validateBodyOptions(opts);

          const response = await getDetails(opts.type, opts.id);

          validateIPCResponse(response);

          if (!response.data?.item) {
            return {
              success: false,
              error: 'No data in response',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
              errorContext: {
                suggestion:
                  opts.type === 'network'
                    ? `Use ${sessionCommand('bdg network list')} to see available request IDs`
                    : `Use ${sessionCommand('bdg peek --console')} to see available console message indices`,
              },
            };
          }

          if (opts.type === 'network') {
            return networkDetails(validateDetailsItem(response.data.item, 'network'), opts);
          }
          return {
            success: true,
            data: {
              type: 'console' as const,
              item: validateDetailsItem(response.data.item, 'console'),
            },
          };
        },
        options,
        (data) => formatDetails(data, options)
      );
    });
}
