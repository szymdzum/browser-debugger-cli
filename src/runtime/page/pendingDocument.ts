/**
 * The main frame's document request that no server answered yet, followed
 * from CDP events for the whole session (#893).
 *
 * Chrome holds the page's commands while a navigation waits for the server.
 * `Target.getTargetInfo` shows the pending URL only for a navigation bdg
 * started; after a link click, a form submit or a script's `location.href=`
 * it still shows the old page, and the history has no new entry either. The
 * request itself is the one signal every initiator leaves, and it is read
 * from events because Chrome has no query for it.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { navigationPendingError } from '@/errors/messages.js';
import type { PageAction } from '@/ipc/protocol/commands.js';
import { mainFrameId } from '@/runtime/page/navigation.js';
import { createLogger } from '@/ui/logging/index.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('navigation');

/** The fields of `Network.requestWillBeSent` read here */
interface DocumentRequest {
  requestId: string;
  type?: string;
  frameId?: string;
  request?: { url: string };
}

/** URL of each main-frame document request still waiting for a response, by request id */
let pending = new Map<string, string>();

/** How long to wait for Chrome to answer `Page.stopLoading` (what follows runs anyway) */
const STOP_LOADING_REPLY_MS = 500;

/** A main-frame document request still waiting for a response */
export interface PendingDocument {
  requestId: string;
  /** The URL as Chrome reports it */
  url: string;
}

/**
 * The document request the main frame's navigation still waits for, if
 * any: the latest one, and its latest hop when it was redirected.
 *
 * @returns The request, or undefined when no document request waits
 */
export function pendingDocument(): PendingDocument | undefined {
  const latest = [...pending.entries()].at(-1);
  return latest && { requestId: latest[0], url: latest[1] };
}

/**
 * The URL the main frame's navigation still waits for, if any.
 *
 * @returns The URL as Chrome reports it, or undefined when no document request waits
 */
export function pendingDocumentUrl(): string | undefined {
  return pendingDocument()?.url;
}

/**
 * The error for a command the page cannot answer because a navigation waits
 * for the server.
 *
 * @param url - URL the navigation waits for, as Chrome reports it
 * @returns Error with exit 102 and the URL as other output shows it
 */
export function navigationPendingCommandError(url: string): CommandError {
  const err = navigationPendingError(displayUrl(url));
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
}

/**
 * Cancel the page's navigation with `Page.stopLoading`, waiting at most
 * {@link STOP_LOADING_REPLY_MS} for Chrome's answer. Never throws.
 *
 * @param cdp - CDP connection of the page
 */
export async function stopLoading(cdp: CDPConnection): Promise<void> {
  await cdp
    .send('Page.stopLoading', {}, undefined, AbortSignal.timeout(STOP_LOADING_REPLY_MS))
    .catch((error: unknown) => log.debug(`Page.stopLoading failed: ${getErrorMessage(error)}`));
}

/**
 * Cancel the navigation the main frame waits for, whoever started it (a
 * link click, a form, a script, `bdg page navigate`): while it is pending,
 * Chrome holds the page's commands, so a teardown's would wait for the
 * server too (#946). Does nothing when no document request waits.
 *
 * @param cdp - CDP connection of the page
 */
export async function cancelPendingDocument(cdp: CDPConnection): Promise<void> {
  if (pendingDocument() === undefined) return;
  log.debug('Cancelling the pending navigation');
  await stopLoading(cdp);
}

/**
 * Follow the main frame's document requests on a connection. A new call
 * replaces the previous one (the session follows one page at a time).
 *
 * @param cdp - CDP connection of the session's page
 * @returns Stops following and forgets what was pending
 */
export async function trackPendingDocument(cdp: CDPConnection): Promise<() => void> {
  const own = new Map<string, string>();
  pending = own;
  const mainFrame = await mainFrameId(cdp);
  const forget = (params: { requestId: string }): void => void own.delete(params.requestId);
  const stops = [
    cdp.on<DocumentRequest>('Network.requestWillBeSent', (params) => {
      if (params.type !== 'Document' || params.frameId !== mainFrame) return;
      own.delete(params.requestId);
      own.set(params.requestId, params.request?.url ?? '');
    }),
    cdp.on<{ requestId: string }>('Network.responseReceived', forget),
    cdp.on<{ requestId: string }>('Network.loadingFailed', forget),
  ];
  await cdp
    .send('Network.enable')
    .catch((error: unknown) => log.debug(`Network.enable failed: ${getErrorMessage(error)}`));
  return () => {
    stops.forEach((stop) => stop());
    own.clear();
    if (pending === own) pending = new Map();
  };
}

/**
 * Whether a `page` action replaces a pending navigation, so it cancels it
 * first ({@link cancelPendingDocument}) instead of waiting behind it:
 * `navigate` and `reload` (which then reloads the last page that loaded).
 *
 * @param action - Page action
 * @returns True for `navigate` and `reload`
 */
export function cancelsPendingNavigation(action: PageAction): boolean {
  return action === 'navigate' || action === 'reload';
}
