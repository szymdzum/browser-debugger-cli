import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { describe, it } from 'node:test';

import { resolveDaemonEntryPoint, waitForSocket } from '@/cli/commands/ipcTest.js';

void describe('ipc-test command helpers', () => {
  void it('resolveDaemonEntryPoint returns an absolute daemon.js path', () => {
    const entryPoint = resolveDaemonEntryPoint();
    assert.equal(isAbsolute(entryPoint), true);
    assert.equal(entryPoint.endsWith('daemon.js'), true);
  });

  void it('waitForSocket resolves once the socket is accepting connections', async () => {
    const socketPath = join(tmpdir(), `ipc-test-${randomUUID()}.sock`);
    const server = createServer();

    setTimeout(() => {
      server.listen(socketPath);
    }, 100);

    await waitForSocket(socketPath, { timeoutMs: 2_000, pollIntervalMs: 50 });

    await new Promise<void>((resolve) =>
      server.close(() => {
        try {
          unlinkSync(socketPath);
        } catch {
          // Ignore if already removed
        }
        resolve();
      })
    );
  });

  void it('waitForSocket rejects if the socket never becomes available', async () => {
    const socketPath = join(tmpdir(), `ipc-test-${randomUUID()}.sock`);

    await assert.rejects(
      waitForSocket(socketPath, { timeoutMs: 200, pollIntervalMs: 50 }),
      /not ready within/i
    );
  });
});
