/**
 * Hints and errors of a named session carry `--session <name>` (#321), so
 * following them never acts on the default session.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  alreadyRunningSuggestion,
  chromeInUseBySessionError,
  daemonNotRunningError,
  externalBrowserIdMismatchError,
  sessionAlreadyRunningError,
  sessionAlreadyRunningMessage,
  sessionUnavailableSuggestion,
} from '@/errors/messages.js';
import { formatSessionStatus } from '@/ui/formatters/status.js';
import { portInUseError } from '@/ui/messages/chrome.js';
import { verboseCommandsMessage } from '@/ui/messages/preview.js';
import {
  noActiveSessionMessage,
  sessionCommand,
  startSessionSuggestion,
} from '@/ui/messages/sessionCommand.js';

const saved = { name: process.env['BDG_SESSION'], dir: process.env['BDG_SESSION_DIR'] };

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
  process.env['BDG_SESSION_DIR'] = '/tmp/bdg-321-base';
  delete process.env['BDG_SESSION'];
});

afterEach(() => {
  restoreEnv('BDG_SESSION', saved.name);
  restoreEnv('BDG_SESSION_DIR', saved.dir);
});

void describe('sessionCommand', () => {
  void it('leaves commands of the default session unchanged', () => {
    assert.equal(sessionCommand('bdg stop'), 'bdg stop');
    assert.equal(noActiveSessionMessage(), 'No active session');
    assert.equal(startSessionSuggestion(), 'Start a session with: bdg <url>');
  });

  void it('appends --session for the selected named session', () => {
    process.env['BDG_SESSION'] = 'Agent-1';
    assert.equal(sessionCommand('bdg stop'), 'bdg stop --session agent-1');
    assert.equal(noActiveSessionMessage(), 'No active session "agent-1"');
    assert.equal(startSessionSuggestion(), 'Start a session with: bdg <url> --session agent-1');
  });

  void it('takes an explicit session over the selected one', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    assert.equal(sessionCommand('bdg cleanup', 'other'), 'bdg cleanup --session other');
    assert.equal(sessionCommand('bdg cleanup', null), 'bdg cleanup');
  });
});

void describe('session-scoped messages', () => {
  void it('scope every command of a named session', () => {
    process.env['BDG_SESSION'] = 'alpha';
    const texts = [
      alreadyRunningSuggestion(),
      sessionAlreadyRunningError(1, 1000, 'http://a/'),
      sessionAlreadyRunningMessage(1),
      daemonNotRunningError({ suggestStatus: true }),
      sessionUnavailableSuggestion(83),
      sessionUnavailableSuggestion(85),
      externalBrowserIdMismatchError('http://127.0.0.1:9222', 'ws://x/devtools/browser/1')
        .suggestion,
      verboseCommandsMessage(),
    ];
    for (const text of texts) {
      const commands = text.match(/bdg (?:stop|status|cleanup|peek|tail|<url>)[^\n,;)&]*/g) ?? [];
      assert.ok(commands.length > 0, text);
      for (const command of commands) assert.match(command, /--session alpha/, text);
    }
    assert.match(daemonNotRunningError(), /No active session "alpha"/);
    assert.match(sessionAlreadyRunningMessage(1), /^Session "alpha" already running/);
  });

  void it('never suggests a command for the default session when a port is busy', () => {
    process.env['BDG_SESSION'] = 'busy';
    const text = portInUseError(9930);
    assert.match(text, /bdg <url> --port 9931 --session busy/);
    const commands = text.match(/bdg (?:cleanup|stop)[^\n()]*/g) ?? [];
    assert.ok(commands.length > 0, text);
    for (const command of commands) assert.match(command, /--session/, text);
  });

  void it('scope the status hints to the session shown', () => {
    const text = formatSessionStatus(
      { bdgPid: 1, startTime: Date.now(), port: 9223 },
      process.pid,
      undefined,
      undefined,
      false,
      'beta'
    );
    assert.match(text, /bdg peek --session beta/);
    assert.match(text, /bdg stop --session beta/);
  });
});

void describe('chromeInUseBySessionError', () => {
  void it('names the other session and how to reach it', () => {
    const err = chromeInUseBySessionError('http://127.0.0.1:9901', {
      name: 'alpha',
      dir: '/tmp/bdg-321-base/sessions/alpha',
      baseDir: '/tmp/bdg-321-base',
      launched: true,
    });
    assert.match(err.message, /was launched by bdg session "alpha"/);
    assert.match(err.suggestion, /bdg stop --session alpha/);
    assert.doesNotMatch(err.suggestion, /BDG_SESSION_DIR=/);
  });

  void it('adds BDG_SESSION_DIR for a session of another base directory', () => {
    const err = chromeInUseBySessionError('http://127.0.0.1:9930', {
      name: null,
      dir: '/tmp/elsewhere',
      baseDir: '/tmp/elsewhere',
      launched: false,
    });
    assert.match(err.message, /tab driven by the default bdg session/);
    assert.match(err.suggestion, /BDG_SESSION_DIR=\/tmp\/elsewhere bdg stop\)/);
  });
});
