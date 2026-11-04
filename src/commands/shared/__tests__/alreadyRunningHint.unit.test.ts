/**
 * `bdg <url>` against a running session hints at `bdg page navigate <url>`;
 * `bdg attach <tab>` (which opens no URL) does not (#902).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';
import { attemptStart, type StartDeps } from '@/commands/shared/startHelpers.js';
import { IPCErrorCode } from '@/ipc/session/errors.js';
import type { StartSessionResponse } from '@/ipc/session/lifecycle.js';

const RUNNING: StartSessionResponse = {
  type: 'start_session_response',
  sessionId: 's',
  status: 'error',
  message: 'Session already running (PID 7)',
  errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
  exitCode: 84,
  existingSession: { pid: 7, targetUrl: 'http://a.test/', duration: 2 },
};

const DEPS: StartDeps = {
  launch: () => Promise.resolve(undefined),
  send: () => Promise.resolve(RUNNING),
  stop: () => Promise.resolve(),
  exitWaitMs: 0,
};

const OPTIONS: SessionStartOptions = {
  port: undefined,
  timeout: undefined,
  userDataDir: undefined,
  includeAll: false,
  maxBodySize: undefined,
  headless: true,
  chromeWsUrl: undefined,
  quiet: true,
  chromeFlags: undefined,
};

/**
 * The failed outcome of a start against the running session.
 *
 * @param url - URL as given
 * @param options - Session options
 * @returns Suggestion and human text
 */
async function refused(
  url: string,
  options: SessionStartOptions
): Promise<{ suggestion: string; human: string }> {
  const outcome = await attemptStart(url, options, [], DEPS);
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error('unreachable');
  return { suggestion: String(outcome.details?.['suggestion']), human: outcome.human };
}

void describe('already running hint', () => {
  void it('names bdg page navigate with the URL given for bdg <url>', async () => {
    const { suggestion, human } = await refused('http://user:pw@b.test/p?token=s3cret', OPTIONS);
    for (const text of [suggestion, human]) {
      assert.match(
        text,
        /bdg page navigate <the URL you gave> \(secrets in it are not shown here\)/
      );
      assert.doesNotMatch(text, /pw@|s3cret/);
    }
  });

  void it('does not name it for bdg attach (no URL is opened)', async () => {
    const { suggestion, human } = await refused('ws://127.0.0.1:9/devtools/browser/x', {
      ...OPTIONS,
      chromeWsUrl: 'ws://127.0.0.1:9/devtools/browser/x',
      attachTab: 'docs',
    });
    assert.doesNotMatch(suggestion, /page navigate/);
    assert.doesNotMatch(human, /page navigate/);
    assert.match(suggestion, /bdg status/);
  });
});
