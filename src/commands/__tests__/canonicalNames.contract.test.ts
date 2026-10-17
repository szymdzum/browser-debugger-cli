/**
 * Contract test (#465, D4 and D13): `bdg eval`, `bdg dom press-key` and
 * `bdg network cookies` are the commands; `dom eval`, `dom pressKey` and
 * `network getCookies` are deprecated spellings that behave exactly as the
 * new ones plus one warning (a `Warning:` line on stderr, `warnings` in the
 * `--json` envelope). Run with no session. Help lists only the new names and
 * a typo of any name suggests the new one.
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
 * Stderr without its `Warning:` lines.
 *
 * @param stderr - Standard error
 * @returns Remaining text
 */
function withoutWarnings(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !line.startsWith('Warning: '))
    .join('\n');
}

interface Rename {
  current: string[];
  old: string[];
  warning: string;
}

const RENAMED: Rename[] = [
  {
    current: ['eval', 'document.title'],
    old: ['dom', 'eval', 'document.title'],
    warning: '"bdg dom eval" is deprecated and will be removed in 1.0: use "bdg eval"',
  },
  {
    current: ['dom', 'press-key', '#field', 'Enter'],
    old: ['dom', 'pressKey', '#field', 'Enter'],
    warning: '"bdg dom pressKey" is deprecated and will be removed in 1.0: use "bdg dom press-key"',
  },
  {
    current: ['network', 'cookies'],
    old: ['network', 'getCookies'],
    warning:
      '"bdg network getCookies" is deprecated and will be removed in 1.0: use "bdg network cookies"',
  },
];

void describe('renamed commands: new name, old name, human and --json', () => {
  for (const row of RENAMED) {
    const label = `bdg ${row.old.join(' ')}`;

    void it(`bdg ${row.current.join(' ')}: usage and exit as the old name, no warning`, async () => {
      const run = await runCli(row.current);
      assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
      assert.ok(!run.stderr.includes('Warning:'), run.stderr);
      assert.ok(!run.stderr.includes('unknown command'), run.stderr);
    });

    void it(`${label}: same exit, output and stderr, one warning line`, async () => {
      const [current, old] = await Promise.all([runCli(row.current), runCli(row.old)]);
      assert.equal(old.status, current.status, old.stderr);
      assert.equal(old.stdout, current.stdout);
      assert.equal(withoutWarnings(old.stderr), current.stderr);
      assert.deepEqual(
        old.stderr.split('\n').filter((line) => line.startsWith('Warning: ')),
        [`Warning: ${row.warning}`]
      );
    });

    void it(`${label} --json: same envelope plus warnings, nothing on stderr`, async () => {
      const [current, old] = await Promise.all([
        runCli([...row.current, '--json']),
        runCli([...row.old, '--json']),
      ]);
      assert.equal(old.status, current.status, old.stderr);
      const newEnvelope = envelope(current.stdout);
      const { warnings, ...oldRest } = envelope(old.stdout);
      assert.ok(!('warnings' in newEnvelope), current.stdout);
      assert.deepEqual(warnings, [row.warning]);
      assert.deepEqual(oldRest, newEnvelope);
      assert.equal(old.stderr, '');
      assert.equal(current.stderr, '');
    });
  }
});

void describe('usage errors of an old spelling', () => {
  const USAGE: Array<{ old: string[]; help: string; warning: string }> = [
    { old: ['dom', 'eval'], help: 'bdg eval', warning: RENAMED[0]?.warning ?? '' },
    { old: ['dom', 'pressKey'], help: 'bdg dom press-key', warning: RENAMED[1]?.warning ?? '' },
    {
      old: ['network', 'getCookies', '--bogus'],
      help: 'bdg network cookies',
      warning: RENAMED[2]?.warning ?? '',
    },
  ];
  for (const row of USAGE) {
    const label = `bdg ${row.old.join(' ')}`;

    void it(`${label}: exit 81, the warning, help of the new name`, async () => {
      const run = await runCli(row.old);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      assert.deepEqual(
        run.stderr.split('\n').filter((line) => line.startsWith('Warning: ')),
        [`Warning: ${row.warning}`]
      );
      assert.ok(run.stderr.includes(`Run "${row.help} --help" for usage`), run.stderr);
    });

    void it(`${label} --json: warnings in the error envelope, help of the new name`, async () => {
      const run = await runCli([...row.old, '--json']);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      const response = envelope(run.stdout);
      assert.deepEqual(response['warnings'], [row.warning]);
      assert.equal(response.suggestion, `Run "${row.help} --help" for usage`);
      assert.equal(run.stderr, '');
    });
  }
});

void describe('help lists only the new names', () => {
  void it('bdg --help lists eval; dom --help lists press-key and no eval or pressKey', async () => {
    const root = await runCli(['--help']);
    assert.match(root.stdout, /^\s+eval\b/m);
    const dom = await runCli(['dom', '--help']);
    assert.match(dom.stdout, /^\s+press-key\b/m);
    assert.ok(!/^\s+(eval|pressKey)\b/m.test(dom.stdout), dom.stdout);
  });

  void it('bdg network --help lists cookies, not getCookies', async () => {
    const network = await runCli(['network', '--help']);
    assert.match(network.stdout, /^\s+cookies\b/m);
    assert.ok(!network.stdout.includes('getCookies'), network.stdout);
  });

  void it('bdg eval --help has the options dom eval had', async () => {
    const help = await runCli(['eval', '--help']);
    assert.equal(help.status, EXIT_CODES.SUCCESS);
    for (const text of ['--frame <frame>', '--full', '-j, --json']) {
      assert.ok(help.stdout.includes(text), text);
    }
    assert.ok(help.stdout.includes('Evaluate JavaScript expression'), help.stdout);
  });

  void it('bdg --help --json (compact and full): new names only', () => {
    const program = buildProgram();
    for (const help of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(help);
      assert.equal(text.split('"name":"eval"').length - 1, 1, 'eval listed once, at the root');
      assert.ok(text.includes('"name":"press-key"'));
      assert.ok(text.includes('"name":"cookies"'));
      for (const old of [
        '"name":"pressKey"',
        '"name":"getCookies"',
        'dom eval',
        'network getCookies',
      ]) {
        assert.ok(!text.includes(old), `${old} listed`);
      }
      assert.ok(!/dom pressKey/.test(text), 'dom pressKey listed');
    }
  });
});

void describe('typos suggest the new name, never the old', () => {
  const TYPOS: Array<{ argv: string[]; suggests: RegExp }> = [
    { argv: ['dom', 'presskey'], suggests: /Did you mean:? press-key/ },
    { argv: ['dom', 'press_key'], suggests: /Did you mean:? press-key/ },
    { argv: ['network', 'get-cookies'], suggests: /Did you mean:? (bdg network )?cookies/ },
    { argv: ['network', 'getcookies'], suggests: /Did you mean:? (bdg network )?cookies/ },
    { argv: ['dom', 'evl'], suggests: /Did you mean:? (bdg )?eval/ },
    { argv: ['evl', 'x'], suggests: /Did you mean:? (bdg )?eval/ },
  ];
  for (const { argv, suggests } of TYPOS) {
    void it(`bdg ${argv.join(' ')}`, async () => {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      assert.match(run.stderr, suggests);
      assert.ok(!/pressKey|getCookies|dom eval/.test(run.stderr), run.stderr);
    });
  }
});
