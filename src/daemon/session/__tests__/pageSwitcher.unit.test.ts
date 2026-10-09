/**
 * Moving the session between tabs: a failed switch puts the session back on
 * its tab as it was, and a lost connection the session already left is not
 * recovered from.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { PageSwitcher, type PageHost, type PageStart } from '@/daemon/session/pageSwitcher.js';
import { TabTracker, type TargetInfoEvent } from '@/daemon/session/tabs.js';
import { PageIssueLog } from '@/telemetry/issues.js';
import type { CleanupFunction } from '@/types.js';

/** Targets Chrome lists, newest first */
const TARGETS: TargetInfoEvent[] = [
  { targetId: 'P', type: 'page', url: 'http://a/popup', title: 'Popup', openerId: 'A' },
  { targetId: 'A', type: 'page', url: 'http://a/', title: 'App' },
];

/** A page connection stand-in */
class FakeConnection {
  closed = false;

  constructor(readonly id: string) {}

  send(method: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('closed'));
    return Promise.resolve(method === 'Target.getTargets' ? { targetInfos: TARGETS } : {});
  }

  on(): () => void {
    return () => undefined;
  }

  close(): void {
    this.closed = true;
  }

  isConnected(): boolean {
    return !this.closed;
  }
}

/** A host recording what the switcher asked of it */
interface FakeHost extends PageHost {
  connections: Map<string, FakeConnection>;
  starts: Array<[string, PageStart['kind']]>;
  ended: string[];
}

/**
 * A host whose tabs are A (the opener) and P (the session tab).
 *
 * @param startPage - Starts what follows a tab (default: nothing to start)
 * @returns Host
 */
async function fakeHost(
  startPage: (cdp: FakeConnection, start: PageStart) => Promise<CleanupFunction[]> = () =>
    Promise.resolve([])
): Promise<FakeHost> {
  const store = new TelemetryStore();
  store.setTargetInfo({
    id: 'P',
    type: 'page',
    url: 'http://a/popup',
    title: 'Popup',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/P',
  });
  const tabs = new TabTracker();
  tabs.setCurrent('A');
  tabs.setCurrent('P');
  await tabs.attach(new FakeConnection('P'));
  const connections = new Map<string, FakeConnection>();
  const host: FakeHost = {
    store,
    tabs,
    isAttached: () => false,
    connections,
    starts: [],
    ended: [],
    connect: (wsUrl) => {
      const connection = new FakeConnection(wsUrl.split('/').pop() ?? '');
      connections.set(connection.id, connection);
      return Promise.resolve(connection as unknown as CDPConnection);
    },
    startPage: (cdp, start) => {
      const connection = cdp as unknown as FakeConnection;
      host.starts.push([connection.id, start.kind]);
      return startPage(connection, start);
    },
    assertTabFree: () => Promise.resolve(),
    chromeRunning: () => Promise.resolve(true),
    endAfterLoss: () => {
      host.ended.push('loss');
      return Promise.resolve();
    },
    endBroken: () => {
      host.ended.push('broken');
      return Promise.resolve();
    },
    switched: () => undefined,
    isStarted: () => true,
    isStopping: () => false,
  };
  return host;
}

/**
 * A promise settled from outside.
 *
 * @returns The promise and its resolve
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

void describe('PageSwitcher', () => {
  void it('moves to the tab, drops Fetch interception and closes the old connection', async () => {
    const host = await fakeHost();
    const switcher = new PageSwitcher(host);
    const popup = new FakeConnection('P');
    switcher.adopt(popup as unknown as CDPConnection, []);
    host.store.fetchInterceptionEnabled = true;

    await switcher.switchTo('A');

    assert.equal((switcher.connection as unknown as FakeConnection).id, 'A');
    assert.equal(host.tabs.current()?.targetId, 'A');
    assert.equal(host.store.targetInfo?.id, 'A');
    assert.equal(host.store.fetchInterceptionEnabled, false);
    assert.equal(popup.closed, true);
  });

  void it('puts the session tab back as it was when the new tab cannot be set up', async () => {
    const host = await fakeHost((cdp, start) => {
      if (start.kind !== 'switched') return Promise.resolve([]);
      host.store.navigationEvents.push({ url: 'http://a/', timestamp: 0, navigationId: 1 });
      host.store.pageIssues = new PageIssueLog();
      return Promise.reject(new Error(`collectors failed on ${cdp.id}`));
    });
    const switcher = new PageSwitcher(host);
    const popup = new FakeConnection('P');
    switcher.adopt(popup as unknown as CDPConnection, []);
    host.store.fetchInterceptionEnabled = true;
    host.store.navigationEvents.push({ url: '', timestamp: 0, navigationId: 0 });
    const issues = host.store.pageIssues;

    await assert.rejects(switcher.switchTo('A'), /collectors failed on A/);

    assert.equal(switcher.connection, popup as unknown as CDPConnection);
    assert.equal(host.store.targetInfo?.id, 'P');
    assert.equal(host.store.fetchInterceptionEnabled, true);
    assert.equal(host.store.navigationEvents.length, 1);
    assert.equal(host.store.pageIssues, issues);
    assert.equal(host.tabs.current()?.targetId, 'P');
    assert.equal(
      host.tabs.fallbackFor('P')?.targetId,
      'A',
      'A is the opener, not a failed current'
    );
    assert.deepEqual(host.starts, [
      ['A', 'switched'],
      ['P', 'resumed'],
    ]);
    assert.equal(host.connections.get('A')?.closed, true);
    assert.equal(popup.closed, false);
  });

  void it('ends the session when it cannot go back to its tab either', async () => {
    const host = await fakeHost(() => Promise.reject(new Error('collectors failed')));
    const switcher = new PageSwitcher(host);
    switcher.adopt(new FakeConnection('P') as unknown as CDPConnection, []);

    await assert.rejects(switcher.switchTo('A'), /session ended/);

    assert.deepEqual(host.ended, ['broken']);
  });

  void it('ignores the loss of a tab the session left while the loss waited for the switch', async () => {
    const gate = deferred();
    const host = await fakeHost((_cdp, start) =>
      start.kind === 'switched' ? gate.promise.then(() => []) : Promise.resolve([])
    );
    const switcher = new PageSwitcher(host);
    const popup = new FakeConnection('P');
    switcher.adopt(popup as unknown as CDPConnection, []);

    const switching = switcher.switchTo('A');
    await new Promise((resolve) => setImmediate(resolve));
    host.tabs.markClosed('P');
    switcher.onPageDisconnected(popup as unknown as CDPConnection, true);
    gate.resolve();
    await switching;
    await switcher.pageLost(popup as unknown as CDPConnection);

    assert.deepEqual(host.ended, []);
    assert.equal((switcher.connection as unknown as FakeConnection).id, 'A');
    assert.deepEqual(
      host.tabs.list().map((tab) => [tab.targetId, tab.current]),
      [['A', true]]
    );
  });

  void it('returns to the opener when the session tab closes', async () => {
    const host = await fakeHost();
    const switcher = new PageSwitcher(host);
    const popup = new FakeConnection('P');
    switcher.adopt(popup as unknown as CDPConnection, []);

    host.tabs.markClosed('P');
    switcher.onPageDisconnected(popup as unknown as CDPConnection, true);
    await switcher.pageLost(popup as unknown as CDPConnection);

    assert.equal(host.tabs.current()?.targetId, 'A');
    assert.equal(host.tabs.takeClosedSwitch()?.tabClosed.targetId, 'P');
    assert.deepEqual(host.ended, []);
  });

  void it('ends a session whose closed tab cannot be left as a closed tab, not by resuming on it', async () => {
    const host = await fakeHost((cdp, start) =>
      start.kind === 'switched'
        ? Promise.reject(new Error('opener gone too'))
        : Promise.reject(new Error(`resumed on closed ${cdp.id}`))
    );
    const switcher = new PageSwitcher(host);
    const popup = new FakeConnection('P');
    switcher.adopt(popup as unknown as CDPConnection, []);

    host.tabs.markClosed('P');
    switcher.onPageDisconnected(popup as unknown as CDPConnection, true);
    await switcher.pageLost(popup as unknown as CDPConnection);

    assert.deepEqual(host.starts, [['A', 'switched']], 'no resume on the closed tab');
    assert.deepEqual(host.ended, ['loss']);
  });

  void it('drops the requests in flight before a failed switch', async () => {
    const host = await fakeHost((_cdp, start) =>
      start.kind === 'switched' ? Promise.reject(new Error('failed')) : Promise.resolve([])
    );
    const switcher = new PageSwitcher(host);
    switcher.adopt(new FakeConnection('P') as unknown as CDPConnection, []);
    host.store.pendingNetworkRequests.set('r1', {
      request: { requestId: 'r1', url: 'http://a/api', method: 'GET', timestamp: 0 },
    } as never);

    await assert.rejects(switcher.switchTo('A'));

    assert.equal(host.store.pendingNetworkRequests.size, 0);
  });

  void it("starts the new tab without the old one's Fetch flag and crash, and puts them back on failure", async () => {
    const seen: Array<[boolean, number | undefined]> = [];
    const host = await fakeHost((_cdp, start) => {
      if (start.kind !== 'switched') return Promise.resolve([]);
      seen.push([host.store.fetchInterceptionEnabled, host.store.pageCrashedAt]);
      return Promise.reject(new Error('failed'));
    });
    const switcher = new PageSwitcher(host);
    switcher.adopt(new FakeConnection('P') as unknown as CDPConnection, []);
    host.store.fetchInterceptionEnabled = true;
    host.store.pageCrashedAt = 42;

    await assert.rejects(switcher.switchTo('A'));

    assert.deepEqual(seen, [[false, undefined]]);
    assert.equal(host.store.fetchInterceptionEnabled, true);
    assert.equal(host.store.pageCrashedAt, 42);
  });
});
