/**
 * The session's tab list: stable indices, opened tabs, resolving
 * `page switch` targets and the tab to fall back to when one closes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TabTracker, type TargetInfoEvent } from '@/daemon/session/tabs.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Events a fake connection can emit */
type Emit = (event: string, params: unknown, sessionId?: string) => void;

/**
 * A page target info.
 *
 * @param targetId - Id
 * @param url - URL
 * @param extra - Other fields
 * @returns Target info
 */
function page(
  targetId: string,
  url: string,
  extra: Partial<TargetInfoEvent> = {}
): TargetInfoEvent {
  return { targetId, type: 'page', url, title: targetId, ...extra };
}

/**
 * A connection whose `Target.getTargets` answers the given targets
 * (newest first, as Chrome lists them) and whose events can be emitted.
 *
 * @param targets - Targets
 * @returns Connection, the commands sent and an emitter
 */
function fakeSource(targets: TargetInfoEvent[]): {
  source: Parameters<TabTracker['attach']>[0];
  sent: string[];
  emit: Emit;
  failing: Set<string>;
} {
  const handlers = new Map<string, (params: unknown, sessionId?: string) => void>();
  const sent: string[] = [];
  const failing = new Set<string>();
  const source = {
    send: (method: string) => {
      sent.push(method);
      if (failing.has(method)) return Promise.reject(new Error(`${method} unavailable`));
      return Promise.resolve(method === 'Target.getTargets' ? { targetInfos: targets } : {});
    },
    on: (event: string, handler: (params: unknown, sessionId?: string) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  } as unknown as Parameters<TabTracker['attach']>[0];
  return {
    source,
    sent,
    failing,
    emit: (event, params, sessionId) => handlers.get(event)?.(params, sessionId),
  };
}

/**
 * The error a call throws.
 *
 * @param call - Call
 * @returns Its CommandError
 */
function thrown(call: () => unknown): CommandError {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof CommandError);
    return error;
  }
  assert.fail('expected an error');
}

void describe('TabTracker', () => {
  void it('lists the session tab first, then the other pages oldest first, and enables discovery', async () => {
    const tracker = new TabTracker();
    const { source, sent } = fakeSource([
      page('C', 'http://c/'),
      { targetId: 'W', type: 'service_worker', url: 'http://c/sw.js', title: '' },
      page('B', 'http://b/'),
      page('A', 'http://a/'),
    ]);

    tracker.setCurrent('B');
    await tracker.attach(source);

    assert.deepEqual(
      tracker.list().map((tab) => [tab.index, tab.targetId, tab.current]),
      [
        [0, 'B', true],
        [1, 'A', undefined],
        [2, 'C', undefined],
      ]
    );
    assert.deepEqual(sent, ['Target.getTargets', 'Target.setDiscoverTargets']);
  });

  void it('reports tabs created after attaching as opened, popups apart from tabs', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);
    const mark = tracker.openedCount();

    emit('Target.targetCreated', {
      targetInfo: page('P', 'about:blank', { openerId: 'A', canAccessOpener: true }),
    });
    emit('Target.targetInfoChanged', {
      targetInfo: page('P', 'http://a/popup', { openerId: 'A', canAccessOpener: true }),
    });
    emit('Target.targetCreated', { targetInfo: page('T', 'http://a/tab', { openerId: 'A' }) });
    emit('Target.targetCreated', { targetInfo: page('X', 'http://child/') }, 'child-session');

    assert.deepEqual(tracker.openedSince(mark), [
      { url: 'http://a/popup', targetId: 'P', kind: 'popup', index: 1 },
      { url: 'http://a/tab', targetId: 'T', kind: 'tab', index: 2 },
    ]);
    assert.equal(tracker.list()[1]?.openedBy, 0);
    assert.deepEqual(tracker.openedSince(tracker.openedCount()), []);
  });

  void it('keeps reporting an opened tab that closed, without an index', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    emit('Target.targetCreated', { targetInfo: page('P', 'http://a/popup', { openerId: 'A' }) });
    emit('Target.targetDestroyed', { targetId: 'P' });

    assert.deepEqual(tracker.openedSince(0), [
      { url: 'http://a/popup', targetId: 'P', kind: 'tab' },
    ]);
    assert.equal(tracker.list().length, 1);
  });

  void it('keeps the session tab listed when Chrome reports it destroyed', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    emit('Target.targetDestroyed', { targetId: 'A' });

    assert.equal(tracker.current()?.targetId, 'A');
  });

  void it('resolves an index, a target id and a URL part', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([
      page('POPUP1', 'http://a/oauth/authorize?client=1'),
      page('A', 'http://a/'),
    ]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    assert.equal(tracker.resolve('1').targetId, 'POPUP1');
    assert.equal(tracker.resolve('popup1').targetId, 'POPUP1');
    assert.equal(tracker.resolve('OAUTH').targetId, 'POPUP1');
  });

  void it('refuses an index out of range (81) and an ambiguous URL part (81)', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([page('B', 'http://a/two'), page('A', 'http://a/one')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    const outOfRange = thrown(() => tracker.resolve('5'));
    assert.equal(outOfRange.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(outOfRange.message, /Tab index 5 out of range \(2 tabs: 0-1\)/);
    assert.match(outOfRange.metadata.suggestion ?? '', /\[1\] http:\/\/a\/two/);

    const ambiguous = thrown(() => tracker.resolve('http://a/'));
    assert.equal(ambiguous.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(ambiguous.message, /matches 2 tabs/);
  });

  void it('names the closest URL part for one no tab contains (83)', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([page('P', 'http://a/popup.html'), page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    const error = thrown(() => tracker.resolve('popop'));

    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(error.message, /No tab URL contains "popop"/);
    assert.match(error.metadata.suggestion ?? '', /Did you mean: bdg page switch popup\?/);
    assert.match(error.metadata.suggestion ?? '', /\[1\] http:\/\/a\/popup\.html/);
  });

  void it('falls back to the opener, then the tab used before, then (when asked) any tab', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/'), page('Z', 'http://z/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);
    emit('Target.targetCreated', { targetInfo: page('P', 'http://a/popup', { openerId: 'A' }) });
    emit('Target.targetCreated', { targetInfo: page('Q', 'http://q/') });

    tracker.setCurrent('P');
    assert.equal(tracker.fallbackFor('P')?.targetId, 'A');
    tracker.setCurrent('Q');
    assert.equal(tracker.fallbackFor('Q')?.targetId, 'P', 'the tab used before');
    tracker.remove('P');
    tracker.remove('A');
    assert.equal(tracker.fallbackFor('Q'), undefined);
    assert.equal(tracker.fallbackFor('Q', true)?.targetId, 'Z');
  });

  void it('reports a switch after its tab closed once', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);
    emit('Target.targetCreated', { targetInfo: page('P', 'http://a/popup', { openerId: 'A' }) });
    tracker.setCurrent('P');

    tracker.remove('P');
    tracker.setCurrent('A');
    tracker.recordClosedSwitch('P', 'A');

    assert.deepEqual(tracker.takeClosedSwitch(), {
      tabClosed: { targetId: 'P', url: 'http://a/popup', title: 'P' },
      switchedTo: { index: 0, targetId: 'A', url: 'http://a/', title: 'A' },
    });
    assert.equal(tracker.takeClosedSwitch(), undefined);
  });

  void it('drops tabs that closed while it was attached elsewhere', async () => {
    const tracker = new TabTracker();
    const first = fakeSource([page('B', 'http://b/'), page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(first.source);

    const second = fakeSource([page('C', 'http://c/'), page('B', 'http://b/')]);
    tracker.setCurrent('B');
    tracker.setCurrent('B');
    await tracker.attach(second.source);

    assert.deepEqual(
      tracker.list().map((tab) => tab.targetId),
      ['B', 'C']
    );
    assert.equal(
      tracker.openedSince(0).length,
      0,
      'tabs found on attaching were not opened by an action'
    );
  });

  void it('does not list again a tab it saw close while Chrome still lists it', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([page('T', 'http://a/tab'), page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    tracker.remove('T');
    await tracker.refresh(source);

    assert.deepEqual(
      tracker.list().map((tab) => tab.targetId),
      ['A']
    );
  });

  void it('does not count a tab created after it closed as opened again', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);
    tracker.remove('T');

    emit('Target.targetCreated', { targetInfo: page('T', 'http://a/tab') });

    assert.equal(tracker.list().length, 1);
  });

  void it('stops listening when discovery fails, and leaves the session tab as it was', async () => {
    const tracker = new TabTracker();
    const { source, emit, failing } = fakeSource([page('A', 'http://a/')]);
    failing.add('Target.setDiscoverTargets');
    tracker.setCurrent('A');

    await assert.rejects(tracker.attach(source), /unavailable/);
    emit('Target.targetCreated', { targetInfo: page('P', 'http://a/popup') });

    assert.equal(tracker.openedCount(), 0, 'no listener left behind');
  });

  void it('attaching to a tab does not make it the session tab', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([page('B', 'http://b/'), page('A', 'http://a/')]);
    tracker.setCurrent('A');

    await tracker.attach(source);

    assert.equal(tracker.current()?.targetId, 'A');
  });

  void it('never falls back to the session tab Chrome reported closed, and drops it once left', async () => {
    const tracker = new TabTracker();
    const { source, emit } = fakeSource([page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);
    emit('Target.targetCreated', { targetInfo: page('P', 'http://a/popup', { openerId: 'A' }) });
    tracker.setCurrent('P');

    emit('Target.targetDestroyed', { targetId: 'P' });
    assert.equal(tracker.current()?.targetId, 'P', 'still the session tab until it moves');
    assert.equal(tracker.fallbackFor('A', true), undefined);
    tracker.setCurrent('A');

    assert.deepEqual(
      tracker.list().map((tab) => tab.targetId),
      ['A']
    );
  });

  void it('matches a URL part that is all digits with url:', async () => {
    const tracker = new TabTracker();
    const { source } = fakeSource([page('B', 'http://a:8080/'), page('A', 'http://a/')]);
    tracker.setCurrent('A');
    await tracker.attach(source);

    assert.equal(tracker.resolve('url:8080').targetId, 'B');
    assert.equal(thrown(() => tracker.resolve('8080')).exitCode, EXIT_CODES.INVALID_ARGUMENTS);
  });
});
