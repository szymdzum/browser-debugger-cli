/**
 * Shared helper for DOM element commands (fill, click, submit, pressKey).
 *
 * Captures the common flow: resolve selector/index → call IPC → normalize errors.
 * Keeps individual command handlers focused on option wiring and output formatting.
 */

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { documentReadyState } from '@/commands/dom/helpers/query.js';
import { staleNodeError, unreachableElementsNote, withLoadingHint } from '@/errors/messages.js';
import { joinLines } from '@/ui/formatting.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface IpcResponse<T> {
  status: string;
  data?: T;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

interface ResultPayload {
  success: boolean;
  error?: string | undefined;
  suggestion?: string | undefined;
  exitCode?: number | undefined;
}

interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode?: number;
  errorContext?: { suggestion: string };
}

/**
 * Options for running a DOM element command.
 */
export interface ElementCommandOptions<Req, Res extends ResultPayload> {
  /** Raw selector or numeric index string from CLI args. */
  selectorOrIndex: string;
  /** Optional --index flag value. */
  index: number | undefined;
  /** Build the IPC request params given the resolved selector + index. */
  buildRequest: (target: { selector: string; index?: number; backendNodeId?: number }) => Req;
  /** Invoke the IPC client function. */
  call: (req: Req) => Promise<IpcResponse<Res>>;
  /** `bdg dom` subcommand being run, e.g. "fill" (for suggestions). */
  command: string;
  /** Operation label used in fallback error messages (e.g. "fill element"). */
  action: string;
  /** Fallback suggestion when the result reports failure without one. */
  failureSuggestion: string;
}

/**
 * Resolve an element target, invoke the IPC call, and normalize failures
 * into the structured `CommandRunner` result shape.
 */
export async function runElementCommand<Req, Res extends ResultPayload>(
  options: ElementCommandOptions<Req, Res>
): Promise<CommandResult<Omit<Res, 'success'>>> {
  const { selectorOrIndex, index, command, buildRequest, call } = options;

  const target = await DomElementResolver.getInstance().resolve(selectorOrIndex, index, command);

  if (!target.success) {
    return {
      success: false,
      error: target.error ?? 'Failed to resolve element target',
      exitCode: target.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
      ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
    };
  }

  const request = buildRequest({
    selector: target.selector,
    ...(target.index !== undefined && { index: target.index }),
    ...(target.backendNodeId !== undefined && { backendNodeId: target.backendNodeId }),
  });

  const response = await call(request);
  const failure =
    response.status === 'error' || !response.data
      ? errorResponseFailure(response, options)
      : response.data.success
        ? undefined
        : failedResultFailure(response.data, options, target.selector);
  if (failure) return withNotFoundLoadingHint(failure, target.selector);

  const { success: _success, ...data } = response.data as Res;
  return { success: true, data };
}

/**
 * Failure for an error response of the daemon.
 *
 * @param response - Error response
 * @param options - Command options (selector or index, action)
 * @returns Failed command result
 */
function errorResponseFailure<Req, Res extends ResultPayload>(
  response: IpcResponse<Res>,
  options: ElementCommandOptions<Req, Res>
): CommandResult<never> {
  const { selectorOrIndex, action } = options;
  const staleIndex =
    response.exitCode === EXIT_CODES.STALE_CACHE && /^\d+$/.test(selectorOrIndex)
      ? staleNodeError(Number(selectorOrIndex)).message
      : undefined;
  return {
    success: false,
    error: staleIndex ?? response.error ?? `Failed to ${action}`,
    exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
    ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
  };
}

/**
 * Failure for an action whose page script reported failure.
 *
 * @param result - Action result
 * @param options - Command options (action, fallback suggestion)
 * @param selector - Selector that was looked for (the cached query's for an index)
 * @returns Failed command result
 */
function failedResultFailure<Req, Res extends ResultPayload>(
  result: Res,
  options: ElementCommandOptions<Req, Res>,
  selector: string
): CommandResult<never> {
  const exitCode =
    result.exitCode ??
    (result.error?.includes('not found')
      ? EXIT_CODES.RESOURCE_NOT_FOUND
      : EXIT_CODES.INVALID_ARGUMENTS);
  const suggestion = result.suggestion ?? options.failureSuggestion;
  return {
    success: false,
    error: result.error ?? `Failed to ${options.action}`,
    exitCode,
    errorContext: {
      suggestion:
        exitCode === EXIT_CODES.RESOURCE_NOT_FOUND
          ? joinLines(suggestion, unreachableElementsNote(selector))
          : suggestion,
    },
  };
}

/**
 * Add the still-loading hint to a "not found" failure while the page has
 * not finished loading (one page evaluation, on this failure path only).
 *
 * @param failure - Failed command result
 * @param selector - Selector that was looked for
 * @returns The failure, with the hint when the page is loading
 */
async function withNotFoundLoadingHint(
  failure: CommandResult<never>,
  selector: string
): Promise<CommandResult<never>> {
  if (failure.exitCode !== EXIT_CODES.RESOURCE_NOT_FOUND) return failure;
  const readyState = await documentReadyState();
  const suggestion = withLoadingHint(failure.errorContext?.suggestion ?? '', readyState, selector);
  return suggestion ? { ...failure, errorContext: { suggestion } } : failure;
}
