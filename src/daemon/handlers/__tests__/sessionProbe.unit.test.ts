/**
 * Session Probe Unit Tests
 *
 * Exercises the liveness probe, CDP endpoint extraction, and target-mismatch
 * detection helpers that back `handleStartSession`.
 *
 * Testing philosophy:
 * - Test BEHAVIOR: "probe reports dead when Chrome is unreachable"
 * - Mock the BOUNDARY: `global.fetch` (HTTP call inside fetchCDPTargets)
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  detectTargetMismatch,
  extractCdpEndpoint,
  probeSessionAlive,
} from '@/daemon/handlers/sessionProbe.js';
import type { StartSessionRequest } from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';

const silentLogger = {
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  verbose: () => undefined,
  success: () => undefined,
} as unknown as Parameters<typeof probeSessionAlive>[1];

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

void describe('extractCdpEndpoint', () => {
  void it('parses host and port from webSocketDebuggerUrl when present', () => {
    const result = extractCdpEndpoint(
      metadata({ webSocketDebuggerUrl: 'ws://10.0.0.5:9333/devtools/browser/abc' })
    );
    assert.equal(result.host, '10.0.0.5');
    assert.equal(result.port, 9333);
  });

  void it('falls back to metadata.port when ws URL has no port component', () => {
    const result = extractCdpEndpoint(
      metadata({
        webSocketDebuggerUrl: 'ws://example.local/devtools/browser/abc',
        port: 9222,
      })
    );
    assert.equal(result.host, 'example.local');
    assert.equal(result.port, 9222);
  });

  void it('defaults to localhost+metadata.port when no ws URL stored (launched Chrome)', () => {
    const result = extractCdpEndpoint(metadata({ port: 9500 }));
    assert.equal(result.host, '127.0.0.1');
    assert.equal(result.port, 9500);
  });

  void it('falls back gracefully when webSocketDebuggerUrl is malformed', () => {
    const result = extractCdpEndpoint(metadata({ webSocketDebuggerUrl: 'not-a-url', port: 9222 }));
    assert.equal(result.host, '127.0.0.1');
    assert.equal(result.port, 9222);
  });
});

void describe('probeSessionAlive', () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = mock.fn(global.fetch);
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  void it('reports not-alive when metadata is null', async () => {
    const result = await probeSessionAlive(null, silentLogger);
    assert.equal(result.alive, false);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  void it('reports alive and returns targetUrl when Chrome responds', async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'tgt-1', title: 't', url: 'http://app.test', webSocketDebuggerUrl: 'ws://x' },
          ]),
      })
    );

    const result = await probeSessionAlive(
      metadata({ port: 9222, targetId: 'tgt-1' }),
      silentLogger
    );
    assert.equal(result.alive, true);
    assert.equal(result.targetUrl, 'http://app.test');
  });

  void it('reports not-alive after retry when Chrome returns empty targets', async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    );

    const result = await probeSessionAlive(metadata({ port: 9222 }), silentLogger);
    assert.equal(result.alive, false);
    assert.equal(fetchMock.mock.callCount(), 2, 'probe retries once on empty response');
  });

  void it('reports not-alive when the HTTP endpoint rejects', async () => {
    fetchMock.mock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));

    const result = await probeSessionAlive(metadata({ port: 9222 }), silentLogger);
    assert.equal(result.alive, false);
  });

  void it('uses ws URL host when probing external Chrome', async () => {
    let requestedUrl = '';
    fetchMock.mock.mockImplementation((url: string) => {
      requestedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'x', title: 't', url: 'http://y', webSocketDebuggerUrl: 'ws://y' },
          ]),
      });
    });

    await probeSessionAlive(
      metadata({ webSocketDebuggerUrl: 'ws://10.1.2.3:9222/devtools/browser/abc' }),
      silentLogger
    );

    assert.ok(
      requestedUrl.includes('10.1.2.3'),
      `expected host 10.1.2.3 in URL, got ${requestedUrl}`
    );
    assert.ok(requestedUrl.includes(':9222'));
  });
});

void describe('detectTargetMismatch', () => {
  void it('returns null when both sides are launched Chrome', () => {
    const result = detectTargetMismatch(baseRequest(), metadata());
    assert.equal(result, null);
  });

  void it('returns null when both sides share the same ws URL', () => {
    const ws = 'ws://127.0.0.1:9222/devtools/browser/abc';
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: ws }),
      metadata({ webSocketDebuggerUrl: ws })
    );
    assert.equal(result, null);
  });

  void it('returns null when ws URLs differ only by trailing slash', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://127.0.0.1:9222/devtools/browser/abc/' }),
      metadata({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    );
    assert.equal(result, null);
  });

  void it('flags mismatch when ws URLs differ meaningfully', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://host-a:9222/devtools/browser/abc' }),
      metadata({ webSocketDebuggerUrl: 'ws://host-b:9222/devtools/browser/xyz' })
    );
    assert.ok(result, 'expected a mismatch result');
    assert.match(result.current ?? '', /host-b/);
    assert.match(result.requested ?? '', /host-a/);
  });

  void it('flags mismatch when attach-mode request collides with launched session', () => {
    const result = detectTargetMismatch(
      baseRequest({ chromeWsUrl: 'ws://host:9222/devtools/browser/abc' }),
      metadata()
    );
    assert.ok(result);
    assert.match(result.current ?? '', /launched/i);
  });

  void it('flags mismatch when launched request collides with attach-mode session', () => {
    const result = detectTargetMismatch(
      baseRequest(),
      metadata({ webSocketDebuggerUrl: 'ws://host:9222/devtools/browser/abc' })
    );
    assert.ok(result);
    assert.match(result.requested ?? '', /launched/i);
  });
});
