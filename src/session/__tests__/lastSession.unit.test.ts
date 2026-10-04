/**
 * How the last session ended is kept for `bdg status`.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  clearLastSessionEnd,
  readLastSessionEnd,
  writeLastSessionEnd,
} from '@/session/lastSession.js';
import { formatNoSessionMessage } from '@/ui/formatters/status.js';

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

  void it('says a session is ending instead of pointing at its Chrome', () => {
    assert.match(
      formatNoSessionMessage({ active: false, ending: true, orphanedChromePid: 5 }),
      /is ending/
    );
  });
});
