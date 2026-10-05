/**
 * `bdg cleanup --purge` keeps the session directory while the session still
 * holds it (#321).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { purgeBlocker } from '@/commands/cleanup.js';

const saved = { dir: process.env['BDG_SESSION_DIR'], name: process.env['BDG_SESSION'] };
let base: string;

/**
 * Restore an environment variable.
 *
 * @param key - Variable name
 * @param value - Saved value
 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  base = fs.mkdtempSync('/tmp/bdg-321-purge-');
  process.env['BDG_SESSION_DIR'] = base;
  process.env['BDG_SESSION'] = 'p1';
  fs.mkdirSync(path.join(base, 'sessions', 'p1'), { recursive: true });
});

afterEach(() => {
  restoreEnv('BDG_SESSION_DIR', saved.dir);
  restoreEnv('BDG_SESSION', saved.name);
  fs.rmSync(base, { recursive: true, force: true });
});

void describe('purgeBlocker', () => {
  void it('allows purging a session with nothing left running', async () => {
    assert.equal(await purgeBlocker(null, []), null);
  });

  void it('refuses while the daemon still answers', async () => {
    const server = net.createServer((socket) => socket.end());
    const socketPath = path.join(base, 'sessions', 'p1', 'daemon.sock');
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const refusal = await purgeBlocker(null, []);
      assert.match(
        refusal?.message ?? '',
        /Not deleting .*sessions\/p1: its daemon is still running/
      );
      assert.match(refusal?.suggestion ?? '', /bdg cleanup --force --session p1/);
    } finally {
      server.close();
    }
  });

  void it('refuses when cleanup reported a problem', async () => {
    const refusal = await purgeBlocker(null, ['Could not kill daemon 1: EPERM']);
    assert.match(refusal?.message ?? '', /Could not kill daemon 1: EPERM/);
  });

  void it('refuses while the Chrome is still running, and allows it once it exited', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    const pid = child.pid ?? 0;
    try {
      const refusal = await purgeBlocker(pid, [], 100);
      assert.match(
        refusal?.message ?? '',
        new RegExp(`its Chrome \\(PID ${pid}\\) is still running`)
      );
    } finally {
      child.kill('SIGKILL');
    }
    assert.equal(await purgeBlocker(pid, [], 2000), null);
  });
});
