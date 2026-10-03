/**
 * Session state contract tests: socket liveness, single-instance daemon
 * socket, PID file parsing, and crash leftovers cleanup.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { chromeSessionMarkerFlag } from '@/connection/launcher/flagsBuilder.js';
import { DAEMON_ALREADY_RUNNING_CODE, SocketServer } from '@/daemon/server/SocketServer.js';
import {
  killOrphanedChrome,
  readLiveDaemonPid,
  removeStaleDaemonFiles,
} from '@/session/cleanup/staleSession.js';
import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { getProcessCommand, isProcessAlive } from '@/utils/process.js';

/**
 * Create a stale Unix socket file (bound, then abandoned without unlink).
 *
 * @param socketPath - Path for the stale socket
 */
async function createStaleSocket(socketPath: string): Promise<void> {
  const child = spawn(process.execPath, [
    '-e',
    `require('net').createServer().listen(${JSON.stringify(socketPath)}, () => process.kill(process.pid, 'SIGKILL'))`,
  ]);
  await new Promise((resolve) => child.once('exit', resolve));
  assert.ok(fs.existsSync(socketPath), 'stale socket file should remain after SIGKILL');
}

void describe('Session state contract', () => {
  /**
   * Spawn a long-running node process with extra argv entries (visible to ps).
   *
   * @param args - Extra arguments
   * @returns Child process with a pid
   */
  function spawnWithArgs(args: string[]): ChildProcess & { pid: number } {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', ...args]);
    children.push(child);
    assert.ok(child.pid);
    return child as ChildProcess & { pid: number };
  }

  /**
   * Wait until ps shows the given text in a process's command line.
   *
   * @param pid - Process ID
   * @param text - Expected substring
   */
  async function waitForCommand(pid: number, text: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (getProcessCommand(pid)?.includes(text)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`process ${pid} never showed ${text}`);
  }

  let testDir: string;
  const servers: SocketServer[] = [];
  const children: ChildProcess[] = [];

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-state-'));
    process.env['BDG_SESSION_DIR'] = testDir;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
    children.splice(0).forEach((c) => c.kill('SIGKILL'));
    delete process.env['BDG_SESSION_DIR'];
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  void describe('probeDaemonSocket', () => {
    void it('reports absent when there is no socket file', async () => {
      assert.equal(await probeDaemonSocket(), 'absent');
    });

    void it('reports alive when a server is listening', async () => {
      const server = new SocketServer();
      servers.push(server);
      await server.start(getSessionFilePath('DAEMON_SOCKET'), (s) => s.end());
      assert.equal(await probeDaemonSocket(), 'alive');
    });

    void it('reports stale when the socket file has no listener', async () => {
      await createStaleSocket(getSessionFilePath('DAEMON_SOCKET'));
      assert.equal(await probeDaemonSocket(), 'stale');
    });
  });

  void describe('SocketServer single instance', () => {
    void it('refuses to start when a live server owns the path', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const first = new SocketServer();
      servers.push(first);
      await first.start(socketPath, (s) => s.end());

      const second = new SocketServer();
      await assert.rejects(
        second.start(socketPath, (s) => s.end()),
        {
          code: DAEMON_ALREADY_RUNNING_CODE,
        }
      );
      assert.equal(await probeDaemonSocket(), 'alive', 'first server must keep its socket');
    });

    void it('replaces a stale socket file', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await createStaleSocket(socketPath);

      const server = new SocketServer();
      servers.push(server);
      await server.start(socketPath, (s) => s.end());
      assert.equal(await probeDaemonSocket(), 'alive');
    });

    void it('does not remove a socket that another server has since claimed', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const first = new SocketServer();
      await first.start(socketPath, (s) => s.end());
      fs.unlinkSync(socketPath);

      const second = new SocketServer();
      servers.push(second);
      await second.start(socketPath, (s) => s.end());
      await first.stop();

      assert.equal(await probeDaemonSocket(), 'alive', "second server's socket must survive");
    });

    void it('removes its socket file on stop', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const server = new SocketServer();
      await server.start(socketPath, (s) => s.end());
      await server.stop();
      assert.equal(fs.existsSync(socketPath), false);
    });
  });

  void describe('readPidFromFile', () => {
    for (const content of ['0', '-1', '12abc', '', '1.5']) {
      void it(`rejects ${JSON.stringify(content)}`, () => {
        const file = path.join(testDir, 'x.pid');
        fs.writeFileSync(file, content);
        assert.equal(readPidFromFile(file), null);
      });
    }

    void it('accepts a positive integer', () => {
      const file = path.join(testDir, 'x.pid');
      fs.writeFileSync(file, '4242\n');
      assert.equal(readPidFromFile(file), 4242);
    });
  });

  void describe('crash leftovers', () => {
    void it('does not kill a process that is not a bdg Chrome', () => {
      const child = spawn('sleep', ['30']);
      children.push(child);
      assert.ok(child.pid);
      fs.writeFileSync(getSessionFilePath('CHROME_PID'), String(child.pid));

      assert.equal(killOrphanedChrome(), false);
      assert.equal(isProcessAlive(child.pid), true, 'unrelated process must survive');
      assert.equal(fs.existsSync(getSessionFilePath('CHROME_PID')), false);
    });

    void it('kills a process carrying this session marker', async () => {
      const child = spawnWithArgs([chromeSessionMarkerFlag(testDir)]);
      fs.writeFileSync(getSessionFilePath('CHROME_PID'), String(child.pid));
      await waitForCommand(child.pid, chromeSessionMarkerFlag(testDir));

      assert.equal(killOrphanedChrome(), true);
      await new Promise((resolve) => child.once('exit', resolve));
      assert.equal(isProcessAlive(child.pid), false);
    });

    void it('does not kill a process whose marker is only a prefix match', async () => {
      const child = spawnWithArgs([chromeSessionMarkerFlag(`${testDir}-other`)]);
      fs.writeFileSync(getSessionFilePath('CHROME_PID'), String(child.pid));
      await waitForCommand(child.pid, `${testDir}-other`);

      assert.equal(killOrphanedChrome(), false);
      assert.equal(isProcessAlive(child.pid), true, 'process for another session must survive');
    });

    void it('ignores a daemon.pid that does not belong to a bdg daemon', () => {
      fs.writeFileSync(getSessionFilePath('DAEMON_PID'), String(process.pid));
      assert.equal(readLiveDaemonPid(), null);
    });

    void it('removes daemon and session files when no daemon is listening', async () => {
      await createStaleSocket(getSessionFilePath('DAEMON_SOCKET'));
      fs.writeFileSync(getSessionFilePath('DAEMON_PID'), '999999');
      fs.writeFileSync(getSessionFilePath('METADATA'), '{}');

      assert.equal(await removeStaleDaemonFiles(), true);
      for (const file of ['DAEMON_SOCKET', 'DAEMON_PID', 'METADATA'] as const) {
        assert.equal(fs.existsSync(getSessionFilePath(file)), false, `${file} should be removed`);
      }
    });

    void it('leaves files alone while a daemon is listening', async () => {
      const server = new SocketServer();
      servers.push(server);
      await server.start(getSessionFilePath('DAEMON_SOCKET'), (s) => s.end());
      fs.writeFileSync(getSessionFilePath('METADATA'), '{}');

      assert.equal(await removeStaleDaemonFiles(), false);
      assert.equal(fs.existsSync(getSessionFilePath('METADATA')), true);
    });
  });
});
