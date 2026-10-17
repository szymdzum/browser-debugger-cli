import { Option, type Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { includeSensitiveOption, jsonOption } from '@/commands/shared/commonOptions.js';
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
import { maskNetworkRequest, type Masked } from '@/telemetry/networkMasking.js';
import { capResponseBody, missingBodyReason } from '@/telemetry/responseBody.js';
import type { NetworkRequest } from '@/types.js';
import { formatNetworkDetails, formatConsoleDetails } from '@/ui/formatters/details.js';
import {
  base64BodyHint,
  bodyCutHint,
  includeSensitiveWarning,
  networkSecretsMaskedNote,
} from '@/ui/messages/networkMessages.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { validateDetailsItem } from '@/utils/typeGuards.js';

/**
 * `network details <id> --body` result (the `data` of `--json`).
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
  /** A credential in the body was shown as `••••` (no `--include-sensitive`) */
  masked?: true;
}

type DetailsOutput = DetailsResult | NetworkBodyResult;

/**
 * Format details for human-readable output.
 * Dispatches to the appropriate formatter based on type.
 *
 * @param data - Details result
 * @param options - Body options of `network details`
 * @returns Text (the raw body for `--body`)
 */
function formatDetails(data: DetailsOutput, options: DetailsCommandOptions): string {
  if (data.type === 'network-body') return data.body;
  if (data.type === 'network') {
    const details = formatNetworkDetails(data.item, {
      noBody: options.body === false,
      bodyMax: options.bodyMax,
    });
    return data.masked ? `${details}\n\n${networkSecretsMaskedNote()}` : details;
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
 * The network-only option given, if any.
 *
 * @param options - Command options
 * @returns e.g. `--body`, or undefined when none was given
 */
function networkOnlyOption(options: DetailsCommandOptions): string | undefined {
  if (options.body === true) return '--body';
  if (options.body === false) return '--no-body';
  if (options.bodyMax !== undefined) return '--body-max';
  return options.includeSensitive ? '--include-sensitive' : undefined;
}

/**
 * Check the network options: network only, and `--body-max` needs a body.
 *
 * @param options - Command options
 * @throws CommandError (exit 81) for a combination that does not apply
 */
function validateBodyOptions(options: DetailsCommandOptions): void {
  const used = options.type === 'console' ? networkOnlyOption(options) : undefined;
  if (used) throwInvalid(networkOnlyDetailsOptionError(used));
  if (options.body === false && options.bodyMax !== undefined) {
    throwInvalid(conflictingOptionsError('--no-body', '--body-max'));
  }
}

/**
 * The response body alone (`--body`): whole unless `--body-max` is given.
 *
 * @param request - Captured request, masked unless `--include-sensitive`
 * @param bodyMax - `--body-max` (default: all)
 * @param masked - Whether a credential in the response body was masked
 * @returns Body result, with hints for a base64, cut or masked body
 * @throws CommandError (exit 83) when the request has no body to print
 */
function bodyOnly(
  request: NetworkRequest,
  bodyMax: number | undefined,
  masked: boolean
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
    ...(masked ? [networkSecretsMaskedNote()] : []),
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
      ...(masked && { masked: true as const }),
    },
  };
}

/**
 * The network request as `network details` shows it: credentials masked
 * (unless `--include-sensitive`, which warns), the response body cut at the
 * cap in `--json` (human output cuts it in the formatter), the body alone
 * with `--body`.
 *
 * @param request - Captured request
 * @param options - Command options
 * @returns Command result
 */
function networkDetails(
  request: NetworkRequest,
  options: DetailsCommandOptions
): CommandResult<DetailsOutput> {
  const shown = options.includeSensitive
    ? { value: request, masked: false }
    : maskNetworkRequest(request);
  const result =
    options.body === true
      ? bodyOnly(shown.value, options.bodyMax, shown.value.responseBody !== request.responseBody)
      : detailsResult(shown, options);
  return options.includeSensitive ? { ...result, warning: includeSensitiveWarning() } : result;
}

/**
 * The request details, the response body cut at the cap in `--json`.
 *
 * @param shown - Captured request, masked unless `--include-sensitive`
 * @param options - Command options
 * @returns Command result
 */
function detailsResult(
  shown: Masked<NetworkRequest>,
  options: DetailsCommandOptions
): CommandResult<DetailsOutput> {
  const item = options.json
    ? capResponseBody(shown.value, { noBody: options.body === false, bodyMax: options.bodyMax })
    : shown.value;
  return {
    success: true,
    data: { type: 'network', item, ...(shown.masked && { masked: true as const }) },
  };
}

/**
 * Show one captured request or console message: the handler behind
 * `network details <id>`, `console details <n>` and the deprecated
 * `details <type> <id>`.
 *
 * @param options - Command options with the item's type and id
 */
async function runDetails(options: DetailsCommandOptions): Promise<void> {
  await runCommand<DetailsCommandOptions, DetailsOutput>(
    async (opts) => {
      if (opts.type !== 'network' && opts.type !== 'console') {
        return usageFailure(`Unknown type: ${String(opts.type)}. Valid types: network, console`);
      }

      if (!opts.id.trim()) {
        return usageFailure(
          `The ${opts.type === 'network' ? 'request id' : 'message index'} is empty`
        );
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
}

/**
 * A usage failure (exit 81) naming the commands that show details.
 *
 * @param error - What is wrong
 * @returns Failed command result
 */
function usageFailure(error: string): CommandResult<never> {
  return {
    success: false,
    error,
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    errorContext: {
      suggestion: 'Usage: bdg network details <requestId> or bdg console details <index>',
    },
  };
}

/**
 * Register `details` on `network` or `console`: the item's id is its argument.
 * `--json` and `--include-sensitive` given to `console` before `details` count too.
 *
 * @param parent - The `network` or `console` command
 * @param type - What it shows details of
 */
export function registerDetailsSubcommand(parent: Command, type: 'network' | 'console'): void {
  const command = parent
    .command('details')
    .description(
      type === 'network'
        ? 'Get detailed information for a specific request'
        : 'Get detailed information for a specific console message'
    )
    .argument(
      '<id>',
      type === 'network' ? 'Request ID (from network list)' : 'Message index (from console)'
    )
    .addOption(jsonOption());
  if (type === 'network') addBodyOptions(command);
  command
    .addOption(includeSensitiveOption())
    .action(async (id: string, options: DetailsCommandOptions) => {
      const inherited = parent.opts<Pick<DetailsCommandOptions, 'json' | 'includeSensitive'>>();
      await runDetails({
        ...options,
        json: options.json === true || inherited.json === true,
        ...((options.includeSensitive === true || inherited.includeSensitive === true) && {
          includeSensitive: true,
        }),
        type,
        id,
      });
    });
}

/**
 * The response body options of `network details`.
 *
 * @param command - Command to add them to
 */
function addBodyOptions(command: Command): void {
  command
    .addOption(new Option('--body', 'Print only the response body, whole and raw (for piping)'))
    .addOption(new Option('--no-body', 'Leave the response body out'))
    .addOption(
      new Option(
        '--body-max <chars>',
        'Characters of the response body to show (default 20000; 0 = all)'
      ).argParser(integerOption(0))
    );
}

/**
 * Register the deprecated `details <type> <id>` command (see the rename
 * table, `@/utils/renames.ts`); it runs the handler of `network details`
 * and `console details`.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerDetailsCommand(program: Command): void {
  const command = program
    .command('details')
    .description('Get detailed information for a specific request or console message')
    .argument('<type>', 'Type of item: "network" or "console"')
    .argument('<id>', 'Request ID (for network) or index (for console)')
    .addOption(jsonOption());
  addBodyOptions(command);
  command
    .addOption(includeSensitiveOption())
    .action(async (type: string, id: string, options: DetailsCommandOptions) => {
      await runDetails({ ...options, type: type as 'network' | 'console', id });
    });
}
