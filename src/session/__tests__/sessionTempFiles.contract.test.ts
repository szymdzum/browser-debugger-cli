/**
 * A SIGKILL between an atomic write and its rename leaves `<name>.<pid>.<uuid>.tmp`
 * behind. Removing the session files must remove those leftovers too, and leave
 * unrelated files alone (browser-debugger-cli#636).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { removeSessionFiles } from '@/session/cleanup/staleSession.js';
import { getSessionFilePath } from '@/session/paths.js';

void describe('removeSessionFiles and atomic-write leftovers', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-tmp-'));
    process.env['BDG_SESSION_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('removes temp files left next to the query cache and metadata', () => {
    const cachePath = QueryCacheManager.getInstance().getCachePath();
    const metadataPath = getSessionFilePath('METADATA');
    const leftovers = [
      `${cachePath}.4242.0f3c9a1e-1111-4222-8333-444455556666.tmp`,
      `${metadataPath}.4242.0f3c9a1e-7777-4888-8999-aaaabbbbcccc.tmp`,
    ];
    const unrelated = path.join(dir, 'notes.txt');
    for (const file of [...leftovers, unrelated]) fs.writeFileSync(file, 'x');

    removeSessionFiles();

    for (const file of leftovers)
      assert.ok(!fs.existsSync(file), `${path.basename(file)} is removed`);
    assert.ok(fs.existsSync(unrelated), 'unrelated files are kept');
  });
});
