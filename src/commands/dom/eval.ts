/**
 * `bdg dom eval` — evaluate a JavaScript expression in the page context, or
 * in one of its iframes with `--frame`.
 *
 * CLI-side handler. Actual evaluation happens in the daemon via the
 * `dom_eval` IPC command so the session's persistent CDP connection is reused.
 */

import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomEvalCommandOptions } from '@/commands/shared/optionTypes.js';
import { emptyScriptError } from '@/errors/messages.js';
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
        return {
          success: false,
          error: response.error ?? 'Failed to evaluate script',
          exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
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
