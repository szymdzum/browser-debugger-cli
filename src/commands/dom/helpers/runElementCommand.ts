/**
 * Shared helper for DOM element commands (fill, click, submit, pressKey).
 *
 * Captures the common flow: resolve selector/index → call IPC → normalize errors.
 * Keeps individual command handlers focused on option wiring and output formatting.
 */

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { noMatchContext } from '@/commands/dom/helpers/query.js';
import {
  otherIndexSourceNote,
  staleNodeError,
  unreachableElementsNote,
  withLoadingHint,
} from '@/errors/messages.js';
import type { IndexSource } from '@/types.js';
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
  /** The element is not one the command acts on (fill, submit) */
  unsuitableElement?: boolean | undefined;
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
 * into the structured `CommandRunner` result shape. A numeric index names the
 * list it refers to (`indexSource` in the data, and in errors).
 */
export async function runElementCommand<Req, Res extends ResultPayload>(
  options: ElementCommandOptions<Req, Res>
): Promise<CommandResult<Omit<Res, 'success'> & { indexSource?: IndexSource }>> {
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
        : failedResultFailure(response.data, options);
  if (failure && target.source) {
    return indexFailure(failure, target.source, target.preview, response.data);
  }
  if (failure) return withNotFoundContext(failure, target.selector, response.status !== 'error');

  const { success: _success, ...data } = response.data as Res;
  return { success: true, data: { ...data, ...(target.source && { indexSource: target.source }) } };
}

/**
 * A failure on a cached index, told in terms of the index: a stale element
 * (87) names the index and the command that refreshes it, and an element a
 * form command cannot act on, from the results of another command, gets a
 * note on which list the index refers to.
 *
 * @param failure - Failed command result
 * @param source - The index and the list it refers to
 * @param preview - What the cached element was when listed
 * @param result - Action result, when the daemon answered
 * @returns The failure in terms of the index
 */
function indexFailure<Res extends ResultPayload>(
  failure: CommandResult<never>,
  source: IndexSource,
  preview: string | undefined,
  result: Res | undefined
): CommandResult<never> {
  if (failure.exitCode === EXIT_CODES.STALE_CACHE) {
    const err = staleNodeError(source.index, source);
    return {
      success: false,
      error: err.message,
      exitCode: EXIT_CODES.STALE_CACHE,
      errorContext: { suggestion: err.suggestion },
    };
  }
  if (!result?.unsuitableElement || source.command === 'dom form') return failure;
  const note = otherIndexSourceNote(source, preview);
  return {
    ...failure,
    errorContext: { suggestion: joinLines(failure.errorContext?.suggestion, note) },
  };
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
  return {
    success: false,
    error: response.error ?? `Failed to ${options.action}`,
    exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
    ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
  };
}

/**
 * Failure for an action whose page script reported failure.
 *
 * @param result - Action result
 * @param options - Command options (action, fallback suggestion)
 * @returns Failed command result
 */
function failedResultFailure<Req, Res extends ResultPayload>(
  result: Res,
  options: ElementCommandOptions<Req, Res>
): CommandResult<never> {
  const exitCode =
    result.exitCode ??
    (result.error?.includes('not found')
      ? EXIT_CODES.RESOURCE_NOT_FOUND
      : EXIT_CODES.INVALID_ARGUMENTS);
  return {
    success: false,
    error: result.error ?? `Failed to ${options.action}`,
    exitCode,
    errorContext: { suggestion: result.suggestion ?? options.failureSuggestion },
  };
}

/**
 * Add what the page says to a "not found" failure (one page evaluation, on
 * this failure path only, {@link noMatchContext}): similar ids or classes,
 * the places selectors do not search (for a page script that found nothing)
 * and the still-loading hint while the page loads.
 *
 * @param failure - Failed command result
 * @param selector - Selector that was looked for (the cached query's for an index)
 * @param searched - The page script searched the page (the daemon did not fail first)
 * @returns The failure, with the context in its suggestion
 */
async function withNotFoundContext(
  failure: CommandResult<never>,
  selector: string,
  searched: boolean
): Promise<CommandResult<never>> {
  if (failure.exitCode !== EXIT_CODES.RESOURCE_NOT_FOUND) return failure;
  const context = await noMatchContext(selector);
  const note = searched ? unreachableElementsNote(selector, context.unsearched) : '';
  const suggestion = withLoadingHint(
    joinLines(context.similar, failure.errorContext?.suggestion, note ? note : undefined),
    context.readyState,
    selector
  );
  return suggestion ? { ...failure, errorContext: { suggestion } } : failure;
}
