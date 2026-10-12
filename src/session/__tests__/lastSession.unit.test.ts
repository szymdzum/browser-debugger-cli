/**
 * How the last session ended is kept for `bdg status`.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { performSessionCleanup } from '@/session/cleanup/userCommands.js';
import {
  clearLastSessionEnd,
  readLastSessionEnd,
  writeLastSessionEnd,
} from '@/session/lastSession.js';
import { formatNoSessionMessage } from '@/ui/formatters/status.js';
import { endedSessionText } from '@/ui/messages/session.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-last-'));
const saved = process.env['BDG_SESSION_DIR'];
before(() => {
  process.env['BDG_SESSION_DIR'] = dir;
});
after(() => {
  if (saved === undefined) delete process.env['BDG_SESSION_DIR'];
  else process.env['BDG_SESSION_DIR'] = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

void describe('last session end', () => {
  void it('is written, read, shown and cleared', () => {
    writeLastSessionEnd('crash');
    const end = readLastSessionEnd();
    assert.equal(end?.reason, 'crash');
    assert.match(
      formatNoSessionMessage({ active: false, ...(end && { lastSession: end }) }),
      /The last session ended at .*: Chrome crashed/
    );
    clearLastSessionEnd();
    assert.equal(readLastSessionEnd(), null);
  });

  void it('says the connection to Chrome was lost and why, not that the page was closed', () => {
    writeLastSessionEnd('disconnected', 'message-too-large');
    const end = readLastSessionEnd();
    assert.equal(end?.reason, 'disconnected');
    assert.equal(end?.cause, 'message-too-large');
    const text = formatNoSessionMessage({ active: false, ...(end && { lastSession: end }) });
    assert.match(text, /lost its connection to Chrome \(a CDP message was over the size limit/);
    assert.doesNotMatch(text, /page was closed/);
    clearLastSessionEnd();
  });

  void it('lists a session whose Chrome stopped answering with why it ended', () => {
    assert.match(
      endedSessionText('p3', { reason: 'disconnected', cause: 'no-pong', endedAt: Date.now() }),
      /^p3 ended at .*: bdg lost its connection to Chrome \(Chrome stopped answering pings\); a Chrome bdg launched was closed with the session$/
    );
  });

  void it('counts the removed record of an ended session as cleaned', async () => {
    writeLastSessionEnd('crash');
    const { cleaned } = await performSessionCleanup({});
    assert.equal(cleaned.session, true);
    assert.equal(readLastSessionEnd(), null);
    assert.equal((await performSessionCleanup({})).cleaned.session, false);
  });

  void it('says a session is ending instead of pointing at its Chrome', () => {
    assert.match(
      formatNoSessionMessage({ active: false, ending: true, orphanedChromePid: 5 }),
      /is ending/
    );
  });
});
