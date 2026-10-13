/**
 * A daemon reply the client cannot buffer ends the command with a clear
 * error (exit 81), not a timeout or an uncaught exception (#712).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { MAX_JSONL_BUFFER_SIZE } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { chromeReplyLostError, replyTooLargeError } from '@/errors/messages.js';
import { formatReplyOverflowError } from '@/ipc/transport/errors.js';
import { sendRequest } from '@/ipc/transport/index.js';
import { JSONLBufferOverflowError } from '@/ipc/transport/jsonl.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const MIB = 1024 * 1024;

void describe('replyTooLargeError', () => {
  void it('names the size in MiB with one decimal and the limit', () => {
    const err = replyTooLargeError(300 * MIB, MAX_JSONL_BUFFER_SIZE, 'cdp_call_request');
    assert.match(err.message, /300\.0 MiB/);
    assert.match(err.message, /256 MiB/);
  });

  void it('tells a cdp call to slice in the expression or read a smaller property', () => {
    const err = replyTooLargeError(300 * MIB, MAX_JSONL_BUFFER_SIZE, 'cdp_call_request');
    assert.match(err.suggestion, /slice/);
    assert.match(err.suggestion, /returnByValue/);
  });

  void it('gives other commands a hint that does not name cdp parameters', () => {
    const err = replyTooLargeError(300 * MIB, MAX_JSONL_BUFFER_SIZE, 'har_data_request');
    assert.ok(err.suggestion.length > 0);
    assert.doesNotMatch(err.suggestion, /returnByValue/);
  });

  void it('says "stopped at" when only a part of the reply was read', () => {
    const err = replyTooLargeError(257 * MIB, MAX_JSONL_BUFFER_SIZE, 'dom_eval_request', false);
    assert.match(err.message, /257\.0 MiB/);
    assert.match(err.message, /stopped/);
  });
});

void describe('chromeReplyLostError', () => {
  void it("blames Chrome's message limit, not the character count, and gives the hint", () => {
    const err = chromeReplyLostError(MAX_JSONL_BUFFER_SIZE);
    assert.match(err.message, /Chrome could not send the reply/);
    assert.match(err.message, /about 256 MiB of UTF-8 bytes/);
    assert.match(err.message, /non-ASCII/);
    assert.match(err.suggestion, /returnByValue/);
  });
});

void describe('formatReplyOverflowError', () => {
  void it('is a CommandError with exit 81, the size and a hint', () => {
    const error = formatReplyOverflowError(
      new JSONLBufferOverflowError(257 * MIB, MAX_JSONL_BUFFER_SIZE),
      'cdp_call_request'
    );
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, /257\.0 MiB/);
    assert.match(error.message, /256 MiB/);
    assert.ok(error.metadata.suggestion);
  });
});

void describe('sendRequest against a daemon that sends more than the cap', () => {
  let dir: string;
  let server: net.Server;
  let socketPath: string;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-overflow-'));
    socketPath = path.join(dir, 'd.sock');
    server = net.createServer((socket) => {
      socket.on('error', () => undefined);
      socket.on('data', () => {
        const chunk = 'x'.repeat(8 * MIB);
        for (let sent = 0; sent <= MAX_JSONL_BUFFER_SIZE; sent += chunk.length) {
          socket.write(chunk);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  void it('rejects with exit 81 and the size, long before the timeout', async () => {
    const started = Date.now();
    await assert.rejects(
      sendRequest(
        { type: 'cdp_call_request', sessionId: 's-1' },
        'cdp_call',
        undefined,
        15_000,
        socketPath
      ),
      (error: unknown) => {
        assert.ok(error instanceof CommandError, String(error));
        assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
        assert.match(error.message, /MiB/);
        return true;
      }
    );
    assert.ok(Date.now() - started < 10_000);
  });
});
