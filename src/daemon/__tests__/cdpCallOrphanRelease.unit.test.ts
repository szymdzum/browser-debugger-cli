/**
 * The daemon's release of a killed CLI's object groups (#606) runs beside
 * the CDP calls of other commands: a page that never answers the release
 * does not hold up the next `cdp_call`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createCommandRegistry } from '@/daemon/session/commandRegistry.js';
import { raceTimeout } from '@/utils/async.js';

/** A process id no process has (above every platform's pid limit) */
const EXITED_PID = 2 ** 31 - 2;

/** Longest a plain call may take when nothing holds it up */
const ANSWER_LIMIT_MS = 500;

void describe('cdp_call with a killed CLI’s group to release', () => {
  void it('answers without waiting for a release the page never answers', async () => {
    const released: unknown[] = [];
    const cdp = {
      send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        if (method !== 'Runtime.releaseObjectGroup') return Promise.resolve({});
        released.push(params['objectGroup']);
        return new Promise(() => undefined);
      },
    } as unknown as CDPConnection;
    const registry = createCommandRegistry(new TelemetryStore(), {
      get: () => ({}),
      set: () => undefined,
    });
    const signal = new AbortController().signal;
    await raceTimeout(
      registry.cdp_call(
        cdp,
        { method: 'DOM.resolveNode', params: { objectGroup: 'bdg-node-1-1' }, owner: EXITED_PID },
        signal
      ),
      ANSWER_LIMIT_MS,
      { onTimeout: () => assert.fail('the creating call waited for the release') }
    );
    await raceTimeout(
      registry.cdp_call(cdp, { method: 'Page.getFrameTree' }, signal),
      ANSWER_LIMIT_MS,
      { onTimeout: () => assert.fail('an unrelated call waited for the release') }
    );
    assert.deepEqual(released, ['bdg-node-1-1'], 'released more than once');
  });
});
