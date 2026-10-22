/**
 * Redirects Chrome refuses (#890), told apart from a 204, a download and a
 * navigation another one replaced, from the event sequences Chrome sends
 * (recorded on Chrome 141 headless): the redirect hop of `myapp://`, and the raw headers (`responseReceivedExtraInfo`) that come
 * after the failure for `javascript:` and `view-source:`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { watchRefusedRedirects } from '@/runtime/page/refusedRedirect.js';

/** Base of the requests */
const SERVER = 'http://127.0.0.1:1234';

/**
 * A fake connection whose events the test emits.
 *
 * @returns The connection and its emitter
 */
function fakeEvents(): {
  cdp: Pick<CDPConnection, 'on'>;
  emit: (event: string, params: Record<string, unknown>) => void;
} {
  const handlers = new Map<string, Array<(params: unknown) => void>>();
  const cdp = {
    on: (event: string, handler: (params: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as Pick<CDPConnection, 'on'>;
  const emit = (event: string, params: Record<string, unknown>): void =>
    (handlers.get(event) ?? []).forEach((handler) => handler(params));
  return { cdp, emit };
}

/** Events of one document request */
type Step =
  | ['request', string, Record<string, unknown>?]
  | ['response', number]
  | ['extra', number, string?]
  | ['failed', string];

/**
 * Emit a main-frame document request's events.
 *
 * @param emit - Emitter
 * @param steps - The events in order
 * @param requestId - Request id (the loader id)
 * @param frameId - Frame of the request
 */
function play(
  emit: (event: string, params: Record<string, unknown>) => void,
  steps: Step[],
  requestId = 'L1',
  frameId = 'main'
): void {
  for (const step of steps) {
    const base = { requestId, frameId, type: 'Document', loaderId: requestId };
    if (step[0] === 'request')
      emit('Network.requestWillBeSent', { ...base, request: { url: step[1] }, ...step[2] });
    if (step[0] === 'response')
      emit('Network.responseReceived', { ...base, response: { status: step[1], url: SERVER } });
    if (step[0] === 'extra')
      emit('Network.responseReceivedExtraInfo', {
        requestId,
        statusCode: step[1],
        headers: step[2] === undefined ? {} : { location: step[2] },
      });
    if (step[0] === 'failed')
      emit('Network.loadingFailed', { requestId, type: 'Document', errorText: step[1] });
  }
}

/** A redirect hop to `to` */
const hop = (to: string): Step => ['request', to, { redirectResponse: { status: 302 } }];

void describe('watchRefusedRedirects', () => {
  void it('a redirect to myapp:// that Chrome aborts is refused, named by its hop', async () => {
    const { cdp, emit } = fakeEvents();
    const watch = watchRefusedRedirects(cdp, 'main');
    play(emit, [
      ['request', `${SERVER}/r`],
      ['extra', 302, 'myapp://callback'],
      hop('myapp://callback'),
      ['failed', 'net::ERR_ABORTED'],
    ]);
    assert.deepEqual(await watch.refused(), {
      url: `${SERVER}/r`,
      errorText: 'net::ERR_ABORTED',
      redirectedTo: 'myapp://callback',
    });
    watch.stop();
  });

  for (const target of ['javascript:alert(1)', `view-source:${SERVER}/ok`]) {
    void it(`a redirect to ${target.split(':')[0]}: is refused once its headers come after the failure`, async () => {
      const { cdp, emit } = fakeEvents();
      const watch = watchRefusedRedirects(cdp, 'main');
      play(emit, [
        ['request', `${SERVER}/r`],
        ['failed', 'net::ERR_ABORTED'],
      ]);
      const verdict = watch.refused();
      play(emit, [['extra', 302, target]]);
      assert.deepEqual(await verdict, {
        url: `${SERVER}/r`,
        errorText: 'net::ERR_ABORTED',
        redirectedTo: target,
      });
      watch.stop();
    });
  }

  void it('without a request id, any followed request that was refused', async () => {
    const { cdp, emit } = fakeEvents();
    const watch = watchRefusedRedirects(cdp, 'main');
    play(
      emit,
      [['request', `${SERVER}/r`], hop('myapp://other'), ['failed', 'net::ERR_ABORTED']],
      'L7'
    );
    assert.equal((await watch.refused())?.redirectedTo, 'myapp://other');
    watch.stop();
  });

  const kept: Array<[string, Step[]]> = [
    [
      'a 204 after a redirect',
      [
        ['request', `${SERVER}/r`],
        hop(`${SERVER}/status/204`),
        ['response', 204],
        ['failed', 'net::ERR_ABORTED'],
        ['extra', 204],
      ],
    ],
    [
      'a download',
      [
        ['request', `${SERVER}/download`],
        ['response', 200],
        ['failed', 'net::ERR_ABORTED'],
        ['extra', 200],
      ],
    ],
    [
      'a redirect to an http page',
      [['request', `${SERVER}/r`], ['extra', 302, '/ok'], hop(`${SERVER}/ok`), ['response', 200]],
    ],
    [
      'a failure Chrome shows its error page for',
      [
        ['request', `${SERVER}/r`],
        ['failed', 'net::ERR_UNSAFE_REDIRECT'],
        ['extra', 302, 'data:text/html,x'],
      ],
    ],
    [
      'a navigation another one replaced',
      [
        ['request', `${SERVER}/hang`],
        ['failed', 'net::ERR_ABORTED'],
      ],
    ],
  ];
  for (const [name, steps] of kept) {
    void it(`${name} is no refused redirect`, async () => {
      const { cdp, emit } = fakeEvents();
      const watch = watchRefusedRedirects(cdp, 'main', 0);
      play(emit, steps);
      assert.equal(await watch.refused(), undefined);
      assert.equal(await watch.refused(), undefined);
      watch.stop();
    });
  }

  void it('a relative Location resolves against the request: an http page is kept', async () => {
    const { cdp, emit } = fakeEvents();
    const watch = watchRefusedRedirects(cdp, 'main', 0);
    play(emit, [
      ['request', `${SERVER}/r`],
      ['failed', 'net::ERR_ABORTED'],
      ['extra', 302, '/ok'],
    ]);
    assert.equal(await watch.refused(), undefined);
    watch.stop();
  });

  void it("an iframe's refused redirect is not the main frame's", async () => {
    const { cdp, emit } = fakeEvents();
    const watch = watchRefusedRedirects(cdp, 'main', 0);
    play(
      emit,
      [['request', `${SERVER}/r`], hop('myapp://x'), ['failed', 'net::ERR_ABORTED']],
      'L1',
      'child'
    );
    assert.equal(await watch.refused(), undefined);
    watch.stop();
  });
});
