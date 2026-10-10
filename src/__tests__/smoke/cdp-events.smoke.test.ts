/**
 * CDP event collection smoke test (#452), against a real session.
 *
 * - `Tracing.end` with `--collect`, `--until` and `--out` writes the trace
 *   as NDJSON, which the documented one-liner turns into `{ traceEvents }`;
 * - `Fetch.enable --listen Fetch.requestPaused`: the paused request's id is
 *   read with `--events` and the request fulfilled with a 500 and a body;
 * - a collection whose `--until` event never comes returns `complete: false`
 *   (exit 0), not an error;
 * - a typo of an event name exits 81 with the bundled event suggested;
 * - the buffer ends with the session.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import type { CdpEventRecord } from '@/ipc/protocol/cdpEventTypes.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

/**
 * Run `bdg cdp <args> --json` and parse the envelope.
 *
 * @param args - Arguments after `cdp`
 * @returns Exit code and envelope
 */
async function cdp<T = Record<string, unknown>>(
  args: string[]
): Promise<{ exitCode: number; body: Envelope<T>; stderr: string }> {
  const result = await runCommand('cdp', [...args, '--json'], { timeout: 60000 });
  return {
    exitCode: result.exitCode,
    body: JSON.parse(result.stdout) as Envelope<T>,
    stderr: result.stderr,
  };
}

/**
 * Run `bdg dom eval <script> --json` and return its result.
 *
 * @param script - Expression
 * @returns The evaluated value
 */
async function evaluate(script: string): Promise<unknown> {
  const result = await runCommand('dom', ['eval', script, '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 0, result.stderr);
  return (JSON.parse(result.stdout) as { data: { result: unknown } }).data.result;
}

/**
 * Start a headless session on the fixture page.
 *
 * @param url - Page URL
 */
async function startSession(url: string): Promise<void> {
  const port = String(await getFreePort());
  const started = await runCommand(url, ['--port', port, '--headless'], { timeout: 60000 });
  assert.equal(started.exitCode, 0, started.stderr);
}

void describe('bdg cdp events', () => {
  let fixture: FixtureServer;
  let outDir: string;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-cdp-events-'));
    await startSession(fixture.url);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  void it('collects a trace to NDJSON that converts to { traceEvents }', async () => {
    const started = await cdp(['Tracing.start']);
    assert.equal(started.exitCode, 0, started.stderr);
    await evaluate(
      "document.body.append(Object.assign(document.createElement('p'), { textContent: 'traced' })); 1"
    );
    const file = path.join(outDir, 'trace.ndjson');
    const ended = await cdp<{ file: string; count: number; bytes: number; complete: boolean }>([
      'Tracing.end',
      '--collect',
      'Tracing.dataCollected',
      '--until',
      'Tracing.tracingComplete',
      '--out',
      file,
    ]);
    assert.equal(ended.exitCode, 0, ended.stderr);
    assert.equal(ended.body.data.complete, true);
    assert.equal(ended.body.data.file, file);
    assert.equal(ended.body.data.bytes, fs.statSync(file).size);

    const lines = fs
      .readFileSync(file, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as CdpEventRecord);
    assert.equal(lines.length, ended.body.data.count);
    assert.equal(lines.at(-1)?.method, 'Tracing.tracingComplete');
    const traceEvents = lines
      .filter((line) => line.method === 'Tracing.dataCollected')
      .flatMap((line) => (line.params as { value: unknown[] }).value);
    assert.ok(traceEvents.length > 0, 'the trace has events');
  });

  void it('reads a paused request from the buffer and fulfills it with a 500', async () => {
    const enabled = await cdp<{ listening: string[] }>([
      'Fetch.enable',
      '--params',
      JSON.stringify({ patterns: [{ urlPattern: '*api/test*' }] }),
      '--listen',
      'Fetch.requestPaused',
    ]);
    assert.equal(enabled.exitCode, 0, enabled.stderr);
    assert.deepEqual(enabled.body.data.listening, ['Fetch.requestPaused']);

    await evaluate(
      "window.__answer = fetch('/api/test').then(async (r) => r.status + ' ' + (await r.text())); 1"
    );
    const read = await cdp<{ events: CdpEventRecord[]; count: number }>([
      '--events',
      'Fetch.requestPaused',
      '--wait',
      '20',
    ]);
    assert.equal(read.exitCode, 0, read.stderr);
    assert.equal(read.body.data.count, 1);
    const paused = read.body.data.events[0]?.params as {
      requestId: string;
      request: { url: string };
    };
    assert.match(paused.request.url, /\/api\/test$/);

    const fulfilled = await cdp([
      'Fetch.fulfillRequest',
      '--params',
      JSON.stringify({
        requestId: paused.requestId,
        responseCode: 500,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from('{"error":"boom"}').toString('base64'),
      }),
    ]);
    assert.equal(fulfilled.exitCode, 0, fulfilled.stderr);
    assert.equal(await evaluate('window.__answer'), '500 {"error":"boom"}');

    assert.equal((await cdp(['Fetch.disable'])).exitCode, 0);
    const stopped = await cdp<{ stopped: string[] }>(['--unlisten']);
    assert.deepEqual(stopped.body.data.stopped, ['Fetch.requestPaused']);
  });

  void it('says pending requests may be paused by Fetch interception, in actions and peek (#554)', async () => {
    const enabled = await cdp([
      'Fetch.enable',
      '--params',
      JSON.stringify({ patterns: [{ urlPattern: '*api/test*' }] }),
    ]);
    assert.equal(enabled.exitCode, 0, enabled.stderr);
    await evaluate(
      "const b = document.createElement('button'); b.id = 'paused'; b.textContent = 'Load'; b.onclick = () => fetch('/api/test'); document.body.append(b); 1"
    );
    const note = /possibly paused by Fetch interception: bdg cdp --events Fetch\.requestPaused/;
    try {
      const clicked = await runCommand('dom', ['click', '#paused'], { timeout: 60000 });
      assert.equal(clicked.exitCode, 0, clicked.stderr);
      assert.match(clicked.stdout, note);

      const peek = await runCommand('peek', ['--network'], { timeout: 60000 });
      assert.match(peek.stdout, note);
      const peekJson = await runCommand('peek', ['--json'], { timeout: 60000 });
      const data = (JSON.parse(peekJson.stdout) as Envelope<{ fetchInterception?: boolean }>).data;
      assert.equal(data.fetchInterception, true);
    } finally {
      assert.equal((await cdp(['Fetch.disable'])).exitCode, 0);
    }
  });

  void it('hints dom eval, not dom query, for a plain Runtime.evaluate (#554)', async () => {
    const outputs: string[] = [];
    for (let call = 0; call < 2; call++) {
      const result = await runCommand(
        'cdp',
        ['Runtime.evaluate', '--params', '{"expression":"document.title"}'],
        { timeout: 60000 }
      );
      assert.equal(result.exitCode, 0, result.stderr);
      outputs.push(`${result.stdout}${result.stderr}`);
    }
    assert.match(outputs[1] ?? '', /Consider using 'bdg dom eval <javascript>'/);
    assert.doesNotMatch(outputs.join('\n'), /bdg dom query/);
  });

  void it('returns the partial events with complete: false when --until never comes', async () => {
    const collected = await cdp<{ complete: boolean; events: unknown[]; result: unknown }>([
      'Runtime.evaluate',
      '--params',
      '{"expression":"1"}',
      '--until',
      'Page.loadEventFired',
      '--timeout',
      '0.5',
    ]);
    assert.equal(collected.exitCode, 0, collected.stderr);
    assert.equal(collected.body.success, true);
    assert.equal(collected.body.data.complete, false);
    assert.deepEqual(collected.body.data.events, []);
    assert.deepEqual(collected.body.data.result, {
      result: { type: 'number', value: 1, description: '1' },
    });
    assert.match(collected.stderr, /Page\.loadEventFired did not arrive within 0\.5s/);
  });

  void it('suggests the bundled event for a typo, before sending anything', async () => {
    const typo = await cdp(['Tracing.end', '--collect', 'Tracing.dataColected']);
    assert.equal(typo.exitCode, 81);
    assert.match(typo.body.error ?? '', /Unknown CDP event 'Tracing\.dataColected'/);
    assert.match(typo.body.suggestion ?? '', /Did you mean:\n {2}- Tracing\.dataCollected/);
  });

  void it('ends the buffer with the session', async () => {
    const listening = await cdp(['--listen', 'Page.loadEventFired']);
    assert.equal(listening.exitCode, 0, listening.stderr);
    await cleanupAllSessions();
    await startSession(fixture.url);
    const read = await cdp(['--events']);
    assert.equal(read.exitCode, 83);
    assert.match(read.body.error ?? '', /No CDP events are being listened to/);
  });
});
