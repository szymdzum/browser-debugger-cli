/**
 * `bdg dom eval` — evaluate a JavaScript expression in the page context, or
 * in one of its iframes with `--frame`.
 *
 * CLI-side handler. Actual evaluation happens in the daemon via the
 * `dom_eval` IPC command so the session's persistent CDP connection is reused.
 */

import { boundEvalResult } from '@/commands/dom/helpers/evalResult.js';
import { documentReadyState } from '@/commands/dom/helpers/query.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomEvalCommandOptions } from '@/commands/shared/optionTypes.js';
import { emptyScriptError, withLoadingHint } from '@/errors/messages.js';
import { domEval } from '@/ipc/client.js';
import { formatDomEval } from '@/ui/formatters/dom.js';
import { evalFrameLine, warningMessage } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom eval <script> [--frame <frame>]`. With `--frame`, the
 * frame the script ran in is a `Frame:` line on stderr (JSON: `frame`), and
 * a warning about how the result was copied goes there too (JSON:
 * `warning`), so stdout stays the bare value for pipes. Long values are cut
 * unless `--full`: human output when formatted, JSON results by
 * {@link boundEvalResult}.
 */
export async function handleDomEval(script: string, options: DomEvalCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      if (!script.trim()) {
        const err = emptyScriptError();
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.INVALID_ARGUMENTS,
          errorContext: { suggestion: err.suggestion },
        };
      }
      const response = await domEval(script, options.frame, options.full);
      if (response.status === 'error' || !response.data) {
        const suggestion = await frameErrorSuggestion(response, options.frame);
        return {
          success: false,
          error: response.error ?? 'Failed to evaluate script',
          exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
          ...(suggestion && { errorContext: { suggestion } }),
        };
      }
      const { value, type, subtype, length, frame, warning } = response.data;
      const hint = [
        ...(frame !== undefined ? [evalFrameLine(frame)] : []),
        ...(warning ? [warningMessage(warning)] : []),
      ].join('\n');
      return {
        success: true,
        data: {
          ...(options.json && !options.full ? boundEvalResult(value, length) : { result: value }),
          type,
          ...(subtype && { subtype }),
          ...(frame !== undefined && { frame }),
          ...(warning && { warning }),
        },
        ...(hint && !options.json && { hint }),
      };
    },
    options,
    (data) => formatDomEval(data, { full: options.full })
  );
}

/**
 * Suggestion of a failed eval; a frame not found (83) while the page is
 * still loading says so (its iframes may not exist yet).
 *
 * @param response - Error response
 * @param frame - The --frame given, if any
 * @returns Suggestion, if any
 */
async function frameErrorSuggestion(
  response: { exitCode?: number; suggestion?: string },
  frame: string | undefined
): Promise<string | undefined> {
  if (frame === undefined || response.exitCode !== EXIT_CODES.RESOURCE_NOT_FOUND) {
    return response.suggestion;
  }
  return withLoadingHint(response.suggestion ?? '', await documentReadyState()) || undefined;
}
