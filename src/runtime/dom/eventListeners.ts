/**
 * CDP-backed event listener inspection for DOM interaction commands.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type {
  DomEventListenerInfo,
  DomEventListenerSource,
  DomEventListenerSummary,
} from '@/ipc/protocol/domTypes.js';
import { filterDefined } from '@/utils/objects.js';

const INTERACTION_EVENT_TYPES = new Set([
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'submit',
  'input',
  'change',
  'beforeinput',
  'keydown',
  'keyup',
  'focus',
  'blur',
]);

/** Minimal CDP sender used by direct and IPC-backed callers. */
export interface EventListenerCDPSender {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Options for inspecting listeners on one DOM node. */
export interface EventListenerInspectionOptions {
  /** Include immediate parent listeners as delegated interaction hints. */
  includeParent?: boolean;
}

/**
 * Return true when a listener type is likely relevant to page interaction.
 */
export function isInteractionEventType(type: string): boolean {
  return INTERACTION_EVENT_TYPES.has(type.toLowerCase());
}

/**
 * Resolve one CSS selector match to a CDP node id.
 */
export async function resolveElementNodeId(
  cdp: EventListenerCDPSender,
  selector: string,
  index = 0
): Promise<number | null> {
  await cdp.send('DOM.enable', {});

  const docResponse = await cdp.send('DOM.getDocument', {});
  const doc = docResponse as Protocol.DOM.GetDocumentResponse;
  const rootNodeId = doc.root?.nodeId;
  if (rootNodeId === undefined) {
    return null;
  }

  const queryResponse = await cdp.send('DOM.querySelectorAll', { nodeId: rootNodeId, selector });
  const query = queryResponse as Protocol.DOM.QuerySelectorAllResponse;
  return query.nodeIds[index] ?? null;
}

/**
 * Inspect direct and delegated event listeners for a selector match.
 */
export async function inspectElementEventListenersBySelector(
  cdp: EventListenerCDPSender,
  selector: string,
  index = 0,
  options: EventListenerInspectionOptions = {}
): Promise<DomEventListenerSummary | undefined> {
  const nodeId = await resolveElementNodeId(cdp, selector, index);
  if (nodeId === null) {
    return undefined;
  }

  return await inspectElementEventListeners(cdp, nodeId, options);
}

/**
 * Inspect direct and delegated event listeners for a CDP node id.
 */
export async function inspectElementEventListeners(
  cdp: EventListenerCDPSender,
  nodeId: number,
  options: EventListenerInspectionOptions = {}
): Promise<DomEventListenerSummary> {
  const targetListeners = await getNodeEventListeners(cdp, nodeId, 'target');
  const parentListeners =
    options.includeParent === false ? [] : await getParentEventListeners(cdp, nodeId);
  const listeners = [...targetListeners, ...parentListeners];
  return buildEventListenerSummary(listeners);
}

/**
 * Build an interaction-oriented summary from normalized listener metadata.
 */
export function buildEventListenerSummary(
  listeners: DomEventListenerInfo[]
): DomEventListenerSummary {
  const types = uniqueSorted(listeners.map((listener) => listener.type));
  const targetTypes = uniqueSorted(
    listeners.filter((listener) => listener.source === 'target').map((listener) => listener.type)
  );
  const delegatedTypes = uniqueSorted(
    listeners.filter((listener) => listener.source === 'parent').map((listener) => listener.type)
  );
  const interactionTypes = uniqueSorted(types.filter(isInteractionEventType));

  return {
    count: listeners.length,
    types,
    targetTypes,
    delegatedTypes,
    interactionTypes,
    hasInteractionListeners: interactionTypes.length > 0,
    listeners,
  };
}

async function getParentEventListeners(
  cdp: EventListenerCDPSender,
  nodeId: number
): Promise<DomEventListenerInfo[]> {
  const parentNodeId = await getParentNodeId(cdp, nodeId);
  if (parentNodeId === null) {
    return [];
  }

  return await getNodeEventListeners(cdp, parentNodeId, 'parent');
}

async function getParentNodeId(
  cdp: EventListenerCDPSender,
  nodeId: number
): Promise<number | null> {
  const response = await cdp.send('DOM.describeNode', { nodeId });
  const result = response as Protocol.DOM.DescribeNodeResponse;
  return result.node.parentId ?? null;
}

async function getNodeEventListeners(
  cdp: EventListenerCDPSender,
  nodeId: number,
  source: DomEventListenerSource
): Promise<DomEventListenerInfo[]> {
  const objectId = await resolveNodeObjectId(cdp, nodeId);
  if (objectId === null) {
    return [];
  }

  const response = await cdp.send('DOMDebugger.getEventListeners', { objectId });
  const result = response as Protocol.DOMDebugger.GetEventListenersResponse;
  return result.listeners.map((listener) => normalizeEventListener(listener, source));
}

async function resolveNodeObjectId(
  cdp: EventListenerCDPSender,
  nodeId: number
): Promise<string | null> {
  const response = await cdp.send('DOM.resolveNode', { nodeId });
  const result = response as Protocol.DOM.ResolveNodeResponse;
  return result.object.objectId ?? null;
}

function normalizeEventListener(
  listener: Protocol.DOMDebugger.EventListener,
  source: DomEventListenerSource
): DomEventListenerInfo {
  return filterDefined({
    type: listener.type,
    source,
    useCapture: listener.useCapture,
    passive: listener.passive,
    once: listener.once,
    scriptId: listener.scriptId,
    lineNumber: listener.lineNumber,
    columnNumber: listener.columnNumber,
    handlerDescription: listener.handler?.description,
    backendNodeId: listener.backendNodeId,
  }) as unknown as DomEventListenerInfo;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}
