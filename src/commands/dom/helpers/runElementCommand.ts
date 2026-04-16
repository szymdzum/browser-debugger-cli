/**
 * Shared helper for DOM element commands (fill, click, submit, pressKey).
 *
 * Captures the common flow: resolve selector/index → call IPC → normalize errors.
 * Keeps individual command handlers focused on option wiring and output formatting.
 */

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
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
  buildRequest: (target: { selector: string; index?: number }) => Req;
  /** Invoke the IPC client function. */
  call: (req: Req) => Promise<IpcResponse<Res>>;
  /** Operation label used in fallback error messages (e.g. "fill element"). */
  action: string;
  /** Fallback suggestion when the result reports failure without one. */
  failureSuggestion: string;
  /** Optional per-command exit code mapping based on result.error text. */
  mapExitCode?: (result: Res) => number | undefined;
}

/**
 * Reject inputs that would reach `document.querySelectorAll()` as invalid CSS
 * (e.g. `""`, `"   "`, `"-1"`). Without this guard, the helper script throws
 * SyntaxError inside the browser and the CLI leaks its internal JS source.
 *
 * Numeric indices (`/^\d+$/`) are handled by `DomElementResolver.resolve`
 * against the cached query; anything starting with `-` is neither a valid
 * selector nor a valid 0-based index.
 */
function validateSelectorOrIndex(selectorOrIndex: string): CommandResult<never> | null {
  if (selectorOrIndex.trim() === '') {
    return {
      success: false,
      error: 'selector cannot be empty',
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: 'Pass a CSS selector or a numeric index from bdg dom query',
      },
    };
  }
  if (/^-\d+$/.test(selectorOrIndex)) {
    return {
      success: false,
      error: `index cannot be negative: ${selectorOrIndex}`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: 'Indices are 0-based. Use bdg dom query to see valid indices.',
      },
    };
  }
  return null;
}

/**
 * Resolve an element target, invoke the IPC call, and normalize failures
 * into the structured `CommandRunner` result shape.
 */
export async function runElementCommand<Req, Res extends ResultPayload>(
  options: ElementCommandOptions<Req, Res>
): Promise<CommandResult<Res>> {
  const { selectorOrIndex, index, buildRequest, call, action, failureSuggestion, mapExitCode } =
    options;

  const validation = validateSelectorOrIndex(selectorOrIndex);
  if (validation) return validation;

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
  });

  const response = await call(request);

  if (response.status === 'error' || !response.data) {
    return {
      success: false,
      error: response.error ?? `Failed to ${action}`,
      exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
      ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
    };
  }

  const result = response.data;

  if (!result.success) {
    const mapped = mapExitCode?.(result);
    const exitCode =
      mapped ??
      result.exitCode ??
      (result.error?.includes('not found')
        ? EXIT_CODES.RESOURCE_NOT_FOUND
        : EXIT_CODES.INVALID_ARGUMENTS);

    return {
      success: false,
      error: result.error ?? `Failed to ${action}`,
      exitCode,
      errorContext: { suggestion: result.suggestion ?? failureSuggestion },
    };
  }

  return { success: true, data: result };
}
