import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildEventListenerSummary,
  inspectElementEventListeners,
  isInteractionEventType,
  type EventListenerCDPSender,
} from '@/runtime/dom/eventListeners.js';

void describe('event listener inspection', () => {
  void it('summarizes direct and delegated interaction listeners', () => {
    const summary = buildEventListenerSummary([
      {
        type: 'click',
        source: 'target',
        useCapture: false,
        passive: false,
        once: false,
        scriptId: '1',
        lineNumber: 10,
        columnNumber: 2,
      },
      {
        type: 'input',
        source: 'parent',
        useCapture: true,
        passive: true,
        once: false,
        scriptId: '2',
        lineNumber: 20,
        columnNumber: 4,
      },
    ]);

    assert.equal(summary.count, 2);
    assert.deepEqual(summary.types, ['click', 'input']);
    assert.deepEqual(summary.targetTypes, ['click']);
    assert.deepEqual(summary.delegatedTypes, ['input']);
    assert.deepEqual(summary.interactionTypes, ['click', 'input']);
    assert.equal(summary.hasInteractionListeners, true);
  });

  void it('does not treat non-interaction listeners as interaction signals', () => {
    assert.equal(isInteractionEventType('animationend'), false);
    assert.equal(isInteractionEventType('CLICK'), true);
  });

  void it('inspects target and immediate parent listeners through CDP', async () => {
    const sender: EventListenerCDPSender = {
      send(method, params = {}): Promise<unknown> {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({
            object: { objectId: params['nodeId'] === 7 ? 'target-object' : 'parent-object' },
          });
        }

        if (method === 'DOM.describeNode') {
          return Promise.resolve({ node: { parentId: 3 } });
        }

        if (method === 'DOMDebugger.getEventListeners') {
          const objectId = params['objectId'];
          return Promise.resolve({
            listeners:
              objectId === 'target-object'
                ? [makeListener('click', 'target-handler')]
                : [makeListener('submit', 'parent-handler')],
          });
        }

        throw new Error(`Unexpected CDP method: ${method}`);
      },
    };

    const summary = await inspectElementEventListeners(sender, 7);

    assert.deepEqual(summary.targetTypes, ['click']);
    assert.deepEqual(summary.delegatedTypes, ['submit']);
    assert.equal(summary.listeners[0]?.source, 'target');
    assert.equal(summary.listeners[1]?.source, 'parent');
  });
});

function makeListener(
  type: string,
  description: string
): {
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
  handler: { description: string };
} {
  return {
    type,
    useCapture: false,
    passive: false,
    once: false,
    scriptId: '1',
    lineNumber: 1,
    columnNumber: 1,
    handler: { description },
  };
}
