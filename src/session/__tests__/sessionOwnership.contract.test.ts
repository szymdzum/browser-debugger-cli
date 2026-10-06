/**
 * Two daemons in one session directory must not undo each other: a daemon
 * clears only its own Chrome PID and metadata, and cleanup finds every Chrome
 * launched for the directory, recorded or not.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { chromeSessionMarkerFlag } from '@/connection/launcher/flagsBuilder.js';
import { killSessionChromes, removeSessionFiles } from '@/session/cleanup/staleSession.js';
import { clearChromePid, writeChromePid } from '@/session/chrome.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { getSessionFilePath } from '@/session/paths.js';
import { isProcessAlive } from '@/utils/process.js';

void describe('session files of two daemons', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-owner-'));
    process.env['BDG_SESSION_DIR'] = dir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('clears a Chrome PID only while it still names that Chrome', () => {
    writeChromePid(process.pid);
    clearChromePid(process.pid + 1);
    assert.ok(fs.existsSync(getSessionFilePath('CHROME_PID')), "another daemon's PID is kept");
    clearChromePid(process.pid);
    assert.ok(!fs.existsSync(getSessionFilePath('CHROME_PID')));
  });

  void it('removes metadata only for the daemon that wrote it', () => {
    writeSessionMetadata({ bdgPid: process.pid + 1, startTime: Date.now(), port: 9222 });
    removeSessionFiles(process.pid);
    assert.ok(fs.existsSync(getSessionFilePath('METADATA')), "another daemon's metadata is kept");
    removeSessionFiles(process.pid + 1);
    assert.ok(!fs.existsSync(getSessionFilePath('METADATA')));
  });

  void it(
    'kills every process launched for the directory, recorded in chrome.pid or not',
    { skip: process.platform === 'win32' },
    async () => {
      const stray = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', '--', chromeSessionMarkerFlag(dir), '--headless=new'],
        { detached: true, stdio: 'ignore' }
      );
      const other = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', '--', chromeSessionMarkerFlag(`${dir} b`)],
        { detached: true, stdio: 'ignore' }
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const killed = killSessionChromes(dir);
        assert.deepEqual(killed, [stray.pid]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(isProcessAlive(stray.pid ?? 0), false);
        assert.equal(
          isProcessAlive(other.pid ?? 0),
          true,
          'a directory that only starts the same is left alone'
        );
      } finally {
        stray.kill('SIGKILL');
        other.kill('SIGKILL');
      }
    }
  );
});
