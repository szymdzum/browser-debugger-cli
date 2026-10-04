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
import type { Protocol } from '@/connection/typed-cdp.js';
import { frameNotReadyError } from '@/errors/messages.js';
import type { DomEvalData, DomFrame } from '@/ipc/protocol/commands.js';
import { evaluateScript, withBusyPageRecovery } from '@/runtime/dom/evalHelpers.js';
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

/** A frame tree and the session it was read from (undefined: the page) */
interface SessionTree {
  tree: Protocol.Page.FrameTree;
  sessionId?: string;
}

/** A frame with the session that owns it */
interface FrameNode {
  frame: Protocol.Page.Frame;
  sessionId?: string;
}

/** A listed iframe plus what is needed to run a script in it */
interface LocatedFrame {
  info: DomFrame;
  frameId: string;
  sessionId?: string;
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
  return (await withBusyPageRecovery(recoverySender(fc, sessionId), command)) as T;
}

/**
 * Frame tree of a session.
 *
 * @param fc - Frame connection
 * @param sessionId - Session, undefined for the page
 * @returns The tree
 */
async function frameTree(fc: FrameConnection, sessionId?: string): Promise<SessionTree> {
  const { frameTree: tree } = await sendToSession<Protocol.Page.GetFrameTreeResponse>(
    fc,
    'Page.getFrameTree',
    {},
    sessionId
  );
  return { tree, ...(sessionId && { sessionId }) };
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
  const nested = await Promise.all(
    sessions.map(async (sessionId) => [
      await frameTree(fc, sessionId),
      ...(await outOfProcessTrees(fc, sessionId)),
    ])
  );
  return nested.flat();
}

/**
 * All frames of the trees, each with its session.
 *
 * @param trees - Frame trees
 * @returns Frames in tree order
 */
function flattenTrees(trees: SessionTree[]): FrameNode[] {
  const nodes: FrameNode[] = [];
  const walk = (tree: Protocol.Page.FrameTree, sessionId?: string): void => {
    nodes.push({ frame: tree.frame, ...(sessionId && { sessionId }) });
    tree.childFrames?.forEach((child) => walk(child, sessionId));
  };
  trees.forEach(({ tree, sessionId }) => walk(tree, sessionId));
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
 * @returns `name` and `id` attributes when set
 */
async function ownerAttributes(
  fc: FrameConnection,
  frameId: string,
  ownerSession?: string
): Promise<{ name?: string; id?: string }> {
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
    return { ...(name && { name }), ...(id && { id }) };
  } catch (error) {
    log.debug(`No iframe element for frame ${frameId}: ${getErrorMessage(error)}`);
    return {};
  }
}

/**
 * Describe an iframe for listing. Chrome names a frame after its element's
 * `id` when it has no `name`, so such a name is not repeated.
 *
 * @param fc - Frame connection
 * @param node - The frame
 * @param index - Its position
 * @param context - The page's origin and the session of each frame
 * @returns The located frame
 */
async function locateFrame(
  fc: FrameConnection,
  node: FrameNode,
  index: number,
  context: { topOrigin: string; sessionOf: Map<string, string | undefined> }
): Promise<LocatedFrame> {
  const { frame, sessionId } = node;
  const owner = await ownerAttributes(fc, frame.id, context.sessionOf.get(frame.parentId ?? ''));
  const name = owner.name ?? (frame.name === owner.id ? undefined : frame.name);
  const info: DomFrame = {
    index,
    url: frame.url + (frame.urlFragment ?? ''),
    ...(name && { name }),
    ...(owner.id && { id: owner.id }),
    origin: frame.securityOrigin,
    crossOrigin: frame.securityOrigin !== context.topOrigin,
    outOfProcess: sessionId !== undefined,
  };
  return { info, frameId: frame.id, ...(sessionId && { sessionId }) };
}

/**
 * Find every iframe of the page, nested and out-of-process ones included.
 *
 * @param fc - Frame connection
 * @returns Iframes in listing order
 */
async function discoverFrames(fc: FrameConnection): Promise<LocatedFrame[]> {
  const [page, outOfProcess] = await Promise.all([frameTree(fc), outOfProcessTrees(fc)]);
  const nodes = flattenTrees([page, ...outOfProcess]);
  const sessionOf = new Map(nodes.map((node) => [node.frame.id, node.sessionId]));
  const context = { topOrigin: page.tree.frame.securityOrigin, sessionOf };
  const iframes = iframesInOrder(nodes, page.tree.frame.id);
  return Promise.all(iframes.map((node, index) => locateFrame(fc, node, index, context)));
}

/**
 * The default (main-world) execution context of a frame, so the script sees
 * the frame's own globals.
 *
 * @param fc - Frame connection
 * @param frame - The frame
 * @returns The context's unique id
 * @throws CommandError (83) when the frame has no context yet
 */
async function defaultContext(fc: FrameConnection, frame: LocatedFrame): Promise<string> {
  const contexts: Protocol.Runtime.ExecutionContextDescription[] = [];
  const stop = fc.conn.on<Protocol.Runtime.ExecutionContextCreatedEvent>(
    'Runtime.executionContextCreated',
    ({ context }, sessionId) => {
      if (sessionId === frame.sessionId) contexts.push(context);
    }
  );
  try {
    await sendToSession(fc, 'Runtime.enable', {}, frame.sessionId);
  } finally {
    stop();
  }
  const auxData = (c: Protocol.Runtime.ExecutionContextDescription): Record<string, unknown> =>
    (c.auxData ?? {}) as Record<string, unknown>;
  const context = contexts.find(
    (c) => auxData(c)['frameId'] === frame.frameId && auxData(c)['isDefault']
  );
  if (!context) throw frameError(frameNotReadyError(frame.info.url), EXIT_CODES.RESOURCE_NOT_FOUND);
  return context.uniqueId;
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
  return { frame, uniqueContextId: await defaultContext(fc, frame) };
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
 * @throws CommandError (81/83) when the frame is ambiguous or missing, else as evaluateScript
 */
export async function evaluateInFrame(
  page: CDPConnection,
  wsUrl: string,
  script: string,
  query: string
): Promise<DomEvalData> {
  return withFrameConnection(page, wsUrl, async (fc) => {
    const { frame, uniqueContextId } = await resolveFrame(fc, query);
    const result = await evaluateScript(fc.conn, script, {
      ...(frame.sessionId && { sessionId: frame.sessionId }),
      uniqueContextId,
    });
    return { ...result, frame: frame.info.url };
  });
}
