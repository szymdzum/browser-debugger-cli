/**
 * A load of the main frame that ended on Chrome's error page or broke off
 * after it committed (#860), read from the page or followed as it happens.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { navigationOutcome, type NavigationOutcome } from '@/connection/navigationOutcome.js';
import { sendTyped, type Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { navigationFailedError } from '@/errors/messages.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import type { FailedLoad } from '@/types.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Where Chrome's error page shows the network error's name (e.g. `ERR_CONNECTION_REFUSED`) */
const ERROR_CODE_EXPRESSION = "document.querySelector('.error-code')?.textContent?.trim() ?? ''";

/** A Chrome network error name, as error pages show it (`ERR_…`, the certificate interstitial `NET::ERR_…`) */
const ERROR_NAME = /^(?:net::)?(ERR_[A-Z0-9_]+)$/i;

/** Shown when the error page does not name its error: Chrome's generic failure */
const UNNAMED_ERROR = 'net::ERR_FAILED';

/**
 * The network error an error page names.
 *
 * @param value - What the page shows as its error code
 * @returns e.g. `net::ERR_CONNECTION_REFUSED`, or {@link UNNAMED_ERROR} for anything else
 */
export function parseErrorCode(value: unknown): string {
  const name = typeof value === 'string' ? ERROR_NAME.exec(value.trim())?.[1] : undefined;
  return name ? `net::${name.toUpperCase()}` : UNNAMED_ERROR;
}

/**
 * The command error of a load that failed: exit 80, as for an unreachable URL.
 *
 * @param failed - The URL and Chrome's network error
 * @param addedScheme - Whether bdg prepended `http://` to the URL as typed
 * @returns Error to throw
 */
export function failedLoadError(failed: FailedLoad, addedScheme = false): CommandError {
  const err = navigationFailedError(failed.url, failed.errorText, addedScheme, failed.redirectedTo);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_URL);
}

/**
 * Classify Chrome's answer to `Page.navigate` and throw when the load failed.
 *
 * @param navigation - Chrome's answer
 * @param url - URL navigated to
 * @param addedScheme - Whether bdg prepended `http://` to the URL as typed
 * @param redirectedTo - Where a redirect led, when its request failed
 * @returns How the navigation ended (all but `failed`)
 * @throws CommandError (80) when the load ends on Chrome's error page
 */
export function assertNavigated(
  navigation: { errorText?: string; loaderId?: string },
  url: string,
  addedScheme = false,
  redirectedTo?: string
): NavigationOutcome {
  const { errorText, loaderId } = navigation;
  const outcome = navigationOutcome(errorText, loaderId);
  if (outcome === 'failed' && errorText) {
    throw failedLoadError({ url, errorText, ...(redirectedTo && { redirectedTo }) }, addedScheme);
  }
  return outcome;
}

/**
 * The main frame and the failed load it shows, if it shows Chrome's error
 * page (its `unreachableUrl`, named by the error page). The certificate
 * interstitial (`NET::ERR_CERT_*`) is returned with `certificate: true`: a
 * success with a warning, as for `Page.navigate`. URLs are as
 * {@link displayUrl} shows them (no user info, tokens masked).
 *
 * @param cdp - CDP connection
 * @returns The main frame's id, and the URL that could not be loaded with its network error
 */
async function readMainFrame(cdp: CDPSender): Promise<{ id: string; failed?: FailedLoad }> {
  const { frame } = (await sendTyped(cdp, 'Page.getFrameTree', {})).frameTree;
  if (!frame.unreachableUrl) return { id: frame.id };
  const shown = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: ERROR_CODE_EXPRESSION,
    returnByValue: true,
  });
  const errorText = parseErrorCode(shown.result?.value);
  const outcome = navigationOutcome(errorText, frame.loaderId);
  if (outcome !== 'failed' && outcome !== 'certificate') return { id: frame.id };
  const failed = { url: displayUrl(frame.unreachableUrl), errorText };
  return {
    id: frame.id,
    failed: outcome === 'certificate' ? { ...failed, certificate: true } : failed,
  };
}

/**
 * The failed load the main frame shows, if it shows Chrome's error page
 * (`certificate: true` for the certificate warning, which is no failure).
 *
 * @param cdp - CDP connection
 * @returns The URL that could not be loaded and its network error, or undefined
 */
export async function readFailedLoad(cdp: CDPSender): Promise<FailedLoad | undefined> {
  return (await readMainFrame(cdp)).failed;
}

/** The fields of `Network.requestWillBeSent` a document watch reads */
interface DocumentRequest {
  requestId: string;
  type?: string;
  frameId?: string;
  request?: { url: string };
}

/**
 * Follow the main frame's document requests and report those that fail
 * (a document's request id is its loader id, so `ERR_ABORTED` of a 204 or a
 * download is no failure).
 *
 * @param cdp - CDP connection
 * @param mainFrameId - Main frame id
 * @param onFailed - Called with a failed document's request id and the failed load
 *   (its URL as requested, and where a redirect led when that request failed)
 * @returns Whether a request is a followed document, a function to forget one, and one to stop
 */
export function watchMainDocuments(
  cdp: Pick<CDPConnection, 'on'>,
  mainFrameId: string,
  onFailed: (requestId: string, failed: FailedLoad) => void
): {
  isDocument: (requestId: string) => boolean;
  forget: (requestId: string) => void;
  stop: () => void;
} {
  const documents = new Map<string, { url: string; last: string }>();
  const stops = [
    cdp.on<DocumentRequest>('Network.requestWillBeSent', (params) => {
      if (params.type !== 'Document' || params.frameId !== mainFrameId) return;
      const last = params.request?.url ?? '';
      documents.set(params.requestId, { url: documents.get(params.requestId)?.url ?? last, last });
    }),
    cdp.on<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', (params) => {
      const document = documents.get(params.requestId);
      if (document === undefined) return;
      documents.delete(params.requestId);
      if (navigationOutcome(params.errorText, params.requestId) !== 'failed') return;
      const { url, last } = document;
      onFailed(params.requestId, {
        url,
        errorText: params.errorText,
        ...(last !== url && { redirectedTo: last }),
      });
    }),
  ];
  return {
    isDocument: (requestId) => documents.has(requestId),
    forget: (requestId) => void documents.delete(requestId),
    stop: () => stops.forEach((stop) => stop()),
  };
}

/**
 * Follow the main frame's loads: the failed load it shows now, then each main
 * document request that fails (a document that answers clears it; Chrome's
 * error page retries the request on its own, so a request alone does not).
 *
 * @param cdp - CDP connection
 * @param onChange - Called with the failed load, or undefined when a new document answers
 * @returns Stops following
 */
export async function trackFailedLoad(
  cdp: CDPConnection,
  onChange: (failed: FailedLoad | undefined) => void
): Promise<() => void> {
  const mainFrame = await readMainFrame(cdp);
  onChange(mainFrame.failed);
  const documents = watchMainDocuments(cdp, mainFrame.id, (_requestId, failed) =>
    onChange({
      ...failed,
      url: displayUrl(failed.url),
      ...(failed.redirectedTo && { redirectedTo: displayUrl(failed.redirectedTo) }),
    })
  );
  const stops = [
    cdp.on<Protocol.Network.ResponseReceivedEvent>('Network.responseReceived', (params) => {
      if (documents.isDocument(params.requestId)) onChange(undefined);
    }),
    cdp.on<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', (params) => {
      documents.forget(params.requestId);
    }),
  ];
  return () => {
    documents.stop();
    stops.forEach((stop) => stop());
  };
}
