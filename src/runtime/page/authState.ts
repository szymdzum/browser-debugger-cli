/**
 * Browser auth state of the session: cookies (session and HttpOnly ones
 * included) and the localStorage and sessionStorage of origins, for
 * `bdg state save`, `bdg state load` and `bdg <url> --state`.
 *
 * Storage is read and written with `DOMStorage` by storage key, which needs
 * a frame of that key in the page. Only first-party storage is handled (the
 * key is the origin itself): a cross-site iframe's storage is partitioned
 * under the top-level site (and its frame usually lives in another process),
 * so it is skipped. Before the first navigation of a session
 * ({@link restoreAuthStateBeforeLoad}) the session tab opens a blank
 * document of each saved origin (served by `Fetch`, so nothing reaches the
 * server and no page script runs) to write its storage, so every origin is
 * restored; mid-session ({@link writeAuthState}) only origins the page has
 * frames of are.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import type {
  AuthStateContent,
  OriginStorage,
  SkippedOrigin,
  StateCookie,
  StateSaveData,
  StateSummary,
} from '@/ipc/protocol/stateTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  stateCookiesRefusedError,
  stateOriginNotOnPageError,
} from '@/ui/messages/stateMessages.js';
import { delay } from '@/utils/async.js';
import { httpOrigin, summarizeState } from '@/utils/authStateFormat.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('session');

/** What the functions need of a connection */
type Sender = Pick<CDPConnection, 'send'>;

/** How long a blank document of an origin gets to commit */
const BLANK_DOCUMENT_TIMEOUT_MS = 5000;

/** Pause between checks for the blank document */
const BLANK_DOCUMENT_POLL_MS = 25;

/** The first-party storage keys of the page's frames, by origin */
interface PageStorage {
  /** Storage key (`<origin>/`) per origin with first-party storage */
  keys: Map<string, string>;
  /** Origins of frames whose storage is partitioned */
  partitioned: Set<string>;
}

/**
 * Every frame of a frame tree, top first.
 *
 * @param tree - Frame tree
 * @returns Frames
 */
function framesOf(tree: Protocol.Page.FrameTree): Protocol.Page.Frame[] {
  return [tree.frame, ...(tree.childFrames ?? []).flatMap(framesOf)];
}

/**
 * The storage key of a frame.
 *
 * @param cdp - Connection
 * @param frameId - Frame
 * @param origin - Its origin
 * @returns Storage key (the first-party key when Chrome cannot say)
 */
async function storageKeyOf(cdp: Sender, frameId: string, origin: string): Promise<string> {
  try {
    const { storageKey } = (await cdp.send('Storage.getStorageKeyForFrame', {
      frameId,
    })) as Protocol.Storage.GetStorageKeyForFrameResponse;
    return storageKey;
  } catch (error) {
    log.debug(`Storage key of ${origin} not read: ${getErrorMessage(error)}`);
    return `${origin}/`;
  }
}

/**
 * The origins of the page's frames and their storage keys.
 *
 * @param cdp - Connection
 * @returns First-party keys and partitioned origins
 */
async function pageStorage(cdp: Sender): Promise<PageStorage> {
  const { frameTree } = (await cdp.send('Page.getFrameTree')) as Protocol.Page.GetFrameTreeResponse;
  const keys = new Map<string, string>();
  const partitioned = new Set<string>();
  for (const frame of framesOf(frameTree)) {
    const origin = httpOrigin(frame.securityOrigin);
    if (origin === undefined || keys.has(origin)) continue;
    const key = await storageKeyOf(cdp, frame.id, origin);
    if (key === `${origin}/`) keys.set(origin, key);
    else partitioned.add(origin);
  }
  for (const origin of keys.keys()) partitioned.delete(origin);
  return { keys, partitioned };
}

/**
 * Read one storage area.
 *
 * @param cdp - Connection
 * @param storageKey - Storage key of a frame in the page
 * @param isLocalStorage - localStorage (else sessionStorage)
 * @returns Items by key
 */
async function readItems(
  cdp: Sender,
  storageKey: string,
  isLocalStorage: boolean
): Promise<Record<string, string>> {
  const { entries } = (await cdp.send('DOMStorage.getDOMStorageItems', {
    storageId: { storageKey, isLocalStorage },
  })) as Protocol.DOMStorage.GetDOMStorageItemsResponse;
  return Object.fromEntries(entries.map(([key = '', value = '']) => [key, value]));
}

/**
 * Write items into one storage area (others in it stay).
 *
 * @param cdp - Connection
 * @param storageKey - Storage key of a frame in the page
 * @param isLocalStorage - localStorage (else sessionStorage)
 * @param items - Items by key
 */
async function writeItems(
  cdp: Sender,
  storageKey: string,
  isLocalStorage: boolean,
  items: Record<string, string>
): Promise<void> {
  await Promise.all(
    Object.entries(items).map(([key, value]) =>
      cdp.send('DOMStorage.setDOMStorageItem', {
        storageId: { storageKey, isLocalStorage },
        key,
        value,
      })
    )
  );
}

/**
 * Write the storage of one origin.
 *
 * @param cdp - Connection
 * @param storageKey - Its storage key
 * @param origin - Saved storage
 */
async function writeOrigin(cdp: Sender, storageKey: string, origin: OriginStorage): Promise<void> {
  await writeItems(cdp, storageKey, true, origin.localStorage);
  await writeItems(cdp, storageKey, false, origin.sessionStorage);
}

/**
 * Read the session's cookies and the storage of origins.
 *
 * @param cdp - The session's page connection
 * @param requested - Origins to read (default: every origin of the page's frames)
 * @returns The state, and the frames left out
 * @throws CommandError (83) when a requested origin has no frame in the page
 */
export async function readAuthState(cdp: Sender, requested?: string[]): Promise<StateSaveData> {
  const { cookies } = (await cdp.send('Network.getAllCookies')) as { cookies: StateCookie[] };
  const { keys, partitioned } = await pageStorage(cdp);
  const wanted = requested?.length ? [...new Set(requested)] : [...keys.keys()];
  const missing = wanted.filter((origin) => !keys.has(origin));
  if (requested?.length && missing.length) {
    const err = stateOriginNotOnPageError(missing, [...keys.keys()]);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const origins: OriginStorage[] = [];
  for (const origin of wanted) {
    const key = keys.get(origin) ?? '';
    origins.push({
      origin,
      localStorage: await readItems(cdp, key, true),
      sessionStorage: await readItems(cdp, key, false),
    });
  }
  const skipped: SkippedOrigin[] = requested?.length
    ? []
    : [...partitioned].map((origin) => ({ origin, reason: 'partitioned' as const }));
  return { state: { cookies, origins }, ...(skipped.length && { skipped }) };
}

/**
 * A saved cookie as `Network.setCookies` takes it: a session cookie stays
 * one (no expiry), fields Chrome does not take are left out.
 *
 * @param cookie - Saved cookie
 * @returns Cookie parameter
 */
export function cookieParam(cookie: StateCookie): Protocol.Network.CookieParam {
  const persistent = !cookie.session && typeof cookie.expires === 'number' && cookie.expires > 0;
  const partitionKey =
    typeof cookie.partitionKey === 'object' && cookie.partitionKey !== null
      ? cookie.partitionKey
      : undefined;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    ...filterDefined({
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      priority: cookie.priority,
      sourceScheme: cookie.sourceScheme,
      sourcePort: cookie.sourcePort,
      partitionKey,
      expires: persistent ? cookie.expires : undefined,
    }),
  };
}

/**
 * Whether a saved cookie has expired since it was saved.
 *
 * @param cookie - Saved cookie
 * @param nowSeconds - Now, in seconds since the epoch
 * @returns True for a persistent cookie past its expiry
 */
function hasExpired(cookie: StateCookie, nowSeconds: number): boolean {
  return !cookie.session && typeof cookie.expires === 'number' && cookie.expires > 0
    ? cookie.expires <= nowSeconds
    : false;
}

/**
 * Set the saved cookies that have not expired.
 *
 * @param cdp - Connection
 * @param cookies - Saved cookies
 * @returns How many were set
 * @throws CommandError (81) when Chrome refuses them
 */
async function setCookies(cdp: Sender, cookies: StateCookie[]): Promise<number> {
  const now = Date.now() / 1000;
  const valid = cookies.filter((cookie) => !hasExpired(cookie, now));
  if (valid.length === 0) return 0;
  try {
    await cdp.send('Network.setCookies', { cookies: valid.map(cookieParam) });
  } catch (error) {
    const err = stateCookiesRefusedError(getErrorMessage(error));
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return valid.length;
}

/**
 * Whether an origin has storage items to restore.
 *
 * @param origin - Saved storage
 * @returns True when it has any
 */
function hasItems(origin: OriginStorage): boolean {
  return (
    Object.keys(origin.localStorage).length > 0 || Object.keys(origin.sessionStorage).length > 0
  );
}

/**
 * Restore cookies, and the storage of the origins the page has frames of.
 *
 * @param cdp - The session's page connection
 * @param state - Saved state
 * @returns What was restored, and the origins left out
 * @throws CommandError (81) when Chrome refuses the cookies
 */
export async function writeAuthState(cdp: Sender, state: AuthStateContent): Promise<StateSummary> {
  const cookies = await setCookies(cdp, state.cookies);
  const { keys, partitioned } = await pageStorage(cdp);
  const restored: OriginStorage[] = [];
  const skipped: SkippedOrigin[] = [];
  for (const origin of state.origins) {
    const key = keys.get(origin.origin);
    if (key === undefined) {
      const reason = partitioned.has(origin.origin) ? 'partitioned' : 'not-on-page';
      if (hasItems(origin)) skipped.push({ origin: origin.origin, reason });
      continue;
    }
    await writeOrigin(cdp, key, origin);
    restored.push(origin);
  }
  return { ...summarizeState({ cookies: [], origins: restored }, skipped), cookies };
}

/**
 * Answer the tab's requests while storage is restored: documents get an
 * empty page, everything else fails, so nothing reaches a server.
 *
 * @param cdp - The session's page connection
 * @returns Stops answering
 */
async function serveBlankDocuments(cdp: CDPConnection): Promise<() => Promise<void>> {
  const off = cdp.on<{ requestId: string; resourceType: string }>(
    'Fetch.requestPaused',
    ({ requestId, resourceType }, sessionId) => {
      if (sessionId !== undefined) return;
      const reply =
        resourceType === 'Document'
          ? cdp.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
              body: '',
            })
          : cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
      reply.catch((error: unknown) => log.debug(`Request not answered: ${getErrorMessage(error)}`));
    }
  );
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return async () => {
    off();
    for (const [method, params] of [
      ['Fetch.disable', {}],
      ['Network.setBypassServiceWorker', { bypass: false }],
      ['Network.disable', {}],
    ] as const) {
      await cdp
        .send(method, params)
        .catch((error: unknown) => log.debug(`${method} failed: ${getErrorMessage(error)}`));
    }
  };
}

/**
 * Navigate the session tab and wait until the top frame shows the new document.
 *
 * @param cdp - The session's page connection
 * @param url - URL to load
 * @param loaded - Whether the top frame is the new document
 * @throws Error when the navigation fails or does not commit in time
 */
async function navigateTab(
  cdp: Sender,
  url: string,
  loaded: (frame: Protocol.Page.Frame) => boolean
): Promise<void> {
  const { errorText } = (await cdp.send('Page.navigate', {
    url,
  })) as Protocol.Page.NavigateResponse;
  if (errorText) throw new Error(`Could not open ${url} to restore its storage: ${errorText}`);
  const deadline = Date.now() + BLANK_DOCUMENT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { frameTree } = (await cdp.send(
      'Page.getFrameTree'
    )) as Protocol.Page.GetFrameTreeResponse;
    if (loaded(frameTree.frame)) return;
    await delay(BLANK_DOCUMENT_POLL_MS);
  }
  throw new Error(`Could not open ${url} to restore its storage: the page did not change`);
}

/**
 * Restore a saved state into a session whose tab has not loaded its page
 * yet: cookies, then each origin's storage through a blank document of it
 * in the tab (sessionStorage belongs to the tab, so it survives the
 * navigation to the target), then back to about:blank with the history
 * cleared.
 *
 * @param cdp - The session's page connection, before collectors start
 * @param state - Saved state
 * @returns What was restored
 * @throws CommandError (81) when Chrome refuses the cookies; Error when an origin cannot be opened
 */
export async function restoreAuthStateBeforeLoad(
  cdp: CDPConnection,
  state: AuthStateContent
): Promise<StateSummary> {
  const cookies = await setCookies(cdp, state.cookies);
  const origins = state.origins.filter(hasItems);
  if (origins.length > 0) {
    const stop = await serveBlankDocuments(cdp);
    try {
      for (const origin of origins) {
        await navigateTab(
          cdp,
          `${origin.origin}/`,
          (frame) => frame.securityOrigin === origin.origin
        );
        await writeOrigin(cdp, `${origin.origin}/`, origin);
      }
    } finally {
      await stop();
    }
    await navigateTab(cdp, 'about:blank', (frame) => frame.url === 'about:blank');
    await cdp
      .send('Page.resetNavigationHistory')
      .catch((error: unknown) => log.debug(`History not cleared: ${getErrorMessage(error)}`));
  }
  return { ...summarizeState({ cookies: [], origins }), cookies };
}
