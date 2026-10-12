/**
 * A signal during startup is reported (#686).
 *
 * Ctrl-C (SIGINT) or SIGTERM that arrives while bdg is still loading, before
 * any command has installed its own handling, gives the same report as an
 * interrupted command: one `--json` envelope on stdout (or one line on
 * stderr) and exit 130 (143), never a death by the signal with no output.
 *
 * Deterministic: bdg runs with the test-only startup gate
 * (`BDG_TEST_STARTUP_GATE`), which tells the test on fd 3 that startup has
 * begun and then waits for a byte on stdin. The test sends the signal, then
 * releases the gate, so the signal is handled while the CLI loads. No
 * browser and no fixed delays.
 */

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Compiled CLI entry */
const CLI_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist/index.js'
);

/** How a gated bdg run ended */
interface GatedRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Run bdg with the startup gate, send `signal` once it is held, then release it.
 *
 * @param args - bdg arguments
 * @param signal - Signal to send during startup
 * @returns Exit code or signal, and the output
 */
function signalDuringStartup(args: string[], signal: NodeJS.Signals): Promise<GatedRun> {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env: {
      ...process.env,
      BDG_SESSION_DIR: makeTempDir('bdg-startup-interrupt-'),
      BDG_TEST_STARTUP_GATE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const ready = child.stdio[3] as Readable;
  const gate = child.stdin as Writable;
  gate.on('error', () => undefined);
  ready.once('data', () => {
    child.kill(signal);
    gate.end('x');
  });
  return new Promise((resolve) => {
    child.on('close', (code, closedBy) => resolve({ code, signal: closedBy, stdout, stderr }));
  });
}

after(removeTempDirs);

const CASES = [
  { signal: 'SIGINT', exitCode: 130 },
  { signal: 'SIGTERM', exitCode: 143 },
] as const;

void describe('A signal during startup', () => {
  for (const { signal, exitCode } of CASES) {
    void it(`${signal} with --json prints one Interrupted envelope and exits ${exitCode}`, async () => {
      const run = await signalDuringStartup(['status', '--json'], signal);
      const shown = JSON.stringify(run);
      assert.equal(run.signal, null, `killed by the signal; ${shown}`);
      assert.equal(run.code, exitCode, shown);
      const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
      assert.equal(lines.length, 1, `exactly one envelope on stdout; ${shown}`);
      const envelope = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      assert.equal(envelope['success'], false, shown);
      assert.equal(envelope['error'], 'Interrupted', shown);
      assert.equal(envelope['exitCode'], exitCode, shown);
      assert.equal(typeof envelope['suggestion'], 'string', shown);
      assert.equal(typeof envelope['version'], 'string', shown);
    });

    void it(`${signal} without --json prints one line and exits ${exitCode}`, async () => {
      const run = await signalDuringStartup(['status'], signal);
      const shown = JSON.stringify(run);
      assert.equal(run.signal, null, `killed by the signal; ${shown}`);
      assert.equal(run.code, exitCode, shown);
      assert.equal(run.stdout, '', shown);
      const lines = run.stderr.split('\n').filter((line) => line.trim() !== '');
      assert.equal(lines.length, 1, `exactly one line on stderr; ${shown}`);
      assert.match(lines[0] ?? '', /^Interrupted\. /, shown);
    });
  }
});
