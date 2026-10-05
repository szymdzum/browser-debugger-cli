/**
 * Iframes of the page for `bdg dom frames` and `bdg dom eval --frame`.
 *
 * Works on a short-lived second connection to the page target, so enabling
 * Runtime (which replays the page's console messages) and attaching to
 * out-of-process iframes never reach the session's collectors. In-process
 * frames come from the page's frame tree; out-of-process (cross-site) frames
 * from flattened auto-attach, each with its own session and frame tree.
 * Execution context ids are shared by all sessions of a renderer, so a
 * frame's default (main-world) context is found by enabling Runtime.
 *
 * A frame kept busy by its own scripts is recovered through the session's
 * connection: a session attached while the target is busy gets no answer at
 * all, not even to `Runtime.terminateExecution`.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { CommandError } from '@/errors/index.js';
import {
  frameLostDuringEvalError,
  frameNavigatedDuringEvalError,
  frameNotReadyError,
  frameRemovedDuringEvalError,
  pageClosedDuringEvalError,
} from '@/errors/messages.js';
import type { DomEvalData, DomFrame } from '@/ipc/protocol/commands.js';
import {
  evaluateScript,
  isContextLostError,
  pageStillOpen,
  settledWithin,
  withBusyPageRecovery,
} from '@/runtime/dom/evalHelpers.js';
import { effectiveFrameOrigin, isCrossOrigin } from '@/runtime/dom/frameOrigin.js';
import { frameError, selectFrame } from '@/runtime/dom/frameSelection.js';
import { attachedSessionOf } from '@/telemetry/attachedTargets.js';
import { senderFor, type CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** Auto-attach without pausing new targets: only existing frames are needed */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

/** The second connection, and the session's own one for recovering busy targets */
interface FrameConnection {
  conn: CDPConnection;
  page: CDPConnection;
  /** Target id of each session attached on `conn` */
  targets: Map<string, string>;
}

/** The default (main-world) execution context of a frame */
interface FrameContext {
  /** `ExecutionContextDescription.uniqueId` */
  uniqueId: string;
  /** Origin its scripts run with (`"://"` when opaque) */
  origin: string;
}

/** A frame tree, the session it was read from (undefined: the page) and its frames' contexts */
interface SessionTree {
  tree: Protocol.Page.FrameTree;
  sessionId?: string;
  /** Default context of each frame, by frame id */
  contexts: Map<string, FrameContext>;
}

/** A frame with the session that owns it */
interface FrameNode {
  frame: Protocol.Page.Frame;
  sessionId?: string;
  context?: FrameContext;
}

/** A listed iframe plus what is needed to run a script in it */
interface LocatedFrame {
  info: DomFrame;
  frameId: string;
  sessionId?: string;
  /** Session of the parent frame, which owns the iframe element */
  ownerSession?: string;
  context?: FrameContext;
}

/** Attributes of an iframe element that matter for listing */
interface OwnerAttributes {
  name?: string;
  id?: string;
  /** `sandbox` attribute ('' when present without tokens) */
  sandbox?: string;
}

/**
 * Run `work` on a second connection to the page, closed afterwards.
 *
 * @param page - The session's connection
 * @param wsUrl - WebSocket URL of the page target
 * @param work - What to do with the connection
 * @returns The work's result
 */
async function withFrameConnection<T>(
  page: CDPConnection,
  wsUrl: string,
  work: (fc: FrameConnection) => Promise<T>
): Promise<T> {
  const conn = await CDPConnection.create(wsUrl, { maxRetries: 1, logger: log });
  try {
    return await work({ conn, page, targets: new Map() });
  } finally {
    conn.close();
  }
}

/**
 * Where to check and recover a session's target when it does not answer:
 * the session's connection (page, or its attached session for the target).
 *
 * @param fc - Frame connection
 * @param sessionId - Session on the second connection, undefined for the page
 * @returns Sender to the same target
 */
function recoverySender(fc: FrameConnection, sessionId?: string): CDPSender {
  if (!sessionId) return fc.page;
  const targetId = fc.targets.get(sessionId);
  const attached = targetId === undefined ? undefined : attachedSessionOf(fc.page, targetId);
  return senderFor(attached ? fc.page : fc.conn, attached ?? sessionId);
}

/**
 * Send a command to one session, recovering its target when its scripts
 * keep it busy.
 *
 * @param fc - Frame connection
 * @param method - CDP method
 * @param params - Parameters
 * @param sessionId - Session, undefined for the page
 * @returns The result
 * @throws CommandError (102) when the target was busy
 */
async function sendToSession<T>(
  fc: FrameConnection,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<T> {
  const command = fc.conn.send(method, params, sessionId);
  const scope = sessionId === undefined ? 'page' : 'frame';
  return (await withBusyPageRecovery(recoverySender(fc, sessionId), command, { scope })) as T;
}

/**
 * Default execution contexts of a session's frames, reported when Runtime is
 * enabled.
 *
 * @param fc - Frame connection
 * @param sessionId - Session, undefined for the page
 * @returns Context of each frame, by frame id
 */
async function defaultContexts(
  fc: FrameConnection,
  sessionId?: string
): Promise<Map<string, FrameContext>> {
  const contexts = new Map<string, FrameContext>();
  const stop = fc.conn.on<Protocol.Runtime.ExecutionContextCreatedEvent>(
    'Runtime.executionContextCreated',
    ({ context }, eventSession) => {
      const auxData = (context.auxData ?? {}) as Record<string, unknown>;
      const frameId = auxData['frameId'];
      if (eventSession !== sessionId || !auxData['isDefault'] || typeof frameId !== 'string')
        return;
      contexts.set(frameId, { uniqueId: context.uniqueId, origin: context.origin });
    }
  );
  try {
    await sendToSession(fc, 'Runtime.enable', {}, sessionId);
  } finally {
    stop();
  }
  return contexts;
}

/**
 * Frame tree of a session and the default contexts of its frames.
 *
 * @param fc - Frame connection
 * @param sessionId - Session, undefined for the page
 * @returns The tree
 */
async function readSession(fc: FrameConnection, sessionId?: string): Promise<SessionTree> {
  const contexts = await defaultContexts(fc, sessionId);
  const { frameTree: tree } = await sendToSession<Protocol.Page.GetFrameTreeResponse>(
    fc,
    'Page.getFrameTree',
    {},
    sessionId
  );
  return { tree, contexts, ...(sessionId && { sessionId }) };
}

/**
 * Attach to the out-of-process iframes directly below a session. Chrome
 * reports the existing ones before answering `Target.setAutoAttach`.
 *
 * @param fc - Frame connection (records each session's target)
 * @param parentSession - Session to attach below, undefined for the page
 * @returns Their sessions
 */
async function attachChildFrames(fc: FrameConnection, parentSession?: string): Promise<string[]> {
  const sessions: string[] = [];
  const stop = fc.conn.on<Protocol.Target.AttachedToTargetEvent>(
    'Target.attachedToTarget',
    ({ sessionId, targetInfo }, eventSession) => {
      if (eventSession !== parentSession || targetInfo.type !== 'iframe') return;
      fc.targets.set(sessionId, targetInfo.targetId);
      sessions.push(sessionId);
    }
  );
  try {
    await fc.conn.send('Target.setAutoAttach', AUTO_ATTACH, parentSession);
  } finally {
    stop();
  }
  return sessions;
}

/**
 * Frame trees of the out-of-process iframes below a session, nested ones included.
 *
 * @param fc - Frame connection
 * @param parentSession - Session to attach below, undefined for the page
 * @returns Their trees
 */
async function outOfProcessTrees(
  fc: FrameConnection,
  parentSession?: string
): Promise<SessionTree[]> {
  const sessions = await attachChildFrames(fc, parentSession);
  const nested = await Promise.all(sessions.map((sessionId) => childSessionTrees(fc, sessionId)));
  return nested.flat();
}

/**
 * Trees of an out-of-process iframe and the ones nested in it. A frame
 * removed while the page is being listed (its session is gone) is skipped.
 *
 * @param fc - Frame connection
 * @param sessionId - The iframe's session
 * @returns Its tree and the nested ones, or none when it went away
 */
async function childSessionTrees(fc: FrameConnection, sessionId: string): Promise<SessionTree[]> {
  try {
    return [await readSession(fc, sessionId), ...(await outOfProcessTrees(fc, sessionId))];
  } catch (error) {
    if (!(error instanceof CDPProtocolError)) throw error;
    log.debug(`Frame session ${sessionId} went away while listing: ${error.message}`);
    return [];
  }
}

/**
 * All frames of the trees, each with its session and default context.
 *
 * @param trees - Frame trees
 * @returns Frames in tree order
 */
function flattenTrees(trees: SessionTree[]): FrameNode[] {
  const nodes: FrameNode[] = [];
  const walk = (tree: Protocol.Page.FrameTree, owner: SessionTree): void => {
    const context = owner.contexts.get(tree.frame.id);
    nodes.push({
      frame: tree.frame,
      ...(owner.sessionId && { sessionId: owner.sessionId }),
      ...(context && { context }),
    });
    tree.childFrames?.forEach((child) => walk(child, owner));
  };
  trees.forEach((owner) => walk(owner.tree, owner));
  return nodes;
}

/**
 * Iframes below the main frame, depth-first.
 *
 * @param nodes - All frames
 * @param mainFrameId - The page's main frame
 * @returns Iframes in listing order
 */
function iframesInOrder(nodes: FrameNode[], mainFrameId: string): FrameNode[] {
  const ordered: FrameNode[] = [];
  const visit = (parentId: string): void => {
    for (const node of nodes.filter((n) => n.frame.parentId === parentId)) {
      ordered.push(node);
      visit(node.frame.id);
    }
  };
  visit(mainFrameId);
  return ordered;
}

/**
 * Value of an attribute in CDP's flat `[name, value, name, value, ...]` list.
 *
 * @param attributes - Attribute list
 * @param key - Attribute name
 * @returns Its value, undefined when missing
 */
function attributeValue(attributes: string[] = [], key: string): string | undefined {
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === key) return attributes[i + 1];
  }
  return undefined;
}

/**
 * Attributes of the iframe element of a frame (read in its parent's session).
 *
 * @param fc - Frame connection
 * @param frameId - Frame
 * @param ownerSession - Session of the parent frame
 * @returns `name`, `id` and `sandbox` attributes when set
 */
async function ownerAttributes(
  fc: FrameConnection,
  frameId: string,
  ownerSession?: string
): Promise<OwnerAttributes> {
  try {
    const { backendNodeId } = await sendToSession<Protocol.DOM.GetFrameOwnerResponse>(
      fc,
      'DOM.getFrameOwner',
      { frameId },
      ownerSession
    );
    const { node } = await sendToSession<Protocol.DOM.DescribeNodeResponse>(
      fc,
      'DOM.describeNode',
      { backendNodeId },
      ownerSession
    );
    const name = attributeValue(node.attributes, 'name');
    const id = attributeValue(node.attributes, 'id');
    const sandbox = attributeValue(node.attributes, 'sandbox');
    return { ...(name && { name }), ...(id && { id }), ...(sandbox !== undefined && { sandbox }) };
  } catch (error) {
    log.debug(`No iframe element for frame ${frameId}: ${getErrorMessage(error)}`);
    return {};
  }
}

/** What describing a frame needs to know about the frames listed before it */
interface ListingState {
  /** The page's effective origin */
  topOrigin: string;
  /** Effective origin of each frame listed so far (and the main frame), by id */
  originOf: Map<string, string>;
  /** Index of each frame listed so far, by id */
  indexOf: Map<string, number>;
  /** Session of each frame, by id */
  sessionOf: Map<string, string | undefined>;
}

/**
 * Where a frame sits in the listing: its origin, and the index of its parent.
 * Parents are placed before their children, so a child can inherit its
 * parent's origin.
 *
 * @param node - The frame
 * @param index - Its position
 * @param owner - Attributes of its iframe element
 * @param state - Frames placed so far (updated)
 * @returns Origin and parent index
 */
function placeFrame(
  node: FrameNode,
  index: number,
  owner: OwnerAttributes,
  state: ListingState
): { origin: string; parentIndex?: number } {
  const { frame, context } = node;
  const parentId = frame.parentId ?? '';
  const origin = effectiveFrameOrigin({
    url: frame.url,
    securityOrigin: frame.securityOrigin,
    contextOrigin: context?.origin,
    parentOrigin: state.originOf.get(parentId),
    sandbox: owner.sandbox,
  });
  const parentIndex = state.indexOf.get(parentId);
  state.originOf.set(frame.id, origin);
  state.indexOf.set(frame.id, index);
  return { origin, ...(parentIndex !== undefined && { parentIndex }) };
}

/**
 * Describe an iframe for listing. Chrome names a frame after its element's
 * `id` when it has no `name`, so such a name is not repeated.
 *
 * @param node - The frame
 * @param index - Its position
 * @param owner - Attributes of its iframe element
 * @param state - Frames described so far (updated)
 * @returns The located frame
 */
function describeFrame(
  node: FrameNode,
  index: number,
  owner: OwnerAttributes,
  state: ListingState
): LocatedFrame {
  const { frame, sessionId, context } = node;
  const name = owner.name ?? (frame.name === owner.id ? undefined : frame.name);
  const { origin, parentIndex } = placeFrame(node, index, owner, state);
  const info: DomFrame = {
    index,
    url: frame.url + (frame.urlFragment ?? ''),
    ...(name && { name }),
    ...(owner.id && { id: owner.id }),
    origin,
    crossOrigin: isCrossOrigin(origin, state.topOrigin),
    outOfProcess: sessionId !== undefined,
    ...(parentIndex !== undefined && { parentIndex }),
  };
  const ownerSession = state.sessionOf.get(frame.parentId ?? '');
  return {
    info,
    frameId: frame.id,
    ...(sessionId && { sessionId }),
    ...(ownerSession && { ownerSession }),
    ...(context && { context }),
  };
}

/**
 * The listing state before the first iframe: the page's own origin.
 *
 * @param page - The page's session tree
 * @param sessionOf - Session of each frame
 * @returns Initial state
 */
function initialListingState(
  page: SessionTree,
  sessionOf: Map<string, string | undefined>
): ListingState {
  const top = page.tree.frame;
  const topOrigin = effectiveFrameOrigin({
    url: top.url,
    securityOrigin: top.securityOrigin,
    contextOrigin: page.contexts.get(top.id)?.origin,
  });
  return { topOrigin, originOf: new Map([[top.id, topOrigin]]), indexOf: new Map(), sessionOf };
}

/**
 * Find every iframe of the page, nested and out-of-process ones included.
 * Frames that go away while they are being listed are skipped.
 *
 * @param fc - Frame connection
 * @returns Iframes in listing order
 */
async function discoverFrames(fc: FrameConnection): Promise<LocatedFrame[]> {
  const [page, outOfProcess] = await Promise.all([readSession(fc), outOfProcessTrees(fc)]);
  const nodes = flattenTrees([page, ...outOfProcess]);
  const sessionOf = new Map(nodes.map((node) => [node.frame.id, node.sessionId]));
  const iframes = iframesInOrder(nodes, page.tree.frame.id);
  const owners = await Promise.all(
    iframes.map((node) =>
      ownerAttributes(fc, node.frame.id, sessionOf.get(node.frame.parentId ?? ''))
    )
  );
  const state = initialListingState(page, sessionOf);
  return iframes.map((node, index) => describeFrame(node, index, owners[index] ?? {}, state));
}

/**
 * List the page's iframes.
 *
 * @param page - The session's connection
 * @param wsUrl - WebSocket URL of the page target
 * @returns Iframes in listing order
 */
export async function listFrames(page: CDPConnection, wsUrl: string): Promise<DomFrame[]> {
  const frames = await withFrameConnection(page, wsUrl, discoverFrames);
  return frames.map((frame) => frame.info);
}

/**
 * Find the requested frame and its default execution context.
 *
 * @param fc - Frame connection
 * @param query - Requested frame
 * @returns The frame and its context's unique id
 * @throws CommandError (81/83) when the frame is ambiguous, missing or has no context
 */
async function resolveFrame(
  fc: FrameConnection,
  query: string
): Promise<{ frame: LocatedFrame; uniqueContextId: string }> {
  const frames = await discoverFrames(fc);
  const selected = selectFrame(
    frames.map((frame) => frame.info),
    query
  );
  const frame = frames[selected.index] as LocatedFrame;
  if (!frame.context) {
    throw frameError(frameNotReadyError(frame.info.url), EXIT_CODES.RESOURCE_NOT_FOUND);
  }
  return { frame, uniqueContextId: frame.context.uniqueId };
}

/** Chrome's messages when a frame (or the session of its parent) no longer exists */
const FRAME_GONE_PATTERN = /not found|no frame|no node/i;

/** How long the frame's parent gets to say whether the frame is still there */
const OWNER_CHECK_MS = 2_000;

/** A frame whose script lost its context */
export interface LostFrame {
  frameId: string;
  /** Session of the parent frame, which owns the iframe element */
  ownerSession?: string;
  /** Frame URL when the script started */
  url: string;
}

/**
 * Whether the frame's iframe element is still in its parent.
 *
 * @param conn - Connection the frame was found on
 * @param frame - The frame
 * @returns `attached`, `removed`, or `unknown` when the parent did not answer in time
 * @throws Errors other than Chrome saying the frame is gone (e.g. a lost connection)
 */
async function frameOwnerState(
  conn: Pick<CDPConnection, 'send'>,
  frame: LostFrame
): Promise<'attached' | 'removed' | 'unknown'> {
  try {
    const owner = conn.send('DOM.getFrameOwner', { frameId: frame.frameId }, frame.ownerSession);
    return (await settledWithin(owner, OWNER_CHECK_MS)).settled ? 'attached' : 'unknown';
  } catch (error) {
    if (!(error instanceof CDPProtocolError) || !FRAME_GONE_PATTERN.test(error.message))
      throw error;
    log.debug(`Frame ${frame.frameId} is gone: ${error.message}`);
    return 'removed';
  }
}

/**
 * The error for a script whose frame context went away: the page was
 * closed, the frame navigated (its iframe element is still there) or was
 * removed.
 *
 * @param conn - Connection the frame was found on
 * @param page - The session's connection to the page
 * @param frame - The frame
 * @returns Command error (83)
 * @throws Errors of the checks other than Chrome saying the frame is gone
 */
export async function frameContextLostError(
  conn: Pick<CDPConnection, 'send'>,
  page: CDPSender,
  frame: LostFrame
): Promise<CommandError> {
  if (!(await pageStillOpen(page))) {
    return frameError(pageClosedDuringEvalError(), EXIT_CODES.RESOURCE_NOT_FOUND);
  }
  const messages = {
    attached: frameNavigatedDuringEvalError,
    removed: frameRemovedDuringEvalError,
    unknown: frameLostDuringEvalError,
  };
  const err = messages[await frameOwnerState(conn, frame)](frame.url);
  return frameError(err, EXIT_CODES.RESOURCE_NOT_FOUND);
}

/**
 * Evaluate a `bdg dom eval` script in one iframe, like {@link evaluateScript}
 * does in the page.
 *
 * @param page - The session's connection
 * @param wsUrl - WebSocket URL of the page target
 * @param script - JavaScript expression
 * @param query - Requested frame (index, name/id attribute, or part of the URL)
 * @returns Value, type and the frame's URL
 * @throws CommandError (81/83) when the frame is ambiguous or missing, (83)
 *   when it navigated or was removed while the script ran, else as evaluateScript
 */
export async function evaluateInFrame(
  page: CDPConnection,
  wsUrl: string,
  script: string,
  query: string
): Promise<DomEvalData> {
  return withFrameConnection(page, wsUrl, async (fc) => {
    const { frame, uniqueContextId } = await resolveFrame(fc, query);
    try {
      const result = await evaluateScript(fc.conn, script, {
        ...(frame.sessionId && { sessionId: frame.sessionId }),
        uniqueContextId,
        recovery: recoverySender(fc, frame.sessionId),
      });
      return { ...result, frame: frame.info.url };
    } catch (error) {
      if (!isContextLostError(error)) throw error;
      throw await frameContextLostError(fc.conn, fc.page, {
        frameId: frame.frameId,
        url: frame.info.url,
        ...(frame.ownerSession && { ownerSession: frame.ownerSession }),
      });
    }
  });
}
