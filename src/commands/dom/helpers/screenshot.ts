/**
 * Screenshot capture for `bdg dom screenshot`: the daemon measures, captures
 * and puts back the page's emulation (`dom_screenshot`); this writes the image
 * it returns.
 */

import { writeOutputFile } from '@/commands/shared/outputFile.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import { domScreenshot } from '@/ipc/client.js';
import type { DomScreenshotCommand } from '@/ipc/protocol/commands.js';
import type { ScreenshotResult } from '@/types.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Capture the page (or the element `backendNodeId` names) and write the
 * image.
 *
 * @param outputPath - File to write
 * @param request - What to capture and how
 * @returns What was captured, with the file's absolute path
 * @throws CommandError with the daemon's error (Chrome's, when the capture
 *   failed) and exit code
 */
export async function captureScreenshot(
  outputPath: string,
  request: DomScreenshotCommand
): Promise<ScreenshotResult> {
  const response = await domScreenshot(request);
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
