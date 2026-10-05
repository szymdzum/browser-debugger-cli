/**
 * `bdg dom frames` — list the page's iframes (the values `dom eval --frame` accepts).
 *
 * CLI-side handler. Frames are discovered in the daemon via the `dom_frames`
 * IPC command, out-of-process (cross-site) ones included.
 */

import { documentReadyState } from '@/commands/dom/helpers/query.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomFramesCommandOptions } from '@/commands/shared/optionTypes.js';
import { domFrames } from '@/ipc/client.js';
import type { DomFrame } from '@/ipc/protocol/commands.js';
import { formatDomFrames } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom frames`. The list of a page still loading says it may be
 * incomplete (`readyState` in the data): its iframes may not exist yet.
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
      return { success: true, data: await withReadyState(response.data.frames) };
    },
    options,
    formatDomFrames
  );
}

/**
 * The frames, with the page's `readyState` while it is still loading (one
 * page evaluation).
 *
 * @param frames - Frames of the page
 * @returns Frames, and `readyState` unless the page has loaded (or did not answer)
 */
async function withReadyState(
  frames: DomFrame[]
): Promise<{ frames: DomFrame[]; readyState?: string }> {
  const readyState = await documentReadyState();
  return readyState === undefined || readyState === 'complete'
    ? { frames }
    : { frames, readyState };
}
