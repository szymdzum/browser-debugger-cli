/**
 * `bdg dom eval` — evaluate a JavaScript expression in the page context.
 *
 * CLI-side handler. Actual evaluation happens in the worker via the
 * `dom_eval` IPC command so the worker's persistent CDP connection is reused.
 */

import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomEvalCommandOptions } from '@/commands/shared/optionTypes.js';
import { domEval } from '@/ipc/client.js';
import { formatDomEval } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom eval <script>`.
 */
export async function handleDomEval(script: string, options: DomEvalCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const response = await domEval(script);
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? 'Failed to evaluate script',
          exitCode: EXIT_CODES.CDP_CONNECTION_FAILURE,
        };
      }
      return { success: true, data: { result: response.data.value } };
    },
    options,
    formatDomEval
  );
}
