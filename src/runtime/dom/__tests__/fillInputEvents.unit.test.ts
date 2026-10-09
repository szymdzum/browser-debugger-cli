/**
 * `dom fill` types into text fields with the input events Chrome sends for a
 * select-all and type: an `InputEvent` `beforeinput` (cancelable) and `input`
 * with `inputType` `insertText` and the text as `data`, or
 * `deleteContentBackward` without data when the field is cleared. The events
 * come from the field's own realm; a page whose `InputEvent` constructor
 * throws gets plain events.
 *
 * The helper is a page script, run here in an isolated VM context on a
 * target-like object.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { FIRE_INPUT_EVENT_JS } from '@/runtime/dom/reactEventHelpers.js';

/** An event as the fake target received it */
interface Fired {
  kind: string;
  type: string;
  init?: Record<string, unknown>;
  bubbles?: boolean;
  cancelable?: boolean;
}

const fireInputEvent = vm.runInNewContext(`(${FIRE_INPUT_EVENT_JS})`) as (
  target: object,
  type: string,
  text: string
) => boolean;

/**
 * Build a target whose realm has an `InputEvent` constructor (or one that
 * throws) and that records the events dispatched to it.
 *
 * @param options - Whether the realm's `InputEvent` throws, whether listeners cancel
 * @returns Target and the events it received
 */
function target(options: { brokenInputEvent?: boolean; cancels?: boolean } = {}): {
  el: object;
  fired: Fired[];
} {
  const fired: Fired[] = [];
  class InputEvent {
    /**
     * Record the init dictionary.
     *
     * @param type - Event type
     * @param init - InputEventInit
     */
    constructor(
      readonly type: string,
      readonly init: Record<string, unknown>
    ) {
      if (options.brokenInputEvent) throw new TypeError('Illegal constructor');
    }
  }
  const plainEvent = (): Record<string, unknown> => {
    const event: Record<string, unknown> = { kind: 'Event' };
    event['initEvent'] = (type: string, bubbles: boolean, cancelable: boolean): void => {
      Object.assign(event, { type, bubbles, cancelable });
    };
    return event;
  };
  const ownerDocument = { defaultView: { InputEvent }, createEvent: plainEvent };
  const el = {
    ownerDocument,
    dispatchEvent: (event: Record<string, unknown>): boolean => {
      fired.push(
        event instanceof InputEvent
          ? { kind: 'InputEvent', type: event.type, init: { ...event.init } }
          : {
              kind: String(event['kind']),
              type: String(event['type']),
              bubbles: Boolean(event['bubbles']),
              cancelable: Boolean(event['cancelable']),
            }
      );
      return !options.cancels;
    },
  };
  return { el, fired };
}

void describe('fill input events', () => {
  void it('fires a cancelable beforeinput and an input with insertText and the text', () => {
    const { el, fired } = target();
    assert.equal(fireInputEvent(el, 'beforeinput', 'flexbox'), true);
    fireInputEvent(el, 'input', 'flexbox');
    assert.deepEqual(fired, [
      {
        kind: 'InputEvent',
        type: 'beforeinput',
        init: {
          inputType: 'insertText',
          data: 'flexbox',
          bubbles: true,
          cancelable: true,
          composed: true,
        },
      },
      {
        kind: 'InputEvent',
        type: 'input',
        init: {
          inputType: 'insertText',
          data: 'flexbox',
          bubbles: true,
          cancelable: false,
          composed: true,
        },
      },
    ]);
  });

  void it('clears with deleteContentBackward and no data', () => {
    const { el, fired } = target();
    fireInputEvent(el, 'input', '');
    assert.equal(fired[0]?.init?.['inputType'], 'deleteContentBackward');
    assert.equal(fired[0]?.init?.['data'], null);
  });

  void it('reports a cancelled beforeinput', () => {
    const { el } = target({ cancels: true });
    assert.equal(fireInputEvent(el, 'beforeinput', 'x'), false);
  });

  void it("falls back to a plain event when the realm's InputEvent throws", () => {
    const { el, fired } = target({ brokenInputEvent: true });
    fireInputEvent(el, 'beforeinput', 'x');
    fireInputEvent(el, 'input', 'x');
    assert.deepEqual(fired, [
      { kind: 'Event', type: 'beforeinput', bubbles: true, cancelable: true },
      { kind: 'Event', type: 'input', bubbles: true, cancelable: false },
    ]);
  });
});
