/**
 * Contract test (#465, D5 and D12): `bdg network headers` (no id: the main
 * document) replaces `network document`, and `bdg dom audit --wcag AA|AAA`
 * replaces `--level`. The old spellings are deprecated table rows: they
 * behave as the new ones plus one warning (a `Warning:` line on stderr,
 * `warnings` in the `--json` envelope), and help lists only the new names.
 * Run with no session.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import { generateCompactHelp, generateMachineReadableHelp } from '@/commands/helpJson.js';
import { buildProgram } from '@/program.js';
import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const sessionDir = ensureTestSessionDir();

/**
 * Run the CLI from source in an empty session dir (no session).
 *
 * @param argv - Arguments after `bdg`
 * @returns Exit status and both streams
 */
function runCli(argv: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: sessionDir, CI: '1' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * The one envelope on stdout.
 *
 * @param stdout - Standard output
 * @returns Parsed envelope
 */
function envelope(stdout: string): BdgResponse & Record<string, unknown> {
  return JSON.parse(stdout.trim()) as BdgResponse & Record<string, unknown>;
}

/**
 * The `Warning:` lines of stderr.
 *
 * @param stderr - Standard error
 * @returns Lines
 */
function warningLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning: '));
}

const DOCUMENT_WARNING =
  '"bdg network document" is deprecated and will be removed in 1.0: use "bdg network headers"';
const LEVEL_WARNING =
  '"bdg dom audit --level" is deprecated and will be removed in 1.0: use "bdg dom audit --wcag"';

void describe('network document is a deprecated spelling of network headers', () => {
  void it('bdg network headers: no warning', async () => {
    const run = await runCli(['network', 'headers']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.equal(warningLines(run.stderr).length, 0, run.stderr);
  });

  void it('bdg network document: same exit and output as headers, one warning line', async () => {
    const [current, old] = await Promise.all([
      runCli(['network', 'headers']),
      runCli(['network', 'document']),
    ]);
    assert.equal(old.status, current.status, old.stderr);
    assert.equal(old.stdout, current.stdout);
    assert.deepEqual(warningLines(old.stderr), [`Warning: ${DOCUMENT_WARNING}`]);
  });

  void it('bdg network document --json: warnings in the envelope, nothing on stderr', async () => {
    const run = await runCli(['network', 'document', '--json']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.deepEqual(envelope(run.stdout)['warnings'], [DOCUMENT_WARNING]);
    assert.equal(run.stderr, '');
    const current = await runCli(['network', 'headers', '--json']);
    assert.ok(!('warnings' in envelope(current.stdout)), current.stdout);
  });

  void it('network --help and --help --json list headers, not document', async () => {
    const network = await runCli(['network', '--help']);
    assert.match(network.stdout, /^\s+headers\b/m);
    assert.ok(!/^\s+document\b/m.test(network.stdout), network.stdout);
    const program = buildProgram();
    for (const help of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(help);
      assert.ok(!text.includes('network document'), 'network document listed');
      assert.ok(!text.includes('"name":"document"'), 'document listed');
    }
  });

  void it('a typo of document suggests nothing that is deprecated', async () => {
    const run = await runCli(['network', 'documnt']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!/network document/.test(run.stderr), run.stderr);
  });
});

void describe('dom audit --wcag, --level deprecated', () => {
  void it('--wcag aaa and AA parse; no warning', async () => {
    for (const value of ['aaa', 'AA']) {
      const run = await runCli(['dom', 'audit', '--wcag', value]);
      assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
      assert.equal(warningLines(run.stderr).length, 0, run.stderr);
      assert.ok(!run.stderr.includes('unknown option'), run.stderr);
    }
  });

  void it('--wcag bogus: exit 81, Use AA or AAA', async () => {
    const run = await runCli(['dom', 'audit', '--wcag', 'bogus']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(run.stderr.includes('Use AA or AAA'), run.stderr);
  });

  void it('--level AAA: same exit as --wcag AAA, one warning line', async () => {
    const [current, old] = await Promise.all([
      runCli(['dom', 'audit', '--wcag', 'AAA']),
      runCli(['dom', 'audit', '--level', 'AAA']),
    ]);
    assert.equal(old.status, EXIT_CODES.RESOURCE_NOT_FOUND, old.stderr);
    assert.equal(old.status, current.status);
    assert.equal(old.stdout, current.stdout);
    assert.deepEqual(warningLines(old.stderr), [`Warning: ${LEVEL_WARNING}`]);
  });

  void it('--level AAA --json: warnings in the envelope', async () => {
    const run = await runCli(['dom', 'audit', '--level', 'AAA', '--json']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.deepEqual(envelope(run.stdout)['warnings'], [LEVEL_WARNING]);
    assert.equal(run.stderr, '');
  });

  void it('--level AA --wcag AAA: conflicting values exit 81', async () => {
    const run = await runCli(['dom', 'audit', '--level', 'AA', '--wcag', 'AAA']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!run.stderr.includes('unknown option'), run.stderr);
    assert.ok(run.stderr.includes('--wcag'), run.stderr);
  });

  void it('--level AAA --wcag aaa: the same value passes', async () => {
    const run = await runCli(['dom', 'audit', '--level', 'AAA', '--wcag', 'aaa']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
  });

  void it('help lists --wcag and the example uses it, not --level', async () => {
    const help = await runCli(['dom', 'audit', '--help']);
    assert.ok(help.stdout.includes('--wcag <level>'), help.stdout);
    assert.ok(!help.stdout.includes('--level'), help.stdout);
    const program = buildProgram();
    for (const json of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(json);
      assert.ok(text.includes('--wcag'), '--wcag missing');
      assert.ok(!/audit[^"]*--level/.test(text), 'audit --level listed');
    }
  });
});
