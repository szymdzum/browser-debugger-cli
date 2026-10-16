/**
 * Which stops count as a cancelled start (#801): only a user stop before the
 * session started gets the cancelled start's quick Chrome kill; a crash or a
 * lost connection during the start keeps the graceful shutdown.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Session, type SessionEndReason } from '@/daemon/session/Session.js';

/**
 * Stop a session that was never launched and read whether its teardown
 * treats it as a cancelled start.
 *
 * @param reason - Why the session ends
 * @returns Whether the start counts as cancelled
 */
async function cancelledAfter(reason: SessionEndReason): Promise<boolean> {
  const session = Session.create('http://127.0.0.1:47802/', {}, () => undefined);
  await session.stop(reason);
  return (session as unknown as { startCancelled(): boolean }).startCancelled();
}

void describe('Session start cancelled', () => {
  void it('a user stop during the start cancels it', async () => {
    assert.equal(await cancelledAfter('normal'), true);
  });

  for (const reason of ['crash', 'disconnected', 'closed', 'timeout'] as const) {
    void it(`a ${reason} end during the start keeps the graceful shutdown`, async () => {
      assert.equal(await cancelledAfter(reason), false);
    });
  }
});
