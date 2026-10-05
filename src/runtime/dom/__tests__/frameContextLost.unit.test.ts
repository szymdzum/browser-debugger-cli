/**
 * A frame whose script lost its context is reported as navigated, removed,
 * or closed with its page; a lost connection is not mistaken for any of them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CDPConnectionError, CDPProtocolError } from '@/connection/errors.js';
import { CommandError } from '@/errors/index.js';
import { frameContextLostError } from '@/runtime/dom/frames.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';

const FRAME = { frameId: 'F1', url: 'https://pay.example/' };

/**
 * A sender answering every command with `answer`.
 *
 * @param answer - Result or rejection of each command
 * @returns Sender
 */
function sender(answer: () => Promise<unknown>): CDPSender {
  const page: CDPSender = { send: () => answer() };
  return page;
}

const OPEN_PAGE = sender(() => Promise.resolve({ result: { value: 1 } }));

/**
 * The error message for a lost frame context.
 *
 * @param owner - Answer of `DOM.getFrameOwner`
 * @param page - The page's connection
 * @returns Message of the 83 error
 */
async function lostMessage(owner: () => Promise<unknown>, page = OPEN_PAGE): Promise<string> {
  const error = await frameContextLostError(sender(owner), page, FRAME);
  assert.ok(error instanceof CommandError);
  assert.equal(error.exitCode, 83);
  return error.message;
}

void describe('frameContextLostError', () => {
  void it('says the frame navigated when its iframe element is still there', async () => {
    const message = await lostMessage(() => Promise.resolve({ backendNodeId: 5 }));
    assert.match(message, /^The frame navigated while the script ran: https:\/\/pay\.example\//);
  });

  void it('says the frame was removed when Chrome no longer knows it', async () => {
    const gone = new CDPProtocolError('Frame with the given id was not found.', -32602, undefined);
    assert.match(await lostMessage(() => Promise.reject(gone)), /^The frame was removed/);
  });

  void it('says the page was closed when the page no longer answers', async () => {
    const closed = sender(() =>
      Promise.reject(new CDPProtocolError('Session with given id not found.', -32001, undefined))
    );
    const message = await lostMessage(() => Promise.resolve({}), closed);
    assert.match(message, /^The page was closed while the script ran/);
  });

  void it('passes on other errors instead of guessing', async () => {
    const lost = new CDPConnectionError('WebSocket closed');
    await assert.rejects(
      frameContextLostError(
        sender(() => Promise.reject(lost)),
        OPEN_PAGE,
        FRAME
      ),
      CDPConnectionError
    );
  });
});
