/**
 * `bdg dom frames` — list the page's iframes (the values `dom eval --frame` accepts).
 *
 * CLI-side handler. Frames are discovered in the daemon via the `dom_frames`
 * IPC command, out-of-process (cross-site) ones included.
 */

import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomFramesCommandOptions } from '@/commands/shared/optionTypes.js';
import { domFrames } from '@/ipc/client.js';
import { formatDomFrames } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom frames`.
 */
export async function handleDomFrames(options: DomFramesCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const response = await domFrames();
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? 'Failed to list frames',
          exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
        };
      }
      return { success: true, data: { frames: response.data.frames } };
    },
    options,
    formatDomFrames
  );
}
