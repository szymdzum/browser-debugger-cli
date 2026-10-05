/**
 * `bdg dom frames` — list the page's iframes (the values `dom eval --frame` accepts).
 *
 * CLI-side handler. Frames are discovered in the daemon via the `dom_frames`
 * IPC command, out-of-process (cross-site) ones included.
 */

import { documentReadyState } from '@/commands/dom/helpers/query.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomFramesCommandOptions } from '@/commands/shared/optionTypes.js';
import { pageStillLoadingHint } from '@/errors/messages.js';
import { domFrames } from '@/ipc/client.js';
import type { DomFrame } from '@/ipc/protocol/commands.js';
import { formatDomFrames } from '@/ui/formatters/dom.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle `bdg dom frames`. An empty list from a page still loading says so
 * (`readyState` in JSON, a hint otherwise): its iframes may not exist yet.
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
      return framesResult(response.data.frames, options.json === true);
    },
    options,
    formatDomFrames
  );
}

/**
 * The result for a list of frames; an empty one checks whether the page is
 * still loading (one page evaluation, only then).
 *
 * @param frames - Frames of the page
 * @param json - JSON output (the hint is left to the `readyState` field)
 * @returns Command result
 */
async function framesResult(
  frames: DomFrame[],
  json: boolean
): Promise<{ success: true; data: { frames: DomFrame[]; readyState?: string }; hint?: string }> {
  if (frames.length > 0) return { success: true, data: { frames } };
  const readyState = await documentReadyState();
  if (readyState === undefined || readyState === 'complete')
    return { success: true, data: { frames } };
  return {
    success: true,
    data: { frames, readyState },
    ...(!json && { hint: pageStillLoadingHint(readyState) }),
  };
}
