/**
 * Shared helper for DOM element commands (fill, click, submit, pressKey).
 *
 * Captures the common flow: resolve selector/index → call IPC → normalize errors.
 * Keeps individual command handlers focused on option wiring and output formatting.
 */

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { UNREACHABLE_ELEMENTS_HINT, staleNodeError } from '@/errors/messages.js';
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
  const { selectorOrIndex, index, buildRequest, call, action, failureSuggestion } = options;

  const target = await DomElementResolver.getInstance().resolve(selectorOrIndex, index);

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

  if (response.status === 'error' || !response.data) {
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

  const result = response.data;

  if (!result.success) {
    const exitCode =
      result.exitCode ??
      (result.error?.includes('not found')
        ? EXIT_CODES.RESOURCE_NOT_FOUND
        : EXIT_CODES.INVALID_ARGUMENTS);

    const suggestion = result.suggestion ?? failureSuggestion;
    return {
      success: false,
      error: result.error ?? `Failed to ${action}`,
      exitCode,
      errorContext: {
        suggestion:
          exitCode === EXIT_CODES.RESOURCE_NOT_FOUND
            ? `${suggestion} (${UNREACHABLE_ELEMENTS_HINT})`
            : suggestion,
      },
    };
  }

  const { success: _success, ...data } = result;
  return { success: true, data };
}
