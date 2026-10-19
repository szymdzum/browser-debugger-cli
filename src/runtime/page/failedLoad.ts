/**
 * A load of the main frame that ended on Chrome's error page or broke off
 * after it committed (#860), read from the page or followed as it happens.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { navigationOutcome } from '@/connection/navigationOutcome.js';
import { sendTyped, type Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { navigationFailedError } from '@/errors/messages.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import type { FailedLoad } from '@/types.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Where Chrome's error page shows the network error's name (e.g. `ERR_CONNECTION_REFUSED`) */
const ERROR_CODE_EXPRESSION = "document.querySelector('.error-code')?.textContent?.trim() ?? ''";

/** A Chrome network error name */
const ERROR_NAME = /^ERR_[A-Z0-9_]+$/;

/** Shown when the error page does not name its error: Chrome's generic failure */
const UNNAMED_ERROR = 'net::ERR_FAILED';

/**
 * The command error of a load that failed: exit 80, as for an unreachable URL.
 *
 * @param failed - The URL and Chrome's network error
 * @param addedScheme - Whether bdg prepended `http://` to the URL as typed
 * @returns Error to throw
 */
export function failedLoadError(failed: FailedLoad, addedScheme = false): CommandError {
  const err = navigationFailedError(failed.url, failed.errorText, addedScheme);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_URL);
}

/**
 * The failed load the main frame shows, if it shows Chrome's error page.
 * URLs are as {@link displayUrl} shows them (no user info, tokens masked).
 *
 * @param cdp - CDP connection
 * @returns The URL that could not be loaded and its network error, or undefined
 */
export async function readFailedLoad(cdp: CDPSender): Promise<FailedLoad | undefined> {
  const { frameTree } = await sendTyped(cdp, 'Page.getFrameTree', {});
  return failedLoadOf(cdp, frameTree.frame);
}

/**
 * The failed load a frame shows: its `unreachableUrl`, named by its error page.
 *
 * @param cdp - CDP connection
 * @param frame - The main frame
 * @returns The failed load, or undefined when the frame shows a document
 */
async function failedLoadOf(
  cdp: CDPSender,
  frame: Protocol.Page.Frame
): Promise<FailedLoad | undefined> {
  if (!frame.unreachableUrl) return undefined;
  const shown = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: ERROR_CODE_EXPRESSION,
    returnByValue: true,
  });
  const name: unknown = shown.result?.value;
  const errorText =
    typeof name === 'string' && ERROR_NAME.test(name) ? `net::${name}` : UNNAMED_ERROR;
  return { url: displayUrl(frame.unreachableUrl), errorText };
}

/**
 * Follow the main frame's loads: the failed load it shows now, then each main
 * document request that fails (a document that answers clears it; Chrome's
 * error page retries the request on its own, so a request alone does not). A document's request id
 * is its loader id, so `ERR_ABORTED` of a 204 or a download counts as no failure.
 *
 * @param cdp - CDP connection
 * @param onChange - Called with the failed load, or undefined when a new document answers
 * @returns Stops following
 */
export async function trackFailedLoad(
  cdp: CDPConnection,
  onChange: (failed: FailedLoad | undefined) => void
): Promise<() => void> {
  const { frameTree } = await sendTyped(cdp, 'Page.getFrameTree', {});
  const mainFrameId = frameTree.frame.id;
  onChange(await failedLoadOf(cdp, frameTree.frame));
  const documents = new Map<string, string>();
  const stops = [
    cdp.on<Protocol.Network.RequestWillBeSentEvent>('Network.requestWillBeSent', (params) => {
      if (params.type !== 'Document' || params.frameId !== mainFrameId) return;
      documents.set(params.requestId, params.request.url);
    }),
    cdp.on<Protocol.Network.ResponseReceivedEvent>('Network.responseReceived', (params) => {
      if (documents.has(params.requestId)) onChange(undefined);
    }),
    cdp.on<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', (params) => {
      documents.delete(params.requestId);
    }),
    cdp.on<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', (params) => {
      const url = documents.get(params.requestId);
      if (url === undefined) return;
      documents.delete(params.requestId);
      if (navigationOutcome(params.errorText, params.requestId) === 'failed') {
        onChange({ url: displayUrl(url), errorText: params.errorText });
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
