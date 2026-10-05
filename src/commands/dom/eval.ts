/**
 * `bdg dom eval` — evaluate a JavaScript expression in the page context, or
 * in one of its iframes with `--frame`.
 *
 * CLI-side handler. Actual evaluation happens in the daemon via the
 * `dom_eval` IPC command so the session's persistent CDP connection is reused.
 */

import { documentReadyState } from '@/commands/dom/helpers/query.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomEvalCommandOptions } from '@/commands/shared/optionTypes.js';
import { emptyScriptError, withLoadingHint } from '@/errors/messages.js';
import { domEval } from '@/ipc/client.js';
import { formatDomEval } from '@/ui/formatters/dom.js';
import { evalFrameLine } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom eval <script> [--frame <frame>]`. With `--frame`, the
 * frame the script ran in is a `Frame:` line on stderr (JSON: `frame`), so
 * stdout stays the bare value for pipes.
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
      const response = await domEval(script, options.frame);
      if (response.status === 'error' || !response.data) {
        const suggestion = await frameErrorSuggestion(response, options.frame);
        return {
          success: false,
          error: response.error ?? 'Failed to evaluate script',
          exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
          ...(suggestion && { errorContext: { suggestion } }),
        };
      }
      const { value, type, subtype, frame } = response.data;
      return {
        success: true,
        data: {
          result: value,
          type,
          ...(subtype && { subtype }),
          ...(frame !== undefined && { frame }),
        },
        ...(frame !== undefined && !options.json && { hint: evalFrameLine(frame) }),
      };
    },
    options,
    formatDomEval
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
