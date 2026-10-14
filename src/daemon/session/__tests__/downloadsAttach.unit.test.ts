/**
 * Downloads of a tab attached with `bdg attach` (#473 review): the user's
 * download behavior is kept (`default`, events on), only downloads of the
 * tab's frames are recorded, and the events are turned off when the session
 * ends.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { followAttachedTab } from '@/daemon/session/downloads.js';
import type { TelemetryPluginContext } from '@/daemon/session/plugins.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createLogger } from '@/ui/logging/index.js';

/** A fake page connection: records commands, lets the test fire events */
function fakeConnection(): {
  cdp: CDPConnection;
  sent: { method: string; params: unknown }[];
  fire: (event: string, params: unknown) => void;
} {
  const sent: { method: string; params: unknown }[] = [];
  const handlers = new Map<string, ((params: unknown) => void)[]>();
  const cdp = {
    send: (method: string, params: unknown = {}) => {
      sent.push({ method, params });
      return Promise.resolve(
        method === 'Page.getFrameTree'
          ? { frameTree: { frame: { id: 'MAIN' }, childFrames: [{ frame: { id: 'CHILD' } }] } }
          : {}
      );
    },
    on: (event: string, handler: (params: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as CDPConnection;
  const fire = (event: string, params: unknown): void =>
    (handlers.get(event) ?? []).forEach((handler) => handler(params));
  return { cdp, sent, fire };
}

void describe('followAttachedTab', () => {
  void it("keeps the user's behavior, records the tab's frames only, turns events off at the end", async () => {
    const { cdp, sent, fire } = fakeConnection();
    const store = new TelemetryStore();
    store.setTargetInfo({ id: 'MAIN', type: 'page', title: '', url: '', webSocketDebuggerUrl: '' });
    const context = {
      cdp,
      store,
      logger: createLogger('session'),
    } as unknown as TelemetryPluginContext;

    const cleanup = await followAttachedTab(context);
    const behaviors = (): unknown[] =>
      sent.filter((c) => c.method === 'Browser.setDownloadBehavior').map((c) => c.params);
    assert.deepEqual(behaviors(), [{ behavior: 'default', eventsEnabled: true }]);

    fire('Page.frameAttached', { frameId: 'LATE' });
    for (const frameId of ['MAIN', 'CHILD', 'LATE', 'OTHER-TAB']) {
      fire('Browser.downloadWillBegin', {
        guid: frameId,
        frameId,
        url: `https://x.test/${frameId}`,
        suggestedFilename: `${frameId}.txt`,
      });
    }
    assert.deepEqual(
      store.downloads.map((d) => d.guid),
      ['MAIN', 'CHILD', 'LATE']
    );

    await cleanup();
    assert.deepEqual(behaviors().at(-1), { behavior: 'default', eventsEnabled: false });
  });
});
