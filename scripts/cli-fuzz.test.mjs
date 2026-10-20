import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedExitCodes,
  applyExceptions,
  buildInvocation,
  checkEnvelope,
  checkExitCode,
  checkNoCrash,
  checkSecrets,
  flattenCommands,
  jsonRequested,
  limitFor,
  mulberry32,
  parseJsonOutput,
  parsePositionals,
  renderSummary,
  resolveArgv,
  unexpectedFiles,
  unsafeReason,
} from './cli-fuzz.mjs';

const TREE = {
  name: 'bdg',
  arguments: '[url]',
  options: [
    { flags: '-p, --port <number>', takesValue: true, description: 'port' },
    { flags: '--chrome-ws-url <url>', takesValue: true, description: 'ws' },
    { flags: '-j, --json', takesValue: false, description: 'json' },
  ],
  subcommands: [
    { name: 'attach', arguments: '[tab]', options: [{ flags: '--chrome-ws-url <url>', takesValue: true, description: 'ws' }, { flags: '-j, --json', takesValue: false, description: 'json' }] },
    {
      name: 'dom',
      options: [],
      subcommands: [
        { name: 'fill', arguments: '<selectorOrIndex> <value>', options: [{ flags: '--index <n>', takesValue: true, description: 'i' }, { flags: '-j, --json', takesValue: false, description: 'json' }] },
        { name: 'screenshot', arguments: '<path>', options: [{ flags: '-f, --follow', takesValue: false, description: 'f' }, { flags: '--out <file>', takesValue: true, description: 'o' }, { flags: '-j, --json', takesValue: false, description: 'json' }] },
        { name: 'wait', arguments: '[selector]', options: [{ flags: '--timeout <ms>', takesValue: true, description: 'Maximum time (default 5000)' }, { flags: '-j, --json', takesValue: false, description: 'json' }] },
      ],
    },
    { name: 'cdp', arguments: '[method]', options: [{ flags: '--timeout <seconds>', takesValue: true, description: 'for at most this long (default 10, max 120)' }, { flags: '--events [events]', takesValue: true, description: 'events' }, { flags: '-j, --json', takesValue: false, description: 'json' }] },
  ],
};
const CTX = { cwd: '/tmp/fuzz-863-x/cwd', fixture: 'http://127.0.0.1:5000', closedPort: 6000, freePort: 7000 };
const specs = flattenCommands(TREE);
const byKey = (key) => specs.find((s) => s.key === key);

test('parsePositionals reads required, optional and variadic arguments', () => {
  assert.deepEqual(parsePositionals('<a> [b] [c...]'), [
    { name: 'a', required: true, variadic: false },
    { name: 'b', required: false, variadic: false },
    { name: 'c', required: false, variadic: true },
  ]);
  assert.deepEqual(parsePositionals(undefined), []);
});

test('flattenCommands lists every command, groups included, with parsed options', () => {
  assert.deepEqual(specs.map((s) => s.key), ['', 'attach', 'dom', 'dom fill', 'dom screenshot', 'dom wait', 'cdp']);
  const events = byKey('cdp').options.find((o) => o.long === '--events');
  assert.equal(events.optionalValue, true);
  assert.equal(byKey('dom screenshot').options.find((o) => o.long === '--follow').short, '-f');
});

test('buildInvocation is deterministic in seed and index, and differs across them', () => {
  const run = (seed, index) => JSON.stringify(buildInvocation(specs, seed, index));
  assert.equal(run(5, 17), run(5, 17));
  const distinct = new Set(Array.from({ length: 40 }, (_, i) => run(5, i)));
  assert.ok(distinct.size > 30);
  assert.notEqual(run(5, 17), run(6, 17));
});

test('mulberry32 repeats for the same seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('generated invocations are safe: attach has a closed-port ws url, URLs are local, paths stay inside the cwd root', () => {
  let attaches = 0;
  for (let i = 0; i < 4000; i++) {
    const inv = buildInvocation(specs, 99, i);
    const argv = resolveArgv(inv.argv, CTX);
    assert.equal(unsafeReason(argv, CTX), undefined, `invocation ${i}: ${JSON.stringify(inv.argv)}`);
    if (inv.key === 'attach') {
      attaches++;
      assert.ok(inv.argv.some((a) => a.startsWith('--chrome-ws-url')), `attach without --chrome-ws-url at ${i}`);
    }
    for (const p of inv.pathArgs.map((a) => resolveArgv([a], CTX)[0])) {
      if (path.isAbsolute(p)) assert.ok(p.startsWith(CTX.cwd) || p === '/dev/null', `${p} is outside the cwd`);
    }
  }
  assert.ok(attaches > 20);
});

test('unsafeReason refuses attach without --chrome-ws-url, a bare port and a real host', () => {
  assert.match(unsafeReason(['attach'], CTX), /without --chrome-ws-url/);
  assert.match(unsafeReason(['attach', '--chrome-ws-url', '9222'], CTX), /not a closed port/);
  assert.match(unsafeReason(['attach', '--chrome-ws-url=localhost:9222'], CTX), /not a closed port/);
  assert.equal(unsafeReason(['attach', '--chrome-ws-url', 'ws://127.0.0.1:6000/devtools/browser/x'], CTX), undefined);
  assert.match(unsafeReason(['page', 'navigate', 'https://example.com/'], CTX), /not local/);
  assert.match(unsafeReason(['x', 'http://user:pw@evil.example:80/'], CTX), /not local/);
  assert.equal(unsafeReason(['page', 'navigate', 'http://x.invalid/'], CTX), undefined);
});

test('secret scenarios plant a secret and record it', () => {
  const hits = Array.from({ length: 3000 }, (_, i) => buildInvocation(specs, 3, i)).filter((inv) => inv.secrets.length > 0);
  assert.ok(hits.length > 10);
  for (const inv of hits) assert.ok(inv.argv.join(' ').includes(inv.secrets[0]) || inv.argv.join(' ').includes(inv.secrets[1]));
});

test('checkNoCrash flags bdg stack frames and crash exits, not page text', () => {
  const base = { code: 1, signal: null, stdout: '', stderr: '', interrupted: false, timedOut: false };
  assert.match(checkNoCrash({ ...base, stderr: 'Error: x\n    at run (file:///repo/dist/commands/a.js:10:5)\n' }), /stack trace/);
  assert.match(checkNoCrash({ ...base, stderr: '    at Module._compile (node:internal/modules/cjs/loader:1:1)\n' }), /stack trace|crash/);
  assert.equal(checkNoCrash({ ...base, stdout: '{"error":"TypeError: x is not a function\\n    at http://127.0.0.1:5000/app.js:3:9"}' }), undefined);
  assert.equal(checkNoCrash({ ...base, stdout: 'Uncaught ReferenceError: foo is not defined (page console)' }), undefined);
  assert.match(checkNoCrash({ ...base, code: null, signal: 'SIGSEGV' }), /SIGSEGV/);
  assert.equal(checkNoCrash({ ...base, code: null, signal: 'SIGKILL', timedOut: true }), undefined);
  assert.match(checkNoCrash({ ...base, code: 104 }), /unhandled/);
  assert.match(checkNoCrash({ ...base, code: 110 }), /internal error/);
});

test('checkExitCode accepts the documented codes only', () => {
  const allowed = allowedExitCodes([{ code: 0 }, { code: 81 }]);
  assert.equal(checkExitCode(81, allowed), undefined);
  assert.match(checkExitCode(2, allowed), /not in exitCodes/);
  assert.match(checkExitCode(255, allowed), /not in exitCodes/);
});

test('the exit codes in exitCodes.ts are all valid for the fuzzer (registry parsed from source)', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/utils/exitCodes.ts'), 'utf8');
  const block = source.slice(source.indexOf('export const EXIT_CODES'), source.indexOf('} as const'));
  const codes = [...block.matchAll(/:\s*(\d+),/g)].map((m) => Number(m[1]));
  assert.ok(codes.includes(81) && codes.includes(143));
  const allowed = allowedExitCodes(codes.map((code) => ({ code })));
  for (const code of codes) assert.equal(checkExitCode(code, allowed), undefined);
});

test('checkEnvelope validates the BdgResponse shape', () => {
  const flags = { json: true, ndjson: false, help: false, interrupted: false };
  const ok = (code, body) => checkEnvelope({ code, stdout: JSON.stringify(body) }, flags);
  assert.equal(ok(0, { version: '1', success: true, data: {} }), undefined);
  assert.equal(ok(83, { version: '1', success: false, error: 'e', suggestion: 's', exitCode: 83 }), undefined);
  assert.match(ok(83, { version: '1', success: false, error: 'e', exitCode: 83 }), /no suggestion/);
  assert.match(ok(83, { version: '1', success: false, error: 'e', suggestion: 's', exitCode: 81 }), /differs/);
  assert.match(ok(0, { version: '1', success: false, error: 'e', suggestion: 's', exitCode: 0 }), /success:false with exit 0/);
  assert.match(ok(1, { version: '1', success: true }), /success:true with exit 1/);
  assert.match(ok(0, { version: '1', success: true, warnings: [] }), /warnings/);
  assert.match(checkEnvelope({ code: 81, stdout: '' }, flags), /empty stdout/);
  assert.match(checkEnvelope({ code: 0, stdout: 'plain text' }, flags), /not valid JSON/);
  assert.equal(checkEnvelope({ code: 0, stdout: 'plain text' }, { ...flags, json: false }), undefined);
  assert.equal(checkEnvelope({ code: 0, stdout: 'Usage: bdg' }, { ...flags, help: true }), undefined);
  assert.equal(checkEnvelope({ code: 130, stdout: '{"a":1}\n{"b":2}\n' }, { ...flags, interrupted: true }), undefined);
  assert.equal(ok(0, { version: '1', success: true, data: {}, extra: 'additive fields are fine' }), undefined);
});

test('parseJsonOutput accepts one document, and NDJSON only when asked', () => {
  assert.deepEqual(parseJsonOutput('{"a":1}\n', false), [{ a: 1 }]);
  assert.equal(parseJsonOutput('{"a":1}\n{"b":2}\n', false), undefined);
  assert.deepEqual(parseJsonOutput('{"a":1}\n{"b":2}\n', true), [{ a: 1 }, { b: 2 }]);
  assert.equal(parseJsonOutput('{"a":1}\nnot json\n', true), undefined);
});

test('jsonRequested ignores --json after -- or consumed as an option value', () => {
  const spec = byKey('dom screenshot');
  assert.equal(jsonRequested(['dom', 'screenshot', 'a.png', '--json'], spec), true);
  assert.equal(jsonRequested(['dom', 'screenshot', '--', '--json'], spec), false);
  assert.equal(jsonRequested(['dom', 'screenshot', '--out', '--json'], spec), false);
  assert.equal(jsonRequested(['dom', 'screenshot', '--out', '--', '--json'], spec), false);
  assert.equal(jsonRequested(['dom', 'screenshot', '--out', 'x', '-j'], spec), true);
});

test('checkSecrets finds a planted secret, plain or URL-encoded, and names no value other than the planted one', () => {
  assert.match(checkSecrets(['Zqabc'], '{"url":"http://u:Zqabc@h/"}', ''), /echoed/);
  assert.match(checkSecrets(['a b'], '', 'x a%20b y'), /echoed/);
  assert.equal(checkSecrets(['Zqabc'], '{"url":"http://u:••••@h/"}', ''), undefined);
  assert.equal(checkSecrets([], 'anything', 'anything'), undefined);
});

test('limitFor: follow commands are interrupted, declared timeouts add a margin, huge ones are capped', () => {
  assert.equal(limitFor(['dom', 'screenshot', 'a.png', '--follow'], byKey('dom screenshot')).interruptAfterMs, 1500);
  assert.equal(limitFor(['dom', 'wait', '--timeout', '2000'], byKey('dom wait')).limitMs, 17000);
  assert.equal(limitFor(['dom', 'wait'], byKey('dom wait')).limitMs, 20000);
  assert.equal(limitFor(['cdp', '--timeout', '3'], byKey('cdp')).limitMs, 18000);
  assert.equal(limitFor(['cdp'], byKey('cdp')).limitMs, 25000);
  const capped = limitFor(['dom', 'wait', '--timeout', '99999999'], byKey('dom wait'));
  assert.deepEqual([capped.limitMs, capped.longDeclared], [60000, true]);
  assert.equal(limitFor(['dom', 'wait', '--timeout=abc'], byKey('dom wait')).limitMs, 45000);
  assert.equal(limitFor(['https://x'], byKey('')).limitMs, 90000);
});

test('unexpectedFiles ignores files a path argument asked for and flags the rest', () => {
  const before = new Set(['old']);
  const after = new Set(['old', 'out.png', 'sub', 'sub/x.txt', 'stray.log']);
  const asked = ['/tmp/r/cwd/out.png', '/tmp/r/cwd/sub/x.txt'];
  assert.deepEqual(unexpectedFiles(before, after, '/tmp/r/cwd', asked), ['stray.log']);
});

test('applyExceptions drops only the invariant cases the exceptions describe', () => {
  const stop = { key: 'stop', argv: ['stop'] };
  assert.deepEqual(applyExceptions([{ invariant: 7, detail: 'x' }], stop, { code: 0 }).kept, []);
  assert.equal(applyExceptions([{ invariant: 7, detail: 'x' }], stop, { code: 83 }).kept.length, 1);
  assert.equal(applyExceptions([{ invariant: 3, detail: 'x' }], { key: 'peek', argv: ['peek', '--follow'] }, {}).kept.length, 0);
  assert.equal(applyExceptions([{ invariant: 2, detail: 'x' }], { key: 'peek', argv: ['peek', '--follow'] }, {}).kept.length, 1);
});

test('renderSummary groups violations by command and invariant with a replay command', () => {
  const violation = (key, invariant, index) => ({ seed: 7, index, key, invariant, detail: 'd', argv: [key], exit: 1, durationMs: 5, stdoutHead: 'o', stderrHead: 'e' });
  const text = renderSummary({
    runs: [{ seed: 7, offset: 0, total: 100, runtimeSeconds: 12, restarts: 1, violations: 3, excepted: { E1: 2 }, harnessErrors: 0, leftovers: [], facts: { jsonChecked: 50 }, byCommand: { eval: 3 } }],
    violations: [violation('eval', 3, 4), violation('eval', 3, 9), violation('attach', 3, 12)],
  });
  assert.match(text, /### eval x invariant 3: 2/);
  assert.match(text, /### attach x invariant 3: 1/);
  assert.match(text, /--seed 7 --offset 4 --count 1/);
  assert.match(text, /invocations: 100/);
});

test('unsafeReason checks --chrome-ws-url on the root start command too', () => {
  assert.match(unsafeReason(['http://127.0.0.1:5000/', '--chrome-ws-url', '9222'], CTX), /not a closed port/);
  assert.match(unsafeReason(['--chrome-ws-url=localhost:9222', 'about:blank'], CTX), /not a closed port/);
  assert.match(unsafeReason(['attach', '--chrome-ws-url', 'ws://127.0.0.1:6000/x', '--chrome-ws-url', '9222'], CTX), /not a closed port/);
  assert.equal(unsafeReason(['about:blank', '--chrome-ws-url', 'ws://127.0.0.1:6000/devtools/browser/x'], CTX), undefined);
});

test('unexpectedFiles: a path argument naming the cwd excuses nothing', () => {
  const after = new Set(['stray.log', 'sub', 'sub/x']);
  assert.deepEqual(unexpectedFiles(new Set(), after, '/tmp/r/cwd', ['/tmp/r/cwd']), ['stray.log', 'sub', 'sub/x']);
  assert.deepEqual(unexpectedFiles(new Set(), after, '/tmp/r/cwd', [path.resolve('/tmp/r/cwd', '.')]), ['stray.log', 'sub', 'sub/x']);
  assert.deepEqual(unexpectedFiles(new Set(), after, '/tmp/r/cwd', ['/tmp/r/cwd/sub']), ['stray.log']);
});

test('checkSecrets catches a leaked fragment, URL-encoded when a character encodes', () => {
  const secret = 'Zqdeadbeef+Xk=';
  assert.match(checkSecrets([secret], 'token=Zqdead', ''), /fragment/);
  assert.match(checkSecrets([secret], `x ${encodeURIComponent('beef+Xk')} y`, ''), /fragment/);
  assert.equal(checkSecrets([secret], 'token=Zqde\u2022\u2022\u2022\u2022', ''), undefined);
});

test('the start-with-credentials scenario always runs in down mode, where a session can start', () => {
  const hits = Array.from({ length: 6000 }, (_, i) => buildInvocation(specs, 11, i)).filter((inv) => inv.key === '' && inv.secrets.length > 0);
  assert.ok(hits.length > 3);
  for (const inv of hits) assert.equal(inv.mode, 'down');
});
