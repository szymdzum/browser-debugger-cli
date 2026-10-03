/**
 * Target mismatch unit tests.
 *
 * Exercises the start-request vs running-session target comparison used when
 * a second `bdg <url>` arrives while a session is running.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectTargetMismatch } from '@/daemon/session/targetMismatch.js';
import type { StartSessionRequest } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';

function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    bdgPid: 1000,
    startTime: Date.now(),
    port: 9222,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<StartSessionRequest> = {}): StartSessionRequest {
  return {
    type: 'start_session_request',
    sessionId: 'test',
    url: 'http://example.com',
    ...overrides,
  };
}

void describe('detectTargetMismatch', () => {
  void it('returns null when both sides are launched Chrome', () => {
    const result = detectTargetMismatch(
      baseRequest(),
      metadata({
        chromePid: 4242,
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/xyz',
      })
    );
    assert.equal(result, null);
  });

  void it('returns null when both sides share the same ws endpoint (attach mode)', () => {
    const ws = 'ws://127.0.0.1:9222/devtools/browser/abc';
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: ws }),
      metadata({ chromePid: 0, webSocketDebuggerUrl: ws })
    );
    assert.equal(result, null);
  });

  void it('returns null when user passes browser-level URL but metadata stored page-level', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://127.0.0.1:9222/devtools/browser/abc-uuid' }),
      metadata({
        chromePid: 0,
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/TARGET-ID-123',
      })
    );
    assert.equal(result, null, 'host:port match — page id differs harmlessly');
  });

  void it('flags mismatch when ws endpoints differ by host', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://host-a:9222/devtools/browser/abc' }),
      metadata({
        chromePid: 0,
        webSocketDebuggerUrl: 'ws://host-b:9222/devtools/browser/xyz',
      })
    );
    assert.ok(result, 'expected a mismatch result');
    assert.match(result.current ?? '', /host-b/);
    assert.match(result.requested ?? '', /host-a/);
  });

  void it('flags mismatch when ws endpoints differ by port', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://host:9222/devtools/browser/abc' }),
      metadata({
        chromePid: 0,
        webSocketDebuggerUrl: 'ws://host:9333/devtools/browser/abc',
      })
    );
    assert.ok(result);
  });

  void it('flags mismatch when attach-mode request collides with launched session', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://host:9222/devtools/browser/abc' }),
      metadata({ chromePid: 4242 })
    );
    assert.ok(result);
    assert.match(result.current ?? '', /launched/i);
  });

  void it('flags mismatch when launched request collides with attach-mode session', () => {
    const result = detectTargetMismatch(
      baseRequest(),
      metadata({
        chromePid: 0,
        webSocketDebuggerUrl: 'ws://host:9222/devtools/browser/abc',
      })
    );
    assert.ok(result);
    assert.match(result.requested ?? '', /launched/i);
  });
});
