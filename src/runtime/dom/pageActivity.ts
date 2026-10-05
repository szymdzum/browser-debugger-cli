/**
 * CDP events a DOM action causes, for its "what changed" report: main-frame
 * navigations (with document statuses), requests and new windows.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Main-frame navigation events seen during the action */
export interface NavigationEvents {
  /** Last new document committed in the main frame */
  document?: { url: string; loaderId: string };
  /** Last same-document URL change of the main frame */
  withinDocumentUrl?: string;
  /** HTTP status of documents by loader */
  statusByLoader: Map<string, number>;
}

/** Live view of the CDP events an action caused */
export interface ActivityListener {
  events: NavigationEvents;
  /** Requests started and windows opened so far */
  activity: () => { requests: number; opened: boolean };
  /** Whether a main-frame load started and has not committed or stopped */
  navigationPending: () => boolean;
  dispose: () => void;
}

/** What the listeners record */
interface ActivityState {
  events: NavigationEvents;
  mainFrame: Set<string>;
  requests: number;
  opened: boolean;
  loading: boolean;
}

/** Page.frameNavigated parameters read here */
interface FrameEvent {
  frame: { id: string; parentId?: string; url: string; urlFragment?: string; loaderId: string };
}

/** Removes a CDP event listener */
type Cleanup = () => void;

/**
 * Listen for the main frame's navigations, document responses, requests
 * and new windows. Events of attached child targets (out-of-process frames,
 * workers) are not main-frame navigations, but their requests count.
 * `Network.enable` is sent without waiting (see `withActionStability`): the
 * session's network collector usually has the domain enabled already.
 *
 * @param cdp - CDP connection
 * @returns Live listener
 */
export function listenForActivity(cdp: CDPConnection): ActivityListener {
  const state: ActivityState = {
    events: { statusByLoader: new Map() },
    mainFrame: new Set(),
    requests: 0,
    opened: false,
    loading: false,
  };
  const cleanups = [
    ...listenForNavigation(cdp, state),
    ...listenForRequests(cdp, state),
    ...listenForWindows(cdp, state),
  ];
  findMainFrame(cdp, state);
  return {
    events: state.events,
    activity: () => ({ requests: state.requests, opened: state.opened }),
    navigationPending: () => state.loading,
    dispose: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

/**
 * Main-frame navigations: new documents, same-document URL changes, and
 * whether a load is pending (started, not committed or stopped yet).
 *
 * @param cdp - CDP connection
 * @param state - State to record into
 * @returns Listener cleanups
 */
function listenForNavigation(cdp: CDPConnection, state: ActivityState): Cleanup[] {
  const isMain = (frameId: string, sessionId?: string): boolean =>
    sessionId === undefined && state.mainFrame.has(frameId);
  return [
    cdp.on<FrameEvent>('Page.frameNavigated', ({ frame }, sessionId) => {
      if (sessionId !== undefined || frame.parentId !== undefined) return;
      state.mainFrame.add(frame.id);
      state.loading = false;
      const url = frame.url + (frame.urlFragment ?? '');
      state.events.document = { url, loaderId: frame.loaderId };
    }),
    cdp.on<{ frameId: string; url: string }>('Page.navigatedWithinDocument', (params, session) => {
      if (isMain(params.frameId, session)) state.events.withinDocumentUrl = params.url;
    }),
    cdp.on<{ frameId: string }>('Page.frameStartedLoading', ({ frameId }, sessionId) => {
      if (isMain(frameId, sessionId)) state.loading = true;
    }),
    cdp.on<{ frameId: string }>('Page.frameStoppedLoading', ({ frameId }, sessionId) => {
      if (isMain(frameId, sessionId)) state.loading = false;
    }),
  ];
}

/**
 * Requests (any target) and the statuses of documents.
 *
 * @param cdp - CDP connection
 * @param state - State to record into
 * @returns Listener cleanups
 */
function listenForRequests(cdp: CDPConnection, state: ActivityState): Cleanup[] {
  void cdp
    .send('Network.enable')
    .catch((error: unknown) => log.debug(`Network.enable failed: ${getErrorMessage(error)}`));
  return [
    cdp.on<{ type?: string; loaderId?: string; response: { status: number } }>(
      'Network.responseReceived',
      ({ type, loaderId, response }) => {
        if (type === 'Document' && loaderId) {
          state.events.statusByLoader.set(loaderId, response.status);
        }
      }
    ),
    cdp.on('Network.requestWillBeSent', () => {
      state.requests++;
    }),
  ];
}

/**
 * New windows, tabs and downloads.
 *
 * @param cdp - CDP connection
 * @param state - State to record into
 * @returns Listener cleanups
 */
function listenForWindows(cdp: CDPConnection, state: ActivityState): Cleanup[] {
  const opened = (): void => {
    state.opened = true;
  };
  return [cdp.on('Page.windowOpen', opened), cdp.on('Page.downloadWillBegin', opened)];
}

/**
 * Learn the main frame's id (until a navigation reports it), without waiting.
 *
 * @param cdp - CDP connection
 * @param state - State to record into
 */
function findMainFrame(cdp: CDPConnection, state: ActivityState): void {
  void cdp
    .send('Page.getFrameTree')
    .then((tree) => {
      const id = (tree as { frameTree?: { frame?: { id?: string } } }).frameTree?.frame?.id;
      if (id) state.mainFrame.add(id);
    })
    .catch((error: unknown) => log.debug(`No frame tree: ${getErrorMessage(error)}`));
}
