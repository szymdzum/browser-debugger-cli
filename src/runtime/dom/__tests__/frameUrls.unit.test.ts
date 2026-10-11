/**
 * `dom frames` and the `frame` field of frame-scoped results show an
 * iframe's URL without user info and with its tokens masked (#623); the
 * origin is still computed from the URL as reported.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeFrame, type FrameNode, type ListingState } from '@/runtime/dom/frames.js';

/**
 * A listing state with the main frame placed.
 *
 * @returns State
 */
function state(): ListingState {
  return {
    topOrigin: 'https://app.test',
    originOf: new Map([['TOP', 'https://app.test']]),
    indexOf: new Map(),
    sessionOf: new Map(),
  };
}

void describe('describeFrame URLs (#623)', () => {
  void it('removes the user info and masks the tokens of the listed URL', () => {
    const node = {
      frame: {
        id: 'F1',
        parentId: 'TOP',
        url: 'https://bob:PW@idp.test/authorize?access_token=T&state=ok',
        urlFragment: '#id_token=T',
        securityOrigin: 'https://idp.test',
      },
    } as unknown as FrameNode;
    const located = describeFrame(node, 0, {}, state());
    assert.equal(
      located.info.url,
      'https://idp.test/authorize?access_token=••••&state=ok#id_token=••••'
    );
    assert.equal(located.info.origin, 'https://idp.test');
    assert.equal(located.info.crossOrigin, true);
  });
});
