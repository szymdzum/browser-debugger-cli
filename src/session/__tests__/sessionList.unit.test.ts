/**
 * `bdg sessions` shows page URLs without `user:pass@` and with secret-named
 * parameters masked (#623); `--include-sensitive` shows the parameters.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StatusResponseData } from '@/ipc/session/queries.js';
import { toRunningSession } from '@/session/sessionList.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';

const MASK = '••••';

/** A running session on a credentialed URL */
const ACTIVE: StatusResponseData = {
  daemonPid: 100,
  daemonStartTime: 1,
  socketPath: '/tmp/s/daemon.sock',
  sessionPid: 100,
  sessionMetadata: { bdgPid: 100, chromePid: 101, startTime: 1, port: 9222 },
  pageState: { url: 'http://bob:PW@127.0.0.1:4000/app?token=T&q=plain', title: 'App' },
};

/** A session still starting on a credentialed URL */
const STARTING: StatusResponseData = {
  daemonPid: 200,
  daemonStartTime: 1,
  socketPath: '/tmp/t/daemon.sock',
  starting: { url: 'http://bob:PW@127.0.0.1:4001/start#id_token=T', since: 1 },
};

void describe('toRunningSession page URLs (#623)', () => {
  void it('removes the user info and masks the tokens of an active session', () => {
    assert.equal(
      toRunningSession(null, ACTIVE).url,
      `http://127.0.0.1:4000/app?token=${MASK}&q=plain`
    );
  });

  void it('does the same for a starting session', () => {
    assert.equal(
      toRunningSession('t', STARTING).url,
      `http://127.0.0.1:4001/start#id_token=${MASK}`
    );
  });

  void it('shows the tokens but not the user info with --include-sensitive', () => {
    assert.equal(
      toRunningSession(null, ACTIVE, true).url,
      'http://127.0.0.1:4000/app?token=T&q=plain'
    );
    assert.equal(
      toRunningSession('t', STARTING, true).url,
      'http://127.0.0.1:4001/start#id_token=T'
    );
  });

  void it('the table shows the shown URL', () => {
    const output = formatSessionList({
      sessions: [toRunningSession(null, ACTIVE), toRunningSession('t', STARTING)],
    });
    assert.doesNotMatch(output, /PW|token=T/);
    assert.match(output, /token=••••&q=plain/);
    assert.match(output, /#id_token=••••/);
  });
});
