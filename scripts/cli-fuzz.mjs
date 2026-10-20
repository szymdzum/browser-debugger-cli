#!/usr/bin/env node
/**
 * Contract fuzzer for the bdg CLI (#863).
 *
 * Builds invocations from `bdg --help --json`, runs them against a local fixture page and
 * checks seven invariants on every run:
 *   1. no stack trace, signal death or internal-error exit
 *   2. the exit code is one of src/utils/exitCodes.ts (read from `bdg --help --json`)
 *   3. with --json, stdout is one BdgResponse envelope (an error has error, exitCode, suggestion)
 *   4. the command ends within its own timeout plus a margin
 *   5. no file is created outside the session directory (except where a path argument asked for it)
 *   6. a secret-looking input (password value, `user:pass@`, `?token=`) is not echoed back
 *   7. the daemon still answers `bdg status` afterwards
 *
 * ```bash
 * npm run build
 * node scripts/cli-fuzz.mjs --quick                          # ~500 invocations
 * node scripts/cli-fuzz.mjs --seed 7 --offset 0 --count 1000   # one chunk of a longer run
 * node scripts/cli-fuzz.mjs --seed 7 --offset 412 --count 1    # replay invocation 412
 * node scripts/cli-fuzz.mjs --summarize /tmp/fuzz-863-report   # SUMMARY.md from the chunk files
 * ```
 *
 * Safety: every child runs with HOME, BDG_SESSION_DIR and cwd under /tmp/fuzz-863-*, with
 * BDG_ATTACH_REQUIRE_WS_URL=1. `bdg attach` always gets a `--chrome-ws-url` to a closed local port,
 * URLs are local or `.invalid` only, and at most one session is live at a time.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUGE_LENGTH = 120_000;
const KILL_GRACE_MS = 8_000;
const FOLLOW_INTERRUPT_MS = 1_500;
const GENERIC_LIMIT_MS = 45_000;
const START_LIMIT_MS = 90_000;
const LONG_CAP_MS = 60_000;
const SESSION_FREE_COMMANDS = new Set(['', 'attach', 'status', 'sessions', 'stop', 'cleanup', 'install-skill']);
const SESSION_ENDERS = new Set(['stop', 'cleanup']);
const FIXTURE_PAGE = '/login';

/**
 * Seeded PRNG (mulberry32) returning floats in [0, 1).
 * @param {number} seed 32-bit seed
 * @returns {() => number} generator
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a 32-bit seed (FNV-1a), so each invocation index has its own stream.
 * @param {string} text input
 * @returns {number} 32-bit hash
 */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Parse a command's `arguments` string such as `<a> [b] [c...]`.
 * @param {string | undefined} text arguments text from the help JSON
 * @returns {{name: string, required: boolean, variadic: boolean}[]} positionals
 */
export function parsePositionals(text) {
  const out = [];
  for (const m of (text ?? '').matchAll(/([<[])([^>\]]+?)(\.\.\.)?[>\]]/g)) {
    out.push({ name: m[2], required: m[1] === '<', variadic: m[3] === '...' });
  }
  return out;
}

/**
 * Parse an option entry of the help JSON.
 * @param {{flags: string, description?: string, takesValue?: boolean}} option help JSON option
 * @returns {{long: string, short?: string, takesValue: boolean, optionalValue: boolean, valueName?: string, description: string}} parsed option
 */
export function parseOption(option) {
  const long = option.flags.match(/--[\w-]+/)?.[0] ?? '';
  const short = option.flags.match(/(?:^|,\s*)(-\w)\b/)?.[1];
  const valueName = option.flags.match(/[<[]([^>\]]+)[>\]]/)?.[1];
  return {
    long,
    short,
    takesValue: Boolean(option.takesValue),
    optionalValue: /\[[^\]]+\]/.test(option.flags),
    valueName,
    description: option.description ?? '',
  };
}

/**
 * Flatten the command tree of `bdg --help --json` into one spec per command (groups included).
 * @param {{name: string, arguments?: string, options?: object[], subcommands?: object[]}} root `help.command`
 * @returns {{path: string[], key: string, positionals: object[], options: object[], hasJson: boolean, isGroup: boolean}[]} specs
 */
export function flattenCommands(root) {
  const specs = [];
  const visit = (node, parents) => {
    const cmdPath = parents;
    const options = (node.options ?? []).map(parseOption).filter((o) => o.long && !['--help', '--version'].includes(o.long));
    specs.push({
      path: cmdPath,
      key: cmdPath.join(' '),
      positionals: parsePositionals(node.arguments),
      options,
      hasJson: options.some((o) => o.long === '--json'),
      isGroup: (node.subcommands ?? []).length > 0 && parsePositionals(node.arguments).length === 0,
    });
    for (const sub of node.subcommands ?? []) visit(sub, [...cmdPath, sub.name]);
  };
  visit(root, []);
  return specs;
}

const EDGE_STRINGS = [
  '',
  ' ',
  '   ',
  '\t\n',
  'ünïcødé ✓ 日本語 🎉',
  '‮RTL​ zero‍width',
  '\x01\x07\x1b[31mred\x1b[0m',
  'it\'s "quoted" `tick`',
  'line1\nline2\r\nline3',
  '--',
  '-',
  '--help',
  '-h',
  '$(id) ${HOME} %s %n',
  '../../etc/passwd',
  '\\',
  '*',
  '#',
  '.',
  '[',
  'a'.repeat(300),
];
const EDGE_SELECTORS = [
  'a[href="x',
  "div'`",
  ':::',
  '>>',
  'input[value=\'a\nb\']',
  'div:nth-child(',
  '#',
  '[data-x=" "]',
  ':is(',
  '*,*,*',
];
const EDGE_NUMBERS = ['', ' ', '-1', '0', 'NaN', 'Infinity', '-Infinity', '1e999', '99999999999999999999', '-0', '1.5', '0x10', 'abc', '1,5', '٣', '+5', '2147483648', '4294967296'];
const VALID_SELECTORS = ['h1', 'input', 'button', 'form', 'a', 'body', '#username', '#password', 'input[type=password]', 'input[type=text]', '[type=submit]', 'div', 'p'];
const VALID_SCRIPTS = ['1+1', 'document.title', 'document.querySelectorAll("a").length', 'JSON.stringify({a:1})', 'throw new Error("x")', 'location.href', 'undefined', 'Promise.resolve(5)', '[1,2,3].map(x=>x*2)', 'new Promise(()=>{})', 'document.body.innerHTML.length'];
const VALID_CDP_METHODS = ['Runtime.evaluate', 'Page.getFrameTree', 'Network.getCookies', 'Browser.getVersion', 'DOM.getDocument', 'Runtime', 'Foo.bar', 'x', '.', 'Runtime.evalute', 'Page.getNavigationHistory'];
const VALID_EVENTS = ['Network.requestWillBeSent', 'Page.loadEventFired', 'Runtime.consoleAPICalled', 'Page.*', 'Nope.nothing', 'Network.requestWillBeSent,Page.loadEventFired'];
const VALID_KEYS = ['Enter', 'Tab', 'a', 'Escape', 'ArrowDown', 'Shift+a', 'F13', 'NoSuchKey'];
const VALID_TEXT = ['hello', 'a b', 'x', 'Zip', 'First Name'];
const ENUMS = {
  '--dialog': ['accept', 'dismiss', 'ACCEPT', 'Dismiss', 'maybe'],
  '--color-scheme': ['light', 'dark', 'sepia'],
  '--format': ['png', 'jpeg', 'webp', 'gif'],
  '--level': ['error', 'warning', 'info', 'debug', 'log', 'verbose'],
  '--wcag': ['A', 'AA', 'AAA', '2.1AA', 'B'],
  '--page': ['current', 'all', 'main', 'both'],
  '--preset': ['errors', 'api', 'slow', 'images', 'nope'],
  '--sort': ['time', 'size', 'status', 'url', 'nope'],
  '--type': ['xhr', 'fetch', 'document', 'script', 'xhr,fetch', 'nope'],
  '--modifiers': ['ctrl', 'shift', 'alt', 'meta', 'ctrl+shift', 'hyper'],
  '--viewport': ['800x600', '1x1', '0x0', '-5x10', '99999x99999', 'abc', '800'],
  '--frame': ['main', '0', '1', 'nope'],
  '--why': ['display', 'color', 'width', 'nope'],
  '--props': ['display,color', 'width', 'nope'],
  '--filter': ['status:200', 'method:GET', 'url:*login*', 'status:>=400', 'bogus:1', ':'],
  '--header': ['content-type', 'set-cookie', 'x-nope'],
};

const NUMBER_VALID = {
  ms: ['100', '300', '800', '1500'],
  seconds: ['1', '2', '3'],
  pixels: ['50', '120', '300'],
  px: ['0', '4', '16'],
  number: ['0', '1', '2', '5'],
  n: ['0', '1', '2', '5'],
  count: ['1', '3', '10'],
  depth: ['1', '2', '4'],
  megabytes: ['1', '5', '10'],
  times: ['1', '2', '3'],
  id: ['0', '1', '2', 'req-1', 'abc'],
  'node-id': ['0', '1', '4', '100'],
  port: ['{FREEPORT}'],
};

/**
 * Pick one element.
 * @template T
 * @param {() => number} rng random source
 * @param {T[]} list non-empty list
 * @returns {T} an element
 */
function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Classify the value an option or positional takes, from its name.
 * @param {string} name flag (`--out`) or positional name (`selectorOrIndex`)
 * @param {string | undefined} valueName placeholder name from the flag (`<ms>`)
 * @returns {string} kind
 */
export function kindOf(name, valueName) {
  const n = (valueName ?? name).replace(/^--/, '');
  if (name === '--chrome-ws-url') return 'wsurl';
  if (name === '--port' || name === '-p') return 'port';
  if (name === '--session') return 'session';
  if (name in ENUMS) return 'enum';
  if (/^(url|origin)$/.test(n) || name === '--url' || name === '--origin') return 'url';
  if (/(^|-)(file|path|dir|out|state)$/i.test(n) || ['--out', '--state', '--user-data-dir'].includes(name) || n === 'output-file') return 'path';
  if (/selector/i.test(n) || ['--selector', '--scroll'].includes(name)) return 'selector';
  if (name === '--params' || n === 'json') return 'json';
  if (['--collect', '--until', '--listen', '--events'].includes(name)) return 'event';
  if (n === 'script' || n === 'expression' || n === 'expressions' || name === '--if') return 'script';
  if (n === 'method') return 'cdpmethod';
  if (n === 'key') return 'key';
  if (name === '--chrome-flags') return 'chromeflags';
  if (n in NUMBER_VALID) return 'number';
  if (['--index', '--limit', '--last', '--max', '--interval', '--stop-after', '--quality', '--padding', '--wait-network', '--body-max', '--tree', '--tree-limit', '--depth', '--times', '--wait', '--timeout', '--down', '--up', '--left', '--right', '--max-body-size'].includes(name)) return 'number';
  if (n === 'location') return 'location';
  return 'text';
}

/**
 * Secret-looking input used by the secret scenarios: unique per invocation, easy to grep.
 * @param {() => number} rng random source
 * @returns {string} secret value
 */
function makeSecret(rng) {
  return `Zq${Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0')}+Xk=`;
}

/**
 * Draw a value of a kind: valid with probability `validProbability`, else an edge value.
 * @param {() => number} rng random source
 * @param {string} kind kind from {@link kindOf}
 * @param {string} name flag or positional name
 * @param {string | undefined} valueName placeholder name
 * @param {number} validProbability probability of a valid value
 * @returns {string} value (may contain `{CWD}`, `{FIXTURE}`, `{CLOSED}`, `{FREEPORT}` placeholders)
 */
export function drawValue(rng, kind, name, valueName, validProbability = 0.6) {
  const valid = rng() < validProbability;
  const edge = () => pick(rng, EDGE_STRINGS);
  const bigEdge = () => (rng() < 0.03 ? 'x'.repeat(HUGE_LENGTH) : edge());
  switch (kind) {
    case 'port':
      return valid ? '{FREEPORT}' : pick(rng, ['0', '-1', '65536', '99999', 'abc', '', '1', '80', '1.5', 'NaN']);
    case 'session':
      return pick(rng, ['', ' ', '../x', 'a/b', '.', 'x'.repeat(300), 'a b\nc']);
    case 'wsurl':
      return safeWsUrl(rng);
    case 'enum':
      return valid ? pick(rng, ENUMS[name]) : rng() < 0.5 ? bigEdge() : pick(rng, ['', ' ', '0', '-1']);
    case 'url':
      return valid ? pick(rng, safeUrls()) : rng() < 0.3 ? pick(rng, ['http://', 'ht!tp://x.invalid', '://', 'http:///', 'http://x.invalid:99999/', 'localhost:{CLOSED}', '//x.invalid']) : bigEdge();
    case 'path':
      return valid ? pick(rng, ['out-1.png', '{CWD}/out-2.json', 'sub/dir/out-3.txt', 'out.har', '/dev/null', '~/tilde.json']) : pick(rng, ['', ' ', '.', '{CWD}', '{CWD}/missing-dir/x.png', 'a\nb.png', `${'n'.repeat(300)}.png`, 'x'.repeat(HUGE_LENGTH), 'ünï ✓.png', '../sibling.png', '-', '--out']);
    case 'selector':
      return valid ? pick(rng, [...VALID_SELECTORS, '0', '1', '3']) : rng() < 0.5 ? pick(rng, EDGE_SELECTORS) : bigEdge();
    case 'json':
      return valid ? pick(rng, ['{}', '{"expression":"1+1"}', '{"a":[1,2]}']) : pick(rng, ['{', 'null', '[]', '"x"', '', ' ', '{"a":', `${'['.repeat(5000)}${']'.repeat(5000)}`, '{"expression":}', "{'a':1}"]);
    case 'event':
      return valid ? pick(rng, VALID_EVENTS) : bigEdge();
    case 'script':
      return valid ? pick(rng, VALID_SCRIPTS) : rng() < 0.4 ? pick(rng, ['(', '}{', 'var', '"unterminated', 'await', '//', '1/0', 'x.y.z', '`${']) : bigEdge();
    case 'cdpmethod':
      return valid ? pick(rng, VALID_CDP_METHODS) : bigEdge();
    case 'key':
      return valid ? pick(rng, VALID_KEYS) : bigEdge();
    case 'chromeflags':
      return valid ? pick(rng, ['--disable-gpu', '--lang=en', '--ignore-certificate-errors', '--no-sandbox --disable-gpu']) : bigEdge();
    case 'location':
      return valid ? pick(rng, ['index.js:1', 'x.js:10', 'login:1', 'app.js:3:4']) : pick(rng, [...EDGE_STRINGS, ':', 'a:b', 'x.js:-1', 'x.js:0', ':5', 'x.js:99999999999']);
    case 'number': {
      const key = valueName && valueName in NUMBER_VALID ? valueName : name.replace(/^--/, '') in NUMBER_VALID ? name.replace(/^--/, '') : 'n';
      return valid ? pick(rng, NUMBER_VALID[key]) : pick(rng, EDGE_NUMBERS);
    }
    default:
      return valid ? pick(rng, VALID_TEXT) : bigEdge();
  }
}

/**
 * URLs the fuzzer may use: the local fixture server, a closed local port, `.invalid`, `data:`, `about:`.
 * @returns {string[]} URL templates
 */
export function safeUrls() {
  return ['{FIXTURE}/', '{FIXTURE}/login', '{FIXTURE}/forms', '{FIXTURE}/interactions', 'http://127.0.0.1:{CLOSED}/', 'http://x.invalid/', 'about:blank', 'data:text/html,<p>x</p>', 'localhost:{CLOSED}', '{FIXTURE}/missing-page'];
}

/**
 * A `--chrome-ws-url` value: a closed local port or a deliberately malformed value. Never a bare
 * port or host that could resolve to a Chrome the fuzzer did not launch.
 * @param {() => number} rng random source
 * @returns {string} value
 */
export function safeWsUrl(rng) {
  return pick(rng, [
    'ws://127.0.0.1:{CLOSED}/devtools/browser/abc',
    'http://127.0.0.1:{CLOSED}',
    '127.0.0.1:{CLOSED}',
    'ws://127.0.0.1:{CLOSED}/devtools/page/abc',
    '{CLOSED}',
    '',
    'ws://',
    'http://',
    'ws://127.0.0.1:0/x',
    'ws://127.0.0.1:99999/x',
    'nonsense.invalid',
    'ws://nonsense.invalid:{CLOSED}/devtools/browser/x',
    'ws://127.0.0.1:{CLOSED}/devtools/browser/ü\n',
  ]);
}

/**
 * Secret scenarios by command key: the secret is planted where bdg could echo it back.
 * @param {string} key command key (`dom fill`)
 * @param {string} secret secret value
 * @param {string} secret2 second secret value
 * @param {() => number} rng random source
 * @returns {string[] | undefined} argv after the command path, or undefined when the command has no scenario
 */
function secretScenario(key, secret, secret2, rng) {
  const credUrl = pick(rng, [
    `http://user:${secret}@127.0.0.1:{CLOSED}/`,
    `http://127.0.0.1:{CLOSED}/?token=${secret}`,
    `{FIXTURE}/?access_token=${secret}&password=${secret2}`,
    `http://user:${secret}@{FIXTURE_HOSTPORT}/login`,
    `http://x.invalid/cb?api_key=${secret}#access_token=${secret2}`,
  ]);
  switch (key) {
    case 'dom fill':
      return ['input[type=password]', secret];
    case 'page navigate':
      return [credUrl];
    case '':
      return [credUrl, '--port', '{FREEPORT}', '--headless'];
    case 'network cookies':
      return ['--url', credUrl];
    case 'state save':
      return ['{CWD}/state.json', '--origin', credUrl];
    case 'attach':
      return ['--chrome-ws-url', `ws://user:${secret}@127.0.0.1:{CLOSED}/devtools/browser/x`];
    case 'cdp':
      return ['Runtime.evaluate', '--params', JSON.stringify({ expression: '1', password: secret })];
    default:
      return undefined;
  }
}

/**
 * Whether `--follow`-style flags make the command run until interrupted.
 * @param {string[]} argv argument vector after the binary
 * @returns {boolean} true when the fuzzer interrupts it with SIGINT
 */
export function isFollow(argv) {
  return argv.some((a) => a === '--follow' || a === '-f');
}

/**
 * Build the invocation with the given index. Deterministic in (specs, seed, index).
 * @param {object[]} specs output of {@link flattenCommands}
 * @param {number} seed run seed
 * @param {number} index invocation index
 * @returns {{index: number, seed: number, key: string, path: string[], argv: string[], mode: 'up' | 'down', secrets: string[], pathArgs: string[]}} invocation (argv holds placeholders)
 */
export function buildInvocation(specs, seed, index) {
  const rng = mulberry32(hash32(`${seed}:${index}`));
  const spec = pick(rng, specs);
  const secrets = [];
  let mode = SESSION_FREE_COMMANDS.has(spec.key) && rng() < 0.2 ? 'down' : 'up';
  let tail;
  const secretA = makeSecret(rng);
  const secretB = makeSecret(rng);
  const scenario = rng() < 0.07 ? secretScenario(spec.key, secretA, secretB, rng) : undefined;
  if (scenario) {
    if (spec.key === '') mode = 'down';
    tail = [...scenario, ...(spec.hasJson ? ['--json'] : [])];
    secrets.push(secretA, secretB);
  } else {
    tail = buildTail(spec, rng);
  }
  if (spec.key === 'attach' && !tail.includes('--chrome-ws-url')) tail.push('--chrome-ws-url', safeWsUrl(rng));
  const argv = [...spec.path, ...tail];
  const globalJson = spec.hasJson && rng() < 0.1;
  if (globalJson) argv.unshift('--json');
  if (spec.key !== '' && spec.key !== 'attach' && rng() < 0.02) argv.push(pick(rng, ['--help', '-h']));
  return { index, seed, key: spec.key, path: spec.path, argv, mode, secrets, pathArgs: collectPathArgs(spec, argv) };
}

/**
 * Argument values of path-typed options and positionals (a file there is expected).
 * @param {object} spec command spec
 * @param {string[]} argv full argv
 * @returns {string[]} path argument values
 */
function collectPathArgs(spec, argv) {
  const out = [];
  const pathFlags = spec.options.filter((o) => o.takesValue && kindOf(o.long, o.valueName) === 'path').flatMap((o) => [o.long, o.short].filter(Boolean));
  argv.forEach((a, i) => {
    if (pathFlags.includes(a) && argv[i + 1] !== undefined) out.push(argv[i + 1]);
    for (const f of pathFlags) if (a.startsWith(`${f}=`)) out.push(a.slice(f.length + 1));
  });
  const positionalPaths = spec.positionals.filter((p) => kindOf(p.name) === 'path').length;
  if (positionalPaths > 0) out.push(...argv.slice(spec.path.length).filter((a) => !a.startsWith('--')));
  return out;
}

/**
 * Build the options and positionals of one generated invocation.
 * @param {object} spec command spec
 * @param {() => number} rng random source
 * @returns {string[]} arguments after the command path
 */
function buildTail(spec, rng) {
  const positionals = [];
  for (const p of spec.positionals) {
    const kind = kindOf(p.name);
    if (p.required && rng() < 0.06) continue;
    if (!p.required && !p.variadic && rng() < 0.5) continue;
    const count = p.variadic ? Math.floor(rng() * 3) : 1;
    for (let i = 0; i < count; i++) positionals.push(drawValue(rng, kind, p.name, undefined, 0.6));
  }
  if (rng() < 0.06) positionals.push(drawValue(rng, 'text', 'extra', undefined, 0.5));
  const flags = [];
  const wanted = spec.options.length === 0 ? 0 : 1 + Math.floor(rng() * 3);
  for (const o of spec.options) {
    const include = (o.long === '--json' && rng() < 0.75) || rng() < wanted / (spec.options.length + 2);
    if (!include) continue;
    const times = rng() < 0.05 ? 2 : 1;
    for (let i = 0; i < times; i++) flags.push(...renderOption(o, rng));
  }
  if (rng() < 0.05) flags.push(pick(rng, ['--bogus', '--bogus=1', '-Z', '--no-json', '--JSON']));
  return rng() < 0.3 ? [...flags, ...positionals] : [...positionals, ...flags];
}

/**
 * Render one option with a drawn value, as `--flag value`, `--flag=value` or a short form.
 * @param {object} option parsed option
 * @param {() => number} rng random source
 * @returns {string[]} argv fragment
 */
function renderOption(option, rng) {
  if (!option.takesValue) return [rng() < 0.2 && option.short ? option.short : option.long];
  if (option.optionalValue && rng() < 0.4) return [option.long];
  const value = drawValue(rng, kindOf(option.long, option.valueName), option.long, option.valueName, 0.6);
  const form = rng();
  if (form < 0.2) return [`${option.long}=${value}`];
  if (form < 0.3 && option.short) return [option.short, value];
  return [option.long, value];
}

/**
 * Replace the placeholders of an argv template.
 * @param {string[]} argv template
 * @param {{cwd: string, fixture: string, closedPort: number, freePort: number}} ctx run context
 * @returns {string[]} real argv
 */
export function resolveArgv(argv, ctx) {
  const hostPort = ctx.fixture.replace(/^https?:\/\//, '');
  const sub = (s) => s.replaceAll('{CWD}', ctx.cwd).replaceAll('{FIXTURE_HOSTPORT}', hostPort).replaceAll('{FIXTURE}', ctx.fixture).replaceAll('{CLOSED}', String(ctx.closedPort)).replaceAll('{FREEPORT}', String(ctx.freePort));
  return argv.map(sub);
}

const ALLOWED_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\]|[^/:@]*\.invalid)$/i;

/**
 * Safety gate run on the real argv before spawning: `attach` needs a closed-port
 * `--chrome-ws-url`, and every URL must be local, `.invalid`, `data:` or `about:`.
 * @param {string[]} argv real argv
 * @param {{closedPort: number}} ctx run context
 * @returns {string | undefined} the reason it is unsafe, or undefined
 */
export function unsafeReason(argv, ctx) {
  const wsValues = [];
  argv.forEach((a, i) => {
    if (a === '--chrome-ws-url') wsValues.push(argv[i + 1] ?? '');
    else if (a.startsWith('--chrome-ws-url=')) wsValues.push(a.slice('--chrome-ws-url='.length));
  });
  if (argv.includes('attach') && wsValues.length === 0) return 'attach without --chrome-ws-url';
  for (const value of wsValues) {
    const safe = value === '' || /^(wss?|https?):\/\/$/.test(value) || value.includes(`:${ctx.closedPort}`) || value === String(ctx.closedPort) || /\.invalid/.test(value) || /:(0|99999)\//.test(value);
    if (!safe) return `--chrome-ws-url ${value.slice(0, 40)} is not a closed port`;
  }
  for (const a of argv) {
    for (const m of a.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^/\s?#]*)/gi)) {
      const hostPort = m[1].replace(/^[^@]*@/, '');
      const host = hostPort.replace(/:\d*$/, '');
      if (host !== '' && !ALLOWED_HOSTS.test(host) && !m[0].startsWith('ws://nonsense')) return `host ${host.slice(0, 40)} is not local`;
    }
  }
  return undefined;
}

/**
 * Stack-trace patterns that name bdg or Node internals, so page text (`at http://...`) does not hit.
 */
const STACK_FRAME = /^\s+at (?:async )?[^\n]*?(?:\/dist\/|node_modules\/|node:internal|\.ts:\d+)[^\n]*:\d+(?::\d+)?\)?\s*$/m;
const NODE_CRASH = /UnhandledPromiseRejection|node:internal\/|\[ERR_[A-Z_]+\]|FATAL ERROR|ERR_UNHANDLED/;

/**
 * Invariant 1: no stack trace, signal death or internal-error exit.
 * @param {{code: number | null, signal: string | null, stdout: string, stderr: string, interrupted: boolean, timedOut: boolean}} run finished run
 * @returns {string | undefined} violation detail
 */
export function checkNoCrash(run) {
  const text = `${run.stdout}\n${run.stderr}`;
  if (STACK_FRAME.test(text)) return 'stack trace in output';
  if (NODE_CRASH.test(text)) return 'Node crash marker in output';
  if (run.signal && !run.timedOut && !run.interrupted) return `killed by ${run.signal}`;
  if (run.code === 104 || run.code === 105) return `exit ${run.code} (unhandled exception / signal handler error)`;
  if (run.code === 110) return 'exit 110 (SOFTWARE_ERROR: an internal error)';
  return undefined;
}

/**
 * Invariant 2: the exit code is one of the documented ones.
 * @param {number | null} code exit code
 * @param {Set<number>} allowed codes of exitCodes.ts
 * @returns {string | undefined} violation detail
 */
export function checkExitCode(code, allowed) {
  if (code === null) return undefined;
  return allowed.has(code) ? undefined : `exit ${code} is not in exitCodes.ts`;
}

/**
 * Parse stdout as one JSON document, or as NDJSON when `lines` is true.
 * @param {string} stdout output
 * @param {boolean} lines accept one JSON value per line
 * @returns {object[] | undefined} parsed documents, or undefined when stdout is not JSON
 */
export function parseJsonOutput(stdout, lines) {
  const text = stdout.trim();
  try {
    return [JSON.parse(text)];
  } catch {
    if (!lines || text === '') return undefined;
  }
  const docs = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      docs.push(JSON.parse(line));
    } catch {
      return undefined;
    }
  }
  return docs;
}

/**
 * Invariant 3: with `--json`, stdout is one valid BdgResponse envelope.
 * @param {{code: number | null, stdout: string}} run finished run
 * @param {{json: boolean, ndjson: boolean, help: boolean, interrupted: boolean}} flags what the argv asked for
 * @returns {string | undefined} violation detail
 */
export function checkEnvelope(run, flags) {
  if (!flags.json) return undefined;
  const docs = parseJsonOutput(run.stdout, flags.ndjson || flags.interrupted);
  if (!docs) {
    if (flags.help && run.code === 0) return undefined;
    return run.stdout.trim() === '' ? 'empty stdout with --json' : 'stdout is not valid JSON with --json';
  }
  if (flags.ndjson || flags.interrupted) return undefined;
  const env = docs[0];
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return 'JSON output is not an object';
  if (typeof env.version !== 'string') return 'envelope.version is not a string';
  if (typeof env.success !== 'boolean') return 'envelope.success is not a boolean';
  if (env.warnings !== undefined && (!Array.isArray(env.warnings) || env.warnings.length === 0 || env.warnings.some((w) => typeof w !== 'string'))) return 'envelope.warnings must be a non-empty string array when present';
  if (env.success) return run.code === 0 ? undefined : `success:true with exit ${run.code}`;
  if (run.code === 0) return 'success:false with exit 0';
  if (typeof env.error !== 'string' || env.error === '') return 'error envelope has no error';
  if (typeof env.suggestion !== 'string' || env.suggestion === '') return 'error envelope has no suggestion';
  if (typeof env.exitCode !== 'number') return 'error envelope has no exitCode';
  if (env.exitCode !== run.code) return `envelope.exitCode ${env.exitCode} differs from exit ${run.code}`;
  return undefined;
}

/**
 * Invariant 6: a secret given as an argument does not come back in the output.
 * @param {string[]} secrets planted secret values
 * @param {string} stdout output
 * @param {string} stderr error output
 * @returns {string | undefined} violation detail (names the secret's role, never the value)
 */
export function checkSecrets(secrets, stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  for (const [i, secret] of secrets.entries()) {
    const fragments = secretFragments(secret);
    if (fragments.some((f) => text.includes(f) || text.includes(encodeURIComponent(f)))) return `planted secret #${i + 1} (${secret}) or a fragment of it is echoed`;
  }
  return undefined;
}

/**
 * The secret and every 6-character window of it: a partly masked value still leaks.
 * @param {string} secret planted secret
 * @returns {string[]} strings that must not appear in the output
 */
export function secretFragments(secret) {
  const windows = [];
  for (let i = 0; i + 6 <= secret.length; i++) windows.push(secret.slice(i, i + 6));
  return secret.length < 6 ? [secret] : windows;
}

/**
 * Invariant 4 limit: the command's own timeout plus a margin.
 * @param {string[]} argv real argv
 * @param {{key: string, options: object[]}} spec command spec
 * @returns {{limitMs: number, longDeclared: boolean, interruptAfterMs?: number}} limit, whether a declared timeout is beyond the cap, and when to send SIGINT
 */
export function limitFor(argv, spec) {
  if (isFollow(argv)) return { limitMs: FOLLOW_INTERRUPT_MS + KILL_GRACE_MS, longDeclared: false, interruptAfterMs: FOLLOW_INTERRUPT_MS };
  if (spec.key === '') return { limitMs: START_LIMIT_MS, longDeclared: false };
  let declaredMs;
  for (const o of spec.options.filter((x) => /^--(timeout|wait|wait-network)$/.test(x.long) && x.takesValue)) {
    const unit = /second/.test(o.valueName ?? '') ? 1000 : 1;
    const flagIndex = argv.findIndex((a) => a === o.long || a.startsWith(`${o.long}=`));
    if (flagIndex >= 0) {
      const raw = argv[flagIndex].includes('=') ? argv[flagIndex].slice(o.long.length + 1) : argv[flagIndex + 1];
      const value = /^\d+(\.\d+)?$/.test(raw ?? '') ? Number(raw) * unit : undefined;
      if (value !== undefined) declaredMs = Math.max(declaredMs ?? 0, value);
    } else {
      const def = o.description.match(/default (\d+)/);
      if (def) declaredMs = Math.max(declaredMs ?? 0, Number(def[1]) * unit);
    }
  }
  if (declaredMs === undefined) return { limitMs: GENERIC_LIMIT_MS, longDeclared: false };
  const limit = declaredMs + 15_000;
  return limit > LONG_CAP_MS ? { limitMs: LONG_CAP_MS, longDeclared: true } : { limitMs: limit, longDeclared: false };
}

/**
 * Parse the `exitCodes` member of the help JSON into a set.
 * @param {{code: number}[]} exitCodes help JSON exitCodes
 * @returns {Set<number>} allowed exit codes
 */
export function allowedExitCodes(exitCodes) {
  return new Set(exitCodes.map((e) => e.code));
}

/**
 * Entries (relative paths) below a directory, to diff before and after a run.
 * @param {string} dir directory
 * @param {number} depth maximum depth
 * @param {string[]} skip top-level names to leave out
 * @returns {Set<string>} relative paths
 */
export function listTree(dir, depth = 3, skip = []) {
  const out = new Set();
  const walk = (d, prefix, left) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (prefix === '' && skip.includes(e.name)) continue;
      out.add(prefix + e.name);
      if (e.isDirectory() && left > 0) walk(path.join(d, e.name), `${prefix}${e.name}/`, left - 1);
    }
  };
  walk(dir, '', depth);
  return out;
}

/**
 * Invariant 5: files that appeared and were not asked for by a path argument.
 * @param {Set<string>} before listing before
 * @param {Set<string>} after listing after
 * @param {string} base directory the listing is relative to
 * @param {string[]} askedFor resolved absolute paths named by path-typed arguments
 * @returns {string[]} unexpected new entries
 */
export function unexpectedFiles(before, after, base, askedFor) {
  const created = [...after].filter((p) => !before.has(p));
  return created.filter((p) => {
    const abs = path.join(base, p);
    return !askedFor.some((a) => a === abs || abs.startsWith(`${a}${path.sep}`) && a !== base || a.startsWith(`${abs}${path.sep}`));
  });
}

/**
 * Resolve path-typed argument values to absolute paths for {@link unexpectedFiles}.
 * @param {string[]} values path argument values (placeholders resolved)
 * @param {string} cwd the invocation's working directory
 * @returns {string[]} absolute paths
 */
export function resolvePathArgs(values, cwd) {
  return values.filter((v) => v !== '' && v.trim() !== '').map((v) => path.resolve(cwd, v));
}

/**
 * Exceptions: invariant cases that are wrong for a command, with the reason. Listed in SUMMARY.md.
 */
export const EXCEPTIONS = [
  { id: 'E1', invariant: 3, reason: '`--help`/`-h` prints commander help text, not JSON, when exit is 0', applies: (inv) => inv.argv.some((a) => a === '--help' || a === '-h') },
  { id: 'E2', invariant: 3, reason: '`--follow` and `--ndjson` stream one JSON value per line, not one envelope', applies: (inv) => isFollow(inv.argv) || inv.argv.includes('--ndjson') },
  { id: 'E3', invariant: 5, reason: '`install-skill` writes the skill files into HOME or the cwd by design', applies: (inv) => inv.key === 'install-skill' },
  { id: 'E4', invariant: 4, reason: 'a declared `--timeout`/`--wait` beyond the 60 s fuzzer cap is cut at the cap, not a hang', applies: (_inv, ctx) => Boolean(ctx.longDeclared) },
  { id: 'E5', invariant: 7, reason: '`stop` and `cleanup` that exit 0 end the session on purpose', applies: (inv, ctx) => SESSION_ENDERS.has(inv.key) && ctx.code === 0 },
  { id: 'E6', invariant: 6, reason: '`cdp --out` writes the events it was asked for to a file unredacted, by design (its help says so)', applies: (inv) => inv.argv.includes('--out') },
  { id: 'E7', invariant: 'harness', reason: 'a 1 MB argument cannot be passed (ARG_MAX, MAX_ARG_STRLEN): the "huge string" edge value is 120 KB', applies: () => false },
];

/**
 * Apply the exceptions to a violation list.
 * @param {{invariant: number, detail: string}[]} violations violations of one run
 * @param {object} inv the invocation
 * @param {object} ctx extra facts (`code`, `longDeclared`)
 * @returns {{kept: object[], excepted: {id: string, invariant: number}[]}} split
 */
export function applyExceptions(violations, inv, ctx) {
  const kept = [];
  const excepted = [];
  for (const v of violations) {
    const e = EXCEPTIONS.find((x) => x.invariant === v.invariant && x.applies(inv, ctx));
    if (e) excepted.push({ id: e.id, invariant: v.invariant });
    else kept.push(v);
  }
  return { kept, excepted };
}

/**
 * Whether the argv really asks for `--json`: a `--json` after `--`, or consumed as the value of
 * another option, is an argument, not the flag.
 * @param {string[]} argv real argv
 * @param {{options: object[]}} spec command spec
 * @returns {boolean} true when commander sees the flag
 */
export function jsonRequested(argv, spec) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--' || (argv[i + 1] === '--' && spec.options.some((o) => o.takesValue && (o.long === a || o.short === a)))) return false;
    if (a === '--json' || a === '-j') return true;
    const opt = spec.options.find((o) => o.takesValue && (o.long === a || o.short === a));
    if (!opt) continue;
    if (!opt.optionalValue || !(argv[i + 1] ?? '-').startsWith('-')) i++;
  }
  return false;
}

/**
 * Spawn bdg and collect its output, interrupting or killing it at the limits.
 * @param {string} bdgPath dist/index.js
 * @param {string[]} argv arguments
 * @param {{env: object, cwd: string, limitMs: number, interruptAfterMs?: number}} options run options
 * @returns {Promise<{code: number | null, signal: string | null, stdout: string, stderr: string, durationMs: number, timedOut: boolean, interrupted: boolean, spawnError?: string}>} result
 */
export function runBdg(bdgPath, argv, options) {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = [];
    const err = [];
    let timedOut = false;
    let interrupted = false;
    let child;
    try {
      child = spawn(process.execPath, [bdgPath, ...argv], { env: options.env, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, interrupted: false, spawnError: String(error.code ?? error.message) });
      return;
    }
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    const timers = [];
    if (options.interruptAfterMs) {
      timers.push(setTimeout(() => { interrupted = true; child.kill('SIGINT'); }, options.interruptAfterMs));
    }
    timers.push(setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.limitMs));
    child.on('error', (error) => {
      timers.forEach(clearTimeout);
      resolve({ code: null, signal: null, stdout: '', stderr: '', durationMs: Date.now() - started, timedOut: false, interrupted: false, spawnError: String(error.code ?? error.message) });
    });
    child.on('close', (code, signal) => {
      timers.forEach(clearTimeout);
      resolve({ code, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), durationMs: Date.now() - started, timedOut, interrupted });
    });
  });
}

/**
 * A free local TCP port: bound and released.
 * @returns {Promise<number>} port
 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Parse the command line of the fuzzer.
 * @param {string[]} args argv after the script
 * @returns {{seed?: number, offset: number, count: number, quick: boolean, reportDir: string, summarize?: string, list: boolean, keep: boolean, fixturesUrl?: string, bdg: string}} options
 */
export function parseCli(args) {
  const opts = { offset: 0, count: 500, quick: false, reportDir: '/tmp/fuzz-863-report', list: false, keep: false, bdg: path.join(REPO_ROOT, 'dist/index.js') };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === '--seed') opts.seed = Number(next());
    else if (a === '--offset') opts.offset = Number(next());
    else if (a === '--count') opts.count = Number(next());
    else if (a === '--quick') opts.quick = true;
    else if (a === '--report-dir') opts.reportDir = next();
    else if (a === '--summarize') opts.summarize = next();
    else if (a === '--list') opts.list = true;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--fixtures-url') opts.fixturesUrl = next();
    else if (a === '--bdg') opts.bdg = path.resolve(next());
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

/**
 * Group violations by command and invariant and render SUMMARY.md.
 * @param {{runs: object[], violations: object[]}} data chunk stats and violations
 * @returns {string} markdown
 */
export function renderSummary(data) {
  const total = data.runs.reduce((n, r) => n + r.total, 0);
  const runtime = data.runs.reduce((n, r) => n + r.runtimeSeconds, 0);
  const lines = ['# CLI contract fuzzer report', '', `- seed(s): ${[...new Set(data.runs.map((r) => r.seed))].join(', ')}`, `- invocations: ${total} in ${data.runs.length} chunk(s), runtime ${Math.round(runtime)} s`, `- violations: ${data.violations.length} (${new Set(data.violations.map((v) => `${v.key}|${v.invariant}`)).size} groups)`, `- session restarts: ${data.runs.reduce((n, r) => n + r.restarts, 0)}`, ''];
  lines.push('## Chunks', '', '| seed | offset | count | runtime s | violations | excepted | harness errors | leftovers |', '|---|---|---|---|---|---|---|---|');
  for (const r of data.runs) lines.push(`| ${r.seed} | ${r.offset} | ${r.total} | ${Math.round(r.runtimeSeconds)} | ${r.violations} | ${Object.entries(r.excepted).map(([k, v]) => `${k}:${v}`).join(' ') || '-'} | ${r.harnessErrors} | ${r.leftovers.length} |`);
  const facts = data.runs.reduce((acc, r) => { for (const [k, v] of Object.entries(r.facts ?? {})) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  lines.push('', '## What was exercised', '', `- ${Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  const byCommand = data.runs.reduce((acc, r) => { for (const [k, v] of Object.entries(r.byCommand ?? {})) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  lines.push(`- invocations per command: ${Object.entries(byCommand).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const notes = data.runs.flatMap((r) => [...(r.harnessNotes ?? []).map((n) => `harness ${r.seed}/${n}`), ...(r.realDirChanges ?? []).map((n) => `real dir changed during chunk ${r.offset} (the owner's or another agent's session also writes there; the fuzzer's children run with HOME and BDG_SESSION_DIR in /tmp): ${n}`)]);
  if (notes.length) lines.push('', '## Notes', '', ...notes.map((n) => `- ${n}`));
  lines.push('', '## Exceptions in the script', '');
  for (const e of EXCEPTIONS) lines.push(`- ${e.id} (invariant ${e.invariant}): ${e.reason}`);
  const groups = new Map();
  for (const v of data.violations) {
    const k = `${v.key || '(start)'} x invariant ${v.invariant}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  lines.push('', '## Violations by command and invariant', '');
  for (const [k, vs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const first = vs[0];
    lines.push(`### ${k}: ${vs.length}`, '', `- detail: ${first.detail}`, `- replay: \`node scripts/cli-fuzz.mjs --seed ${first.seed} --offset ${first.index} --count 1\``, `- argv: \`bdg ${JSON.stringify(first.argv).slice(0, 300)}\``, `- exit: ${first.exit}${first.signal ? ` signal ${first.signal}` : ''}, ${first.durationMs} ms`, '- stdout head:', '```', first.stdoutHead, '```', '- stderr head:', '```', first.stderrHead, '```', '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Read the chunk files of a report directory and write SUMMARY.md.
 * @param {string} dir report directory
 * @returns {string} the summary path
 */
function summarize(dir) {
  const runs = [];
  const violations = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.startsWith('run-') && f.endsWith('.json')) runs.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (f.startsWith('violations-') && f.endsWith('.jsonl')) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) if (line.trim()) violations.push(JSON.parse(line));
    }
  }
  const target = path.join(dir, 'SUMMARY.md');
  fs.writeFileSync(target, renderSummary({ runs, violations }));
  return target;
}

/**
 * Cut an output to its head for the report.
 * @param {string} text output
 * @returns {string} at most 600 characters
 */
function head(text) {
  return text.length > 600 ? `${text.slice(0, 600)}... [${text.length} chars]` : text;
}

/**
 * Run one chunk: start the fixtures, drive invocations `offset..offset+count`, write the report files.
 * @param {ReturnType<typeof parseCli>} opts options
 * @returns {Promise<number>} process exit code
 */
async function runChunk(opts) {
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff);
  const [offset, count] = opts.quick ? [opts.offset, 500] : [opts.offset, opts.count];
  const realHome = os.userInfo().homedir;
  const root = fs.mkdtempSync(path.join('/tmp', `fuzz-863-${seed}-${offset}-`));
  const dirs = { cwd: path.join(root, 'cwd'), home: path.join(root, 'home'), session: path.join(root, 'session') };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d));
  const env = { PATH: process.env.PATH, HOME: dirs.home, BDG_SESSION_DIR: dirs.session, BDG_ATTACH_REQUIRE_WS_URL: '1', NO_COLOR: '1', ...(process.env.CHROME_PATH ? { CHROME_PATH: process.env.CHROME_PATH } : {}) };
  process.stdout.write(`cli-fuzz seed=${seed} offset=${offset} count=${count} dir=${root}\n`);
  const raw = await runBdg(opts.bdg, ['--help', '--json'], { env, cwd: dirs.cwd, limitMs: 30_000 });
  const help = JSON.parse(raw.stdout);
  const specs = flattenCommands(help.command);
  const allowed = allowedExitCodes(help.exitCodes);
  if (opts.list) {
    for (let i = offset; i < offset + count; i++) {
      const inv = buildInvocation(specs, seed, i);
      process.stdout.write(`${i} [${inv.mode}] ${JSON.stringify(inv.argv).slice(0, 200)}\n`);
    }
    fs.rmSync(root, { recursive: true, force: true });
    return 0;
  }
  const fixtures = await startFixtures(opts);
  const ctx = { cwd: dirs.cwd, fixture: fixtures.url, closedPort: await getFreePort(), freePort: 0 };
  const stats = { seed, offset, total: 0, restarts: 0, violations: 0, excepted: {}, harnessErrors: 0, harnessNotes: [], facts: { jsonChecked: 0, secretRuns: 0, interrupted: 0, statusChecks: 0, killedAtLimit: 0, cappedLong: 0 }, leftovers: [], runtimeSeconds: 0, byCommand: {} };
  const started = Date.now();
  const realBefore = { bdg: listTree(path.join(realHome, '.bdg'), 0), downloads: listTree(path.join(realHome, 'Downloads'), 0) };
  fs.mkdirSync(opts.reportDir, { recursive: true });
  const violationsFile = path.join(opts.reportDir, `violations-${seed}-${offset}-${count}.jsonl`);
  fs.writeFileSync(violationsFile, '');
  const state = { up: false, abort: false };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { state.abort = true; });
  try {
    for (let i = offset; i < offset + count; i++) {
      ctx.freePort = await getFreePort();
      const result = await runOne({ opts, env, dirs, ctx, specs, allowed, seed, index: i, state, stats });
      stats.total++;
      for (const v of result.violations) {
        stats.violations++;
        fs.appendFileSync(violationsFile, `${JSON.stringify(v)}\n`);
      }
      if (state.abort) { process.stderr.write('interrupted: finishing the current invocation, then stopping\n'); break; }
      if (result.fatal) { process.stderr.write(`fatal harness error: ${result.fatal}\n`); break; }
      if ((i - offset + 1) % 100 === 0) process.stdout.write(`  ${i - offset + 1}/${count} violations=${stats.violations} elapsed=${Math.round((Date.now() - started) / 1000)}s\n`);
    }
  } finally {
    await endSession(opts.bdg, env, dirs.cwd);
    fixtures.stop();
  }
  stats.realDirChanges = realDirChanges(realBefore);
  stats.leftovers = await findLeftovers(root);
  stats.runtimeSeconds = (Date.now() - started) / 1000;
  fs.writeFileSync(path.join(opts.reportDir, `run-${seed}-${offset}-${count}.json`), JSON.stringify(stats, null, 2));
  process.stdout.write(`done seed=${seed} offset=${offset} total=${stats.total} violations=${stats.violations} restarts=${stats.restarts} harnessErrors=${stats.harnessErrors} leftovers=${stats.leftovers.length} runtime=${Math.round(stats.runtimeSeconds)}s\n`);
  if (!opts.keep && stats.leftovers.length === 0) fs.rmSync(root, { recursive: true, force: true });
  return state.abort ? 130 : 0;
}

/**
 * Changes to the real ~/.bdg and ~/Downloads listings since the snapshot.
 * @param {{bdg: Set<string>, downloads: Set<string>}} before snapshot taken at the start of the chunk
 * @returns {string[]} one line per changed directory
 */
function realDirChanges(before) {
  const home = os.userInfo().homedir;
  const notes = [];
  for (const [k, dir] of [['bdg', '.bdg'], ['downloads', 'Downloads']]) {
    const after = listTree(path.join(home, dir), 0);
    const changed = [...after].filter((p) => !before[k].has(p)).concat([...before[k]].filter((p) => !after.has(p)));
    if (changed.length > 0) notes.push(`~/${dir}: ${changed.slice(0, 5).join(', ')}`);
  }
  return notes;
}

/**
 * Processes whose command line names the chunk's temp directory (Chrome of a session left running).
 * @param {string} root chunk temp directory
 * @returns {Promise<string[]>} ps lines
 */
async function findLeftovers(root) {
  const res = await runCommand('ps', ['-axo', 'pid=,command=']);
  return res.stdout.split('\n').filter((l) => l.includes(root) && !l.includes('cli-fuzz.mjs')).map((l) => l.trim().slice(0, 200));
}

/**
 * Run a plain command and collect its output.
 * @param {string} cmd executable
 * @param {string[]} args arguments
 * @returns {Promise<{stdout: string}>} output
 */
function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const out = [];
    child.stdout.on('data', (b) => out.push(b));
    child.on('close', () => resolve({ stdout: Buffer.concat(out).toString('utf8') }));
    child.on('error', () => resolve({ stdout: '' }));
  });
}

/**
 * Start the fixture server (`src/__testutils__/serveFixtures.ts`) unless a URL was given.
 * @param {ReturnType<typeof parseCli>} opts options
 * @returns {Promise<{url: string, stop: () => void}>} fixture server handle
 */
function startFixtures(opts) {
  if (opts.fixturesUrl) return Promise.resolve({ url: opts.fixturesUrl.replace(/\/$/, ''), stop: () => {} });
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), ['src/__testutils__/serveFixtures.ts'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (b) => {
      buf += b.toString();
      const m = buf.match(/fixtures:\s+(http:\/\/\S+)/);
      if (m) resolve({ url: m[1].replace(/\/$/, ''), stop: () => child.kill('SIGTERM') });
    });
    child.on('error', reject);
    child.on('close', () => reject(new Error('fixture server exited before printing its URL')));
  });
}

/**
 * End the live session through bdg only: `bdg stop`, then `bdg cleanup --force`.
 * @param {string} bdgPath dist/index.js
 * @param {object} env child environment
 * @param {string} cwd working directory
 */
async function endSession(bdgPath, env, cwd) {
  await runBdg(bdgPath, ['stop', '--json'], { env, cwd, limitMs: 30_000 });
  await runBdg(bdgPath, ['cleanup', '--force', '--json'], { env, cwd, limitMs: 30_000 });
}

/**
 * Whether `bdg status --json` reports an active session.
 * @param {string} bdgPath dist/index.js
 * @param {object} env child environment
 * @param {string} cwd working directory
 * @returns {Promise<{answered: boolean, active: boolean, run: object}>} status
 */
async function statusOf(bdgPath, env, cwd) {
  const run = await runBdg(bdgPath, ['status', '--json'], { env, cwd, limitMs: 30_000 });
  const docs = parseJsonOutput(run.stdout, false);
  const env0 = docs?.[0];
  return { answered: run.code === 0 && env0?.success === true, active: env0?.data?.active === true, run };
}

/**
 * Start the fuzzer's own session on the fixture page.
 * @param {object} p run parameters
 * @returns {Promise<boolean>} true when a session is up
 */
async function startSession(p) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = await runBdg(p.opts.bdg, [`${p.ctx.fixture}${FIXTURE_PAGE}`, '--headless', '--port', String(p.ctx.freePort), '--json'], { env: p.env, cwd: p.dirs.cwd, limitMs: START_LIMIT_MS });
    if (run.code === 0) { p.stats.restarts++; return true; }
    await endSession(p.opts.bdg, p.env, p.dirs.cwd);
  }
  return false;
}

/**
 * Run and check one invocation.
 * @param {object} p run parameters
 * @returns {Promise<{violations: object[], fatal?: string}>} result
 */
async function runOne(p) {
  const inv = buildInvocation(p.specs, p.seed, p.index);
  const spec = p.specs.find((s) => s.key === inv.key);
  if (inv.mode === 'down' && p.state.up) { await endSession(p.opts.bdg, p.env, p.dirs.cwd); p.state.up = false; }
  if (inv.mode === 'up' && !p.state.up) {
    if (!(await startSession(p))) return { violations: [], fatal: 'could not start the fuzzer session twice' };
    p.state.up = true;
  }
  const argv = resolveArgv(inv.argv, p.ctx);
  const unsafe = unsafeReason(argv, p.ctx);
  if (unsafe) { p.stats.harnessErrors++; p.stats.harnessNotes.push(`${p.index}: ${unsafe}`); return { violations: [{ seed: p.seed, index: p.index, key: inv.key, invariant: 0, detail: `generator bug, not run: ${unsafe}`, argv: inv.argv, exit: null, durationMs: 0, stdoutHead: '', stderrHead: '' }] }; }
  const lim = limitFor(argv, spec);
  const roots = [p.dirs.cwd, p.dirs.home, path.dirname(p.dirs.cwd)];
  const listAll = () => roots.map((r, i) => listTree(r, 3, i === 2 ? ['cwd', 'home', 'session'] : []));
  const before = listAll();
  const run = await runBdg(p.opts.bdg, argv, { env: p.env, cwd: p.dirs.cwd, limitMs: lim.limitMs, interruptAfterMs: lim.interruptAfterMs });
  if (run.spawnError) { p.stats.harnessErrors++; p.stats.harnessNotes.push(`${p.index}: spawn ${run.spawnError}`); return { violations: [] }; }
  const found = [];
  const add = (invariant, detail) => detail && found.push({ invariant, detail });
  add(1, checkNoCrash(run));
  add(2, checkExitCode(run.code, p.allowed));
  const flags = { json: jsonRequested(argv, spec), ndjson: argv.includes('--ndjson'), help: argv.some((a) => a === '--help' || a === '-h'), interrupted: run.interrupted };
  add(3, checkEnvelope(run, flags));
  const f = p.stats.facts;
  if (flags.json) f.jsonChecked++;
  if (inv.secrets.length) f.secretRuns++;
  if (run.interrupted) f.interrupted++;
  if (run.timedOut) (lim.longDeclared ? f.cappedLong++ : f.killedAtLimit++);
  add(4, run.timedOut ? `no exit within ${Math.round(lim.limitMs / 1000)} s (killed)` : run.interrupted && run.durationMs > lim.interruptAfterMs + KILL_GRACE_MS ? 'did not stop after SIGINT' : undefined);
  const askedFor = resolvePathArgs(inv.pathArgs.map((a) => resolveArgv([a], p.ctx)[0]), p.dirs.cwd);
  const after = listAll();
  const stray = roots.flatMap((r, i) => unexpectedFiles(before[i], after[i], r, askedFor).map((f) => path.join(r, f)));
  add(5, stray.length ? `unexpected files: ${stray.slice(0, 4).map((f) => path.relative(path.dirname(p.dirs.cwd), f)).join(', ')}` : undefined);
  add(6, checkSecrets(inv.secrets, run.stdout, run.stderr));
  let ended = false;
  if (inv.mode === 'up') {
    const st = await statusOf(p.opts.bdg, p.env, p.dirs.cwd);
    f.statusChecks++;
    if (!st.answered || !st.active) {
      add(7, !st.answered ? `bdg status did not answer afterwards (exit ${st.run.code})` : 'bdg status reports no active session afterwards');
      ended = true;
    }
  } else {
    const st = await statusOf(p.opts.bdg, p.env, p.dirs.cwd);
    if (st.active) await endSession(p.opts.bdg, p.env, p.dirs.cwd);
  }
  const expectEnd = SESSION_ENDERS.has(inv.key) && run.code === 0;
  if (ended || expectEnd) { await endSession(p.opts.bdg, p.env, p.dirs.cwd); p.state.up = false; }
  for (const name of fs.readdirSync(p.dirs.cwd)) fs.rmSync(path.join(p.dirs.cwd, name), { recursive: true, force: true });
  for (const name of fs.readdirSync(p.dirs.home)) fs.rmSync(path.join(p.dirs.home, name), { recursive: true, force: true });
  for (const name of fs.readdirSync(path.dirname(p.dirs.cwd))) if (!['cwd', 'home', 'session'].includes(name)) fs.rmSync(path.join(path.dirname(p.dirs.cwd), name), { recursive: true, force: true });
  p.stats.byCommand[inv.key || '(start)'] = (p.stats.byCommand[inv.key || '(start)'] ?? 0) + 1;
  const { kept, excepted } = applyExceptions(found, inv, { code: run.code, longDeclared: lim.longDeclared });
  for (const e of excepted) p.stats.excepted[e.id] = (p.stats.excepted[e.id] ?? 0) + 1;
  return {
    violations: kept.map((v) => ({ seed: p.seed, index: p.index, key: inv.key, invariant: v.invariant, detail: v.detail, argv: inv.argv.map((a) => (a.length > 200 ? `${a.slice(0, 200)}...[${a.length}]` : a)), mode: inv.mode, exit: run.code, signal: run.signal, durationMs: run.durationMs, stdoutHead: head(run.stdout), stderrHead: head(run.stderr) })),
  };
}

/**
 * Entry point.
 */
async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.summarize) {
    process.stdout.write(`${summarize(opts.summarize)}\n`);
    return;
  }
  if (!fs.existsSync(opts.bdg)) throw new Error(`${opts.bdg} not found: run npm run build first`);
  const started = Date.now();
  const code = await runChunk(opts);
  process.stdout.write(`runtime ${Math.round((Date.now() - started) / 1000)}s\n`);
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
