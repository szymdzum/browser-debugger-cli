/**
 * A failed start carries a suggestion with its error (#883): a target
 * mismatch says how to free the target, and a connection failure says where
 * the right WebSocket URL comes from.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';
import { attemptStart, type StartDeps, type StartOutcome } from '@/commands/shared/startHelpers.js';
import { IPCErrorCode } from '@/ipc/session/errors.js';
import type { StartSessionResponse } from '@/ipc/session/lifecycle.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const OPTIONS: SessionStartOptions = {
  port: undefined,
  timeout: undefined,
  userDataDir: undefined,
  includeAll: false,
  maxBodySize: undefined,
  headless: false,
  chromeWsUrl: 'ws://127.0.0.1:1/devtools/browser/x',
  quiet: true,
  chromeFlags: undefined,
};

/**
 * Start dependencies whose daemon answers with a failure.
 *
 * @param response - The daemon's answer
 * @returns Dependencies
 */
function deps(response: StartSessionResponse): StartDeps {
  return {
    launch: () => Promise.resolve(undefined),
    send: () => Promise.resolve(response),
    stop: () => Promise.resolve(),
    exitWaitMs: 1000,
  };
}

/**
 * The failed outcome of a start.
 *
 * @param response - The daemon's answer
 * @param options - Session options (default: a start that named the browser)
 * @returns The outcome, checked to be a failure
 */
async function failure(
  response: StartSessionResponse,
  options: SessionStartOptions = OPTIONS
): Promise<Extract<StartOutcome, { ok: false }>> {
  const outcome = await attemptStart(
    'ws://127.0.0.1:1/devtools/browser/x',
    options,
    [],
    deps(response)
  );
  if (outcome.ok) assert.fail('expected the start to fail');
  return outcome;
}

void describe('start failure suggestions', () => {
  void it('names bdg stop and named sessions for a target mismatch', async () => {
    const outcome = await failure({
      type: 'start_session_response',
      sessionId: 's',
      status: 'error',
      message:
        'Active session is attached to launched Chrome (bdg-managed), not ws://127.0.0.1:1/devtools/browser/x',
      errorCode: IPCErrorCode.SESSION_TARGET_MISMATCH,
      exitCode: EXIT_CODES.RESOURCE_CONFLICT,
      existingSession: { pid: 1 },
    });
    const suggestion = String(outcome.details?.['suggestion']);
    assert.match(suggestion, /bdg stop/);
    assert.match(suggestion, /--session/);
  });

  void it('says how to check the endpoint when the connection failed', async () => {
    const outcome = await failure({
      type: 'start_session_response',
      sessionId: 's',
      status: 'error',
      message: 'Failed to connect after 1 attempts: connect ECONNREFUSED 127.0.0.1:1',
      errorCode: IPCErrorCode.SESSION_START_FAILED,
      exitCode: EXIT_CODES.SESSION_START_FAILURE,
    });
    assert.match(String(outcome.details?.['suggestion']), /--remote-debugging-port/);
    assert.match(String(outcome.details?.['suggestion']), /\/json\/version/);
    assert.match(outcome.human, /\/json\/version/);
  });

  void it('leaves a launched browser without the endpoint suggestion', async () => {
    const outcome = await failure(
      {
        type: 'start_session_response',
        sessionId: 's',
        status: 'error',
        message: 'Failed to connect after 3 attempts: connect ECONNREFUSED 127.0.0.1:9222',
        errorCode: IPCErrorCode.SESSION_START_FAILED,
        exitCode: EXIT_CODES.SESSION_START_FAILURE,
      },
      { ...OPTIONS, chromeWsUrl: undefined }
    );
    assert.equal(outcome.details?.['suggestion'], undefined);
    assert.doesNotMatch(outcome.human, /json\/version/);
  });

  void it('keeps the daemon hint when the message has one', async () => {
    const outcome = await failure({
      type: 'start_session_response',
      sessionId: 's',
      status: 'error',
      message: 'Chrome failed to start\nInstall Chrome or pass --chrome-ws-url',
      errorCode: IPCErrorCode.SESSION_START_FAILED,
      exitCode: EXIT_CODES.SESSION_START_FAILURE,
    });
    assert.equal(outcome.details?.['suggestion'], 'Install Chrome or pass --chrome-ws-url');
    assert.doesNotMatch(String(outcome.details?.['suggestion']), /json\/version/);
  });
});
