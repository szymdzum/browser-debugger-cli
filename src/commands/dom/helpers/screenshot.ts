/**
 * Screenshot capture for `bdg dom screenshot`: the daemon measures, captures
 * and puts back the page's emulation (`dom_screenshot`); this writes the image
 * it returns.
 */

import { interruptExitCode, interruptSignal } from '@/commands/shared/interrupt.js';
import { writeOutputFile } from '@/commands/shared/outputFile.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError, screenshotInterruptedError } from '@/errors/messages.js';
import { domScreenshot } from '@/ipc/client.js';
import type { DomScreenshotCommand } from '@/ipc/protocol/commands.js';
import type { ScreenshotResult } from '@/types.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * The error of a screenshot interrupted by Ctrl-C or SIGTERM.
 *
 * @param interrupt - Aborted interrupt (reason: the signal)
 * @returns Command error (exit 130, or 143 for SIGTERM)
 */
function interruptedError(interrupt: AbortSignal): CommandError {
  const signal = interruptSignal(interrupt);
  const err = screenshotInterruptedError(signal);
  return new CommandError(err.message, { suggestion: err.suggestion }, interruptExitCode(signal));
}

/**
 * Ask the daemon for the capture. An interrupt closes the connection: the
 * daemon skips the capture if it has not started, and puts the emulation
 * back before it runs any later page command, so this need not wait.
 *
 * @param request - What to capture and how
 * @param interrupt - Aborted on Ctrl-C or SIGTERM
 * @returns The daemon's response
 * @throws CommandError (130/143) once interrupted
 */
async function requestCapture(
  request: DomScreenshotCommand,
  interrupt: AbortSignal | undefined
): Promise<Awaited<ReturnType<typeof domScreenshot>>> {
  try {
    const response = await domScreenshot(request, interrupt);
    if (interrupt?.aborted) throw interruptedError(interrupt);
    return response;
  } catch (error) {
    if (interrupt?.aborted) throw interruptedError(interrupt);
    throw error;
  }
}

/**
 * Capture the page (or the element `backendNodeId` names) and write the
 * image.
 *
 * @param outputPath - File to write
 * @param request - What to capture and how
 * @param interrupt - Aborted on Ctrl-C or SIGTERM: the capture is cancelled
 * @returns What was captured, with the file's absolute path
 * @throws CommandError with the daemon's error (Chrome's, when the capture
 *   failed) and exit code, or 130/143 when interrupted
 */
export async function captureScreenshot(
  outputPath: string,
  request: DomScreenshotCommand,
  interrupt?: AbortSignal
): Promise<ScreenshotResult> {
  const response = await requestCapture(request, interrupt);
  if (response.status === 'error' || !response.data) {
    const fallback = operationFailedError(
      'take the screenshot',
      `Check the session: ${sessionCommand('bdg status')}`
    );
    const suggestion = response.error === undefined ? fallback.suggestion : response.suggestion;
    throw new CommandError(
      response.error ?? fallback.message,
      suggestion ? { suggestion } : {},
      response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }
  const path = await writeOutputFile(outputPath, Buffer.from(response.data.image, 'base64'));
  return { path, ...response.data.screenshot };
}
