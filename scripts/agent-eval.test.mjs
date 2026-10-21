import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

import {
  aggregate,
  claudeArgs,
  copyFixtureRuntime,
  contaminationPatterns,
  findContamination,
  fitsBudget,
  forceCleanup,
  LOG_BODY_LIMIT,
  OVERSHOOT_MARGIN,
  gradeRun,
  parseArgs,
  parseStream,
  planJobs,
  readApiKey,
  redact,
  renderPlan,
  renderSummary,
  resolveSettings,
  runJob,
  runPool,
  findCheating,
  startLogServer,
} from './agent-eval.mjs';
import { TASKS, buildPrompt, extractAnswer, pageUrl, selectTasks } from './agent-eval-tasks.mjs';

const FAKE_KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEY';

/** What the pages logged in the run the checkers grade: values `a1b2c3`; Alpha, Charlie and Delta broke */
const LOG = {
  'popup-code': ['cf-a1b2c3'],
  'cancel-confirm': ['Order A-a1b2c3 kept'],
  'breaking-buttons': ['Alpha=1', 'Bravo=0', 'Charlie=1', 'Delta=1', 'Echo=0'],
  'shadow-login': ['R-a1b2c3'],
  'failed-request-page-two': ['/eval-net-b-a1b2c3.json'],
  'download-name': ['q3-report-a1b2c3.csv'],
  'console-error-code': ['E-a1b2c3'],
  'utility-classes': ['id-a1b2c3'],
};
const contextWith = (log) => ({
  fixtures: 'http://127.0.0.1:1/',
  refusedUrl: 'http://127.0.0.1:2/',
  logApi: 'http://127.0.0.1:3',
  nonce: 'n0nce',
  logged: (key) => log[key] ?? [],
});
const CTX = contextWith(LOG);
const CLASSES =
  'px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:ring-2 id-a1b2c3';

/**
 * Right answers, plausible wrong ones and malformed ones per task, to prove every checker
 * passes the truth and nothing else.
 */
const CASES = {
  'popup-code': {
    right: ['cf-a1b2c3'],
    wrong: [
      'cf-a1b2c4',
      'CF-A1B2C3',
      'cf-a1b2c3 and cf-123',
      'code-123',
      'cf-a1b2c3 or cf-a1b2c4',
    ],
  },
  'cancel-confirm': {
    right: ['Order A-a1b2c3 kept', 'Order A-a1b2c3 kept.'],
    wrong: [
      'Order A-a1b2c3 removed',
      'order a-a1b2c3 kept',
      'The order is active',
      'Order A-a1b2c3 kept or removed',
      'Order A-a1b2c4 kept',
    ],
  },
  'breaking-buttons': {
    right: ['Alpha, Charlie, Delta', 'delta,Alpha,Charlie'.replace('delta', 'Delta')],
    wrong: [
      'Alpha, Charlie',
      'Alpha, Bravo, Charlie, Delta',
      'Alpha, Charlie, Delta (maybe Echo)',
      'Alpha, Charlie, Delta, Delta',
      'alpha, charlie, delta',
      'Bravo, Echo',
    ],
  },
  'shadow-login': {
    right: ['R-a1b2c3'],
    wrong: ['R-a1b2c4', 'r-a1b2c3', 'Wrong credentials', 'R-a1b2c3 or R-12345'],
  },
  'failed-request-page-two': {
    right: ['/eval-net-b-a1b2c3.json'],
    wrong: [
      '/eval-net-a-a1b2c3.json',
      '/favicon.ico',
      '/eval-net-b-a1b2c3.json and /eval-net-a-a1b2c3.json',
      '/eval-net-b-a1b2c3.js',
      '/EVAL-NET-B-A1B2C3.JSON',
    ],
  },
  'download-name': {
    right: ['q3-report-a1b2c3.csv'],
    wrong: [
      'q3-report-a1b2c4.csv',
      'Q3-REPORT-A1B2C3.CSV',
      'report.csv',
      'q3-report-a1b2c3.csv or q3-report-a1b2c3.txt',
    ],
  },
  'console-error-code': {
    right: ['E-a1b2c3'],
    wrong: ['W-1010', 'E-a1b2c4', 'e-a1b2c3', 'E-a1b2c3, W-1010'],
  },
  'utility-classes': {
    right: [CLASSES, CLASSES.split(' ').reverse().join(', ')],
    wrong: [
      CLASSES.replace(' id-a1b2c3', ''),
      `${CLASSES} +8`,
      'px-4 py-2',
      CLASSES.replace('md:px-6', 'md:px-4').replace('id-a1b2c3', 'id-a1b2c4'),
      CLASSES.toUpperCase(),
      `${CLASSES} px-4`,
    ],
  },
  'page-never-loads': {
    right: ['net::ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_REFUSED'],
    wrong: [
      'net::ERR_NAME_NOT_RESOLVED',
      'net::ERR_TOO_MANY_REDIRECTS',
      'The page loaded',
      'net::ERR_CONNECTION_REFUSED or net::ERR_BLOCKED_BY_CLIENT',
      'net::err_connection_refused',
    ],
  },
};

const reply = (value) => `I did the task.\n\nANSWER: ${value}`;

test('the harness has at least eight tasks, each with its scenario and a case table', () => {
  assert.ok(TASKS.length >= 8);
  assert.deepEqual(TASKS.map((t) => t.id).sort(), Object.keys(CASES).sort());
  for (const task of TASKS) assert.match(task.scenario, /^S\d\d$/);
});

for (const task of TASKS) {
  test(`checker ${task.id}: passes the truth, fails wrong, missing and hedged answers`, () => {
    for (const value of CASES[task.id].right)
      assert.equal(task.check(reply(value), CTX).pass, true, `right: ${value}`);
    for (const value of CASES[task.id].wrong)
      assert.equal(task.check(reply(value), CTX).pass, false, `wrong: ${value}`);
    const missing = task.check('I found it and it was fine.', CTX);
    assert.equal(missing.pass, false);
    assert.match(missing.reason, /ANSWER/);
    assert.equal(task.check('', CTX).pass, false);
    assert.equal(task.check('ANSWER:', CTX).pass, false);
    assert.equal(
      task.check(`ANSWER: ${CASES[task.id].right[0]}\nThat is my answer.`, CTX).pass,
      false,
      'the ANSWER line must be last'
    );
  });

  test(`prompt ${task.id}: states the goal and the format and holds no truth`, () => {
    const prompt = buildPrompt(task, CTX);
    assert.match(prompt, /ANSWER: /);
    assert.match(prompt, /bdg --help/);
    for (const value of CASES[task.id].right)
      assert.equal(prompt.includes(value), false, `the prompt leaks ${value}`);
    for (const entry of LOG[task.id] ?? []) assert.equal(prompt.includes(entry), false);
  });
}

test('a run in which the page logged nothing fails every page task, even with a plausible answer', () => {
  const empty = contextWith({});
  for (const task of TASKS.filter((t) => t.id !== 'page-never-loads')) {
    const verdict = task.check(reply(CASES[task.id].right[0]), empty);
    assert.equal(verdict.pass, false, task.id);
    assert.match(verdict.reason, /interaction never happened/, task.id);
  }
  assert.equal(
    TASKS.find((t) => t.id === 'page-never-loads').check(reply('ERR_CONNECTION_REFUSED'), empty)
      .pass,
    true
  );
});

test('cancel-confirm fails when the page shows the order was removed, whatever the answer', () => {
  const removed = contextWith({ ...LOG, 'cancel-confirm': ['Order A-a1b2c3 removed'] });
  const verdict = TASKS.find((t) => t.id === 'cancel-confirm').check(
    reply('Order A-a1b2c3 removed'),
    removed
  );
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /accepted/);
});

test('any value the page logged in the run is accepted (an honest reload), buttons use the last outcome per button', () => {
  const again = contextWith({
    ...LOG,
    'popup-code': ['cf-111111', 'cf-a1b2c3'],
    'console-error-code': ['E-111111', 'E-a1b2c3'],
    'failed-request-page-two': ['/eval-net-b-111111.json', '/eval-net-b-a1b2c3.json'],
    'utility-classes': ['id-111111', 'id-a1b2c3'],
    'breaking-buttons': [
      'Alpha=0',
      'Bravo=1',
      'Charlie=0',
      'Delta=0',
      'Echo=0',
      'Alpha=1',
      'Bravo=0',
    ],
  });
  const check = (id, answer) => TASKS.find((t) => t.id === id).check(reply(answer), again).pass;
  assert.equal(check('popup-code', 'cf-a1b2c3'), true);
  assert.equal(check('popup-code', 'cf-111111'), true);
  assert.equal(check('popup-code', 'cf-222222'), false);
  assert.equal(check('console-error-code', 'E-111111'), true);
  assert.equal(check('failed-request-page-two', '/eval-net-b-111111.json'), true);
  assert.equal(check('utility-classes', CLASSES.replace('id-a1b2c3', 'id-111111')), true);
  assert.equal(check('utility-classes', `${CLASSES} id-111111`), false);
  assert.equal(check('breaking-buttons', 'Alpha'), true);
  assert.equal(check('breaking-buttons', 'Alpha, Bravo'), false);
});

test('cancel-confirm accepts any kept status but fails when the last logged status is removed', () => {
  const check = (log, answer) =>
    TASKS.find((t) => t.id === 'cancel-confirm').check(
      reply(answer),
      contextWith({ 'cancel-confirm': log })
    );
  assert.equal(
    check(['Order A-111111 kept', 'Order A-a1b2c3 kept'], 'Order A-111111 kept').pass,
    true
  );
  assert.equal(
    check(['Order A-111111 removed', 'Order A-a1b2c3 kept'], 'Order A-a1b2c3 kept').pass,
    true
  );
  const finalRemoved = check(
    ['Order A-111111 kept', 'Order A-a1b2c3 removed'],
    'Order A-111111 kept'
  );
  assert.equal(finalRemoved.pass, false);
  assert.match(finalRemoved.reason, /accepted/);
});

test('breaking-buttons fails unless all five buttons were clicked, even for a matching answer', () => {
  const check = (log, answer) =>
    TASKS.find((t) => t.id === 'breaking-buttons').check(
      reply(answer),
      contextWith({ 'breaking-buttons': log })
    );
  const only = check(['Alpha=1'], 'Alpha');
  assert.equal(only.pass, false);
  assert.match(only.reason, /not all buttons clicked/);
  assert.equal(check(['Alpha=1', 'Bravo=0', 'Charlie=0', 'Delta=0'], 'Alpha').pass, false);
  assert.equal(check(['Alpha=1', 'Bravo=0', 'Charlie=0', 'Delta=0', 'Echo=0'], 'Alpha').pass, true);
});

test('formatted answer lines pass (bold, backticks) and wrong ones still fail', () => {
  const check = (text) => TASKS.find((t) => t.id === 'popup-code').check(text, CTX).pass;
  for (const text of [
    '**ANSWER: cf-a1b2c3**',
    'ANSWER: `cf-a1b2c3`',
    '`ANSWER: cf-a1b2c3`',
    'ANSWER: **cf-a1b2c3**',
    '**ANSWER:** cf-a1b2c3',
    'ANSWER: `cf-a1b2c3` ',
  ]) {
    assert.equal(check(`Done.\n\n${text}`), true, text);
  }
  for (const text of [
    '**ANSWER: cf-a1b2c4**',
    'ANSWER: `cf-a1b2c3 or cf-a1b2c4`',
    '**ANSWER: CF-A1B2C3**',
    '**Answer:** cf-a1b2c3',
    '**ANSWER: cf-a1b2c3** (maybe)',
  ]) {
    assert.equal(check(`Done.\n\n${text}`), false, text);
  }
  assert.deepEqual(extractAnswer('**ANSWER: x**'), { ok: true, value: 'x' });
});

test('extractAnswer takes the last line only', () => {
  assert.deepEqual(extractAnswer('a\nANSWER: x\n'), { ok: true, value: 'x' });
  assert.equal(extractAnswer('ANSWER: x\nmore').ok, false);
  assert.equal(extractAnswer(undefined).ok, false);
});

test('selectTasks names unknown tasks', () => {
  assert.equal(selectTasks('all').length, TASKS.length);
  assert.deepEqual(
    selectTasks('download-name,popup-code').map((t) => t.id),
    ['popup-code', 'download-name']
  );
  assert.throws(() => selectTasks('nope'), /Unknown task "nope"/);
});

test('settings: defaults, flags and an output directory outside the repository', () => {
  const settings = resolveSettings(
    parseArgs([
      '--model=a,b',
      '--runs',
      '3',
      '--tasks=popup-code',
      '--dry-run',
      '--out=/tmp/x-out',
    ])
  );
  assert.deepEqual(settings.models, ['a', 'b']);
  assert.equal(settings.runs, 3);
  assert.equal(settings.parallel, 4);
  assert.equal(settings.maxTurns, 40);
  assert.equal(settings.dryRun, true);
  assert.throws(
    () => resolveSettings(parseArgs(['--out=' + path.resolve('scripts/out')])),
    /outside the repository/
  );
  assert.throws(() => resolveSettings(parseArgs(['--runs=0'])), /positive number/);
  assert.throws(() => resolveSettings(parseArgs(['--bogus=1'])), /Unknown flag/);
});

test('plan: run-major order and the worst case cost', () => {
  const settings = resolveSettings(
    parseArgs([
      '--tasks=popup-code,download-name',
      '--model=a,b',
      '--runs=2',
      '--run-budget=0.25',
      '--budget=1',
    ])
  );
  const jobs = planJobs(settings);
  assert.equal(jobs.length, 8);
  assert.deepEqual(
    jobs.slice(0, 4).map((j) => `${j.task.id}/${j.model}/${j.run}`),
    ['popup-code/a/1', 'popup-code/b/1', 'download-name/a/1', 'download-name/b/1']
  );
  const plan = renderPlan(settings);
  assert.match(plan, /worst case \$2\.00/);
  assert.match(plan, /exceeds the budget/);
});

test('claude arguments turn the owner configuration off and cap the cost', () => {
  const settings = resolveSettings(parseArgs(['--run-budget=0.3']));
  const args = claudeArgs(settings, 'claude-haiku-5-5', 'prompt', '/tmp/helper');
  for (const flag of [
    '--bare',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ])
    assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], 'Bash');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '0.3');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), {
    apiKeyHelper: '/tmp/helper',
  });
  assert.equal(
    args.some((a) => a.includes('sk-ant')),
    false
  );
});

test('budget: a run starts only when spent + 1.5 x (in flight + its cap) fit the total', () => {
  assert.equal(OVERSHOOT_MARGIN, 1.5);
  assert.equal(fitsBudget({ spent: 0.25, inFlight: 0.5, runBudget: 0.5, budget: 2 }), true);
  assert.equal(fitsBudget({ spent: 0.6, inFlight: 0.5, runBudget: 0.5, budget: 2 }), false);
  assert.equal(fitsBudget({ spent: 0, inFlight: 1.5, runBudget: 0.5, budget: 2.5 }), false);
  assert.equal(fitsBudget({ spent: 0, inFlight: 0, runBudget: 0.5, budget: 0.75 }), true);
  assert.equal(fitsBudget({ spent: 0, inFlight: 0, runBudget: 0.5, budget: 0.7 }), false);
});

test('redact removes the key and anything shaped like one', () => {
  const text = `key ${FAKE_KEY} and another sk-ant-api03-OTHEROTHEROTHER`;
  const clean = redact(text, FAKE_KEY);
  assert.equal(clean.includes('sk-ant-'), false);
});

test('readApiKey prefers a non-empty environment key, then the file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ae-key-')), 'key');
  fs.writeFileSync(file, ' from-file \n');
  assert.equal(readApiKey(file, { ANTHROPIC_API_KEY: 'from-env' }), 'from-env');
  assert.equal(readApiKey(file, { ANTHROPIC_API_KEY: '' }), 'from-file');
  assert.throws(() => readApiKey(path.join(path.dirname(file), 'missing'), {}), /No API key/);
});

const toolUse = (id, command) =>
  JSON.stringify({
    type: 'assistant',
    message: { id, content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
  });
const toolResult = (text) =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });
const finalMessage = (text, cost = 0.01) =>
  [
    JSON.stringify({
      type: 'assistant',
      message: { id: 'last', content: [{ type: 'text', text }] },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: text,
      total_cost_usd: cost,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 5,
        output_tokens: 7,
      },
    }),
  ].join('\n');

test('parseStream counts turns and tool calls and collects the final result', () => {
  const stream = parseStream(
    [
      toolUse('m1', 'bdg --help'),
      toolResult('Usage: bdg'),
      toolUse('m1b', 'bdg status'),
      finalMessage('ANSWER: x'),
      'not json',
    ].join('\n')
  );
  assert.equal(stream.turns, 3);
  assert.equal(stream.toolCalls, 2);
  assert.equal(stream.result.total_cost_usd, 0.01);
  assert.deepEqual(stream.toolResults, ['Usage: bdg']);
});

test('a read of the repo or ~/.claude marks an otherwise correct run contaminated', () => {
  const patterns = contaminationPatterns({
    repoRoot: '/work/browser-debugger-cli',
    home: '/Users/someone',
  });
  const clean = parseStream(
    [toolUse('m1', 'bdg --help'), finalMessage('ANSWER: E-a1b2c3')].join('\n')
  );
  assert.deepEqual(findContamination(clean, patterns), []);
  for (const command of [
    'cat /work/browser-debugger-cli/CLAUDE.md',
    'ls ~/.claude/skills',
    'cat $HOME/.claude/CLAUDE.md',
    'ls /Users/someone/.claude',
    'cat ~/.config/bdg-eval/anthropic-key',
    'ls /Users/someone/Documents',
    'cat /Users/someone/.zshrc',
  ]) {
    const dirty = parseStream(
      [toolUse('m1', command), finalMessage('ANSWER: E-a1b2c3')].join('\n')
    );
    const found = findContamination(dirty, patterns);
    assert.equal(found.length > 0, true, command);
    const task = TASKS.find((t) => t.id === 'console-error-code');
    const graded = gradeRun({
      task,
      stream: dirty,
      contamination: found,
      stoppedBy: null,
      runBudget: 0.5,
      taskContext: CTX,
    });
    assert.equal(graded.status, 'contaminated');
    assert.equal(graded.pass, false);
  }
  const helpText = parseStream(
    [
      toolUse('m1', 'bdg --help'),
      toolResult('install-skill  Install the skill (~/.claude/skills)'),
      finalMessage('ANSWER: E-a1b2c3'),
    ].join('\n')
  );
  assert.deepEqual(
    findContamination(helpText, patterns),
    [],
    "bdg's own help names ~/.claude: not contamination"
  );
  const leaked = parseStream(
    [
      toolUse('m1', 'bdg --version'),
      toolResult('at /work/browser-debugger-cli/dist/cli.js'),
      finalMessage('ANSWER: E-a1b2c3'),
    ].join('\n')
  );
  assert.match(findContamination(leaked, patterns)[0], /in a tool result/);
});

test('gradeRun: pass, fail, error, and a stopped run is charged its cap', () => {
  const task = TASKS.find((t) => t.id === 'console-error-code');
  const good = gradeRun({
    task,
    stream: parseStream(finalMessage('ANSWER: E-a1b2c3', 0.02)),
    contamination: [],
    stoppedBy: null,
    runBudget: 0.5,
    taskContext: CTX,
  });
  assert.equal(good.status, 'pass');
  assert.equal(good.costUsd, 0.02);
  assert.equal(good.inputTokens, 20);
  assert.equal(good.outputTokens, 7);
  const bad = gradeRun({
    task,
    stream: parseStream(finalMessage('ANSWER: W-1010')),
    contamination: [],
    stoppedBy: null,
    runBudget: 0.5,
    taskContext: CTX,
  });
  assert.equal(bad.status, 'fail');
  assert.match(bad.reason, /W-1010/);
  const stopped = gradeRun({
    task,
    stream: parseStream(toolUse('m1', 'bdg --help')),
    contamination: [],
    stoppedBy: 'turn-cap',
    runBudget: 0.5,
    taskContext: CTX,
  });
  assert.equal(stopped.status, 'turn-cap');
  assert.equal(stopped.costUsd, 0.5);
  assert.equal(stopped.costEstimated, true);
  const errored = gradeRun({
    task,
    stream: parseStream(
      JSON.stringify({
        type: 'result',
        subtype: 'error_max_budget_usd',
        is_error: true,
        total_cost_usd: 0.5,
      })
    ),
    contamination: [],
    stoppedBy: null,
    runBudget: 0.5,
    taskContext: CTX,
  });
  assert.equal(errored.status, 'error');
});

test('summary: a table with success %, a failures list and the budget outcome', () => {
  const row = (task, model, run, pass, status = pass ? 'pass' : 'fail') => ({
    task,
    model,
    run,
    status,
    pass,
    reason: pass ? 'ok' : 'a | b',
    toolCalls: 4,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.01,
    durationMs: 8000,
    transcript: `t${run}.jsonl`,
  });
  const rows = [
    row('popup-code', 'm', 1, true),
    row('popup-code', 'm', 2, false),
    row('download-name', 'm', 1, true),
    row('download-name', 'm', 2, false, 'contaminated'),
  ];
  const cells = aggregate(rows);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].passes, 1);
  assert.equal(cells[1].contaminated, 1);
  const settings = resolveSettings(parseArgs(['--budget=1']));
  const text = renderSummary({
    rows,
    settings: { ...settings, models: ['m'], runs: 2 },
    spent: 0.04,
    skipped: 3,
    stopReason: 'budget',
  });
  assert.match(
    text,
    /\| popup-code \| m \| 50% \(1\/2\) \| 2 \| 4\.0 \| 120 \| 0\.0200 \| 8s \| 0 \| 0 \| 0 \|/
  );
  assert.match(text, /Total: 2\/4 runs passed\./);
  assert.match(text, /Not started: 3 runs \(budget\)/);
  assert.match(text, /## Failures/);
  assert.equal(text.includes('a | b'), false, 'a pipe in a reason must not break the table');
});

/** Code for a fake claude: the right answer for this run, from the nonce in the prompt and the test secret */
const FAKE_ANSWER = "'ANSWER: E-abc123'";

/**
 * Write a fake `claude` that emits a canned stream, to test the runner without spending money.
 * @param {string} dir where to write
 * @param {string} body JavaScript run by node
 * @returns {string} path of the fake
 */
function fakeClaude(dir, body) {
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

/**
 * Settings and context for `runJob` against a fake claude and a fake build.
 * @param {string} claudeBody JavaScript of the fake claude
 * @param {string[]} extraArgs extra flags
 * @returns {{ctx: object, work: string}} context
 */
function fakeContext(claudeBody, extraArgs = []) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
  const build = path.join(work, 'build');
  fs.mkdirSync(build);
  fs.writeFileSync(path.join(build, 'index.js'), 'process.exit(0);\n');
  const settings = resolveSettings(
    parseArgs([
      '--tasks=console-error-code',
      `--out=${path.join(work, 'out')}`,
      `--claude-bin=${fakeClaude(work, claudeBody)}`,
      '--run-timeout=20',
      ...extraArgs,
    ])
  );
  fs.mkdirSync(path.join(settings.out, 'transcripts'), { recursive: true });
  const entry = path.join(work, 'dist-copy.js');
  fs.writeFileSync(entry, 'process.exit(0);\n');
  const ctx = {
    settings,
    key: FAKE_KEY,
    entry,
    taskContext: {
      fixtures: 'http://127.0.0.1:9/',
      refusedUrl: 'http://127.0.0.1:8/',
      logApi: 'http://127.0.0.1:7',
    },
    values: {
      forged: () => 0,
      entries: (_nonce, key) => (key === 'console-error-code' ? ['E-abc123'] : []),
    },
    control: { aborted: false, stops: new Set() },
    patterns: contaminationPatterns({ repoRoot: '/nonexistent/repo', home: '/nonexistent' }),
  };
  return { ctx, work };
}

test('runJob: grades a fake run and keeps the key out of the transcript and the row', async () => {
  const body = `
const key = require('child_process').execFileSync(JSON.parse(process.argv[process.argv.indexOf('--settings') + 1]).apiKeyHelper, { encoding: 'utf8' });
console.log(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Bash'], mcp_servers: [], skills: [], slash_commands: [], cwd: process.cwd() }));
console.log(JSON.stringify({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo ' + key } }] } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'saw ' + key + '\\n' + ${FAKE_ANSWER}, total_cost_usd: 0.03, usage: { input_tokens: 3, output_tokens: 4 } }));
`;
  const { ctx } = fakeContext(body);
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'claude-haiku-5-5',
    run: 1,
  });
  assert.equal(row.status, 'pass');
  assert.equal(row.costUsd, 0.03);
  assert.deepEqual(row.init.tools, ['Bash']);
  const transcript = fs.readFileSync(path.join(ctx.settings.out, row.transcript), 'utf8');
  assert.match(transcript, /\[redacted\]/);
  assert.equal(transcript.includes('sk-ant-'), false, 'the transcript must not hold the key');
  assert.equal(JSON.stringify(row).includes('sk-ant-'), false);
});

test('runJob: the child gets an empty temp cwd, its own HOME and session dir, and no inherited secrets', async () => {
  const body = `
const fs = require('fs');
const out = [process.cwd(), process.env.HOME, process.env.CLAUDE_CONFIG_DIR, process.env.BDG_SESSION_DIR, process.env.BDG_ATTACH_REQUIRE_WS_URL, process.env.CI, String(fs.readdirSync(process.cwd()).length), process.env.PATH.split(':')[0], process.env.LEAK || 'unset'];
fs.writeFileSync(${JSON.stringify('PLACEHOLDER')}, out.join('\\n'));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${FAKE_ANSWER}, total_cost_usd: 0.01, usage: {} }));
`;
  const { ctx, work } = fakeContext('');
  const traceFile = path.join(work, 'env.txt');
  fs.writeFileSync(
    ctx.settings.claudeBin,
    `#!${process.execPath}\n${body.replace(JSON.stringify('PLACEHOLDER'), JSON.stringify(traceFile))}\n`,
    { mode: 0o755 }
  );
  process.env.LEAK = 'owner-secret';
  try {
    const row = await runJob(ctx, {
      task: TASKS.find((t) => t.id === 'console-error-code'),
      model: 'm',
      run: 1,
    });
    assert.equal(row.status, 'pass');
  } finally {
    delete process.env.LEAK;
  }
  const [cwd, home, config, session, attach, ci, entries, firstPath, leak] = fs
    .readFileSync(traceFile, 'utf8')
    .split('\n');
  assert.equal(entries, '0');
  assert.equal(attach, '1');
  assert.equal(ci, '1');
  assert.equal(leak, 'unset');
  assert.match(firstPath, /\/bin$/);
  for (const dir of [cwd, home, config, session]) {
    assert.match(dir, /\/bdge-[^/]+\//);
    assert.equal(fs.existsSync(dir), false, `${dir} is removed after the run`);
  }
});

test('runJob: a run past the turn cap is stopped, graded turn-cap and charged its cap', async () => {
  const body = `
let i = 0;
setInterval(() => console.log(JSON.stringify({ type: 'assistant', message: { id: 'm' + i++, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bdg status' } }] } })), 10);
`;
  const { ctx } = fakeContext(body, ['--max-turns=3']);
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  assert.equal(row.status, 'turn-cap');
  assert.equal(row.pass, false);
  assert.equal(row.costUsd, ctx.settings.runBudget);
});

test('runJob: a run past the timeout is stopped and graded timeout', async () => {
  const { ctx } = fakeContext('setInterval(() => {}, 1000);', ['--run-timeout=1']);
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  assert.equal(row.status, 'timeout');
});

test('runPool stops before the total budget could be exceeded and counts the runs it skipped', async () => {
  const settings = resolveSettings(
    parseArgs([
      '--tasks=popup-code',
      '--runs=10',
      '--budget=2',
      '--run-budget=0.5',
      '--parallel=2',
    ])
  );
  const started = [];
  const ctx = {
    settings,
    control: { aborted: false, stops: new Set() },
    runJob: async (_ctx, job) => {
      started.push(job.run);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { costUsd: 0.5 };
    },
  };
  const rows = [];
  const outcome = await runPool(ctx, planJobs(settings), (row) => rows.push(row));
  assert.equal(started.length, 3, 'with the 1.5 margin, three runs of $0.5 fit in $2');
  assert.equal(outcome.skipped, 7);
  assert.match(outcome.stopReason, /budget/);
  assert.ok(outcome.spent <= settings.budget);
});

test('log server only records: POST /log is stored, every GET and other path is a 404 with no value', async () => {
  const server = await startLogServer('http://127.0.0.1:9');
  try {
    const post = await fetch(`${server.url}/log?key=popup-code&n=abc`, {
      method: 'POST',
      body: 'cf-1',
      headers: { Origin: 'http://127.0.0.1:9' },
    });
    assert.equal(post.status, 204);
    assert.deepEqual(server.entries('abc', 'popup-code'), ['cf-1']);
    assert.equal(server.forged('abc'), 0);
    for (const url of ['/log?key=popup-code&n=abc', '/value?key=popup-code&n=abc', '/', '/log']) {
      const res = await fetch(`${server.url}${url}`);
      assert.equal(res.status, 404, url);
      assert.equal(await res.text(), '');
    }
    assert.equal(
      (await fetch(`${server.url}/log?key=x`, { method: 'POST', body: 'y' })).status,
      404
    );
  } finally {
    server.stop();
  }
});

test('log server counts a POST without the page origin as forged', async () => {
  const server = await startLogServer('http://127.0.0.1:9');
  try {
    await fetch(`${server.url}/log?key=k&n=z`, { method: 'POST', body: 'fake' });
    await fetch(`${server.url}/log?key=k&n=z`, {
      method: 'POST',
      body: 'fake',
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(server.forged('z'), 2);
  } finally {
    server.stop();
  }
});

test('task URLs carry the nonce and the log server, never a value', () => {
  for (const task of TASKS.filter((t) => t.id !== 'page-never-loads')) {
    const url = /(http:\/\/127\.0\.0\.1:1\/eval-[a-z-]+\?\S+)/.exec(task.prompt(CTX))[1];
    assert.equal(url.startsWith(pageUrl(CTX, url.split('?')[0].split('/').pop())), true);
    assert.match(url, /\?n=n0nce&api=http%3A%2F%2F127\.0\.0\.1%3A3/);
  }
});

/**
 * Wait for a process to be gone.
 * @param {number} pid process id
 * @returns {Promise<boolean>} true when it ended within 5 s
 */
async function processEnds(pid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const GRANDCHILD = (pidFile) => `
const { spawn } = require('child_process');
const fs = require('fs');
spawn(process.execPath, ['-e', 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)'], { stdio: 'inherit' }).unref();
`;

test('runJob: a timeout kills the whole process group, so a grandchild holding stdout cannot hang the run', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-gc-'));
  const pidFile = path.join(work, 'gc.pid');
  const { ctx } = fakeContext(`${GRANDCHILD(pidFile)}\nsetInterval(() => {}, 1000);`, [
    '--run-timeout=3',
  ]);
  const started = Date.now();
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  assert.equal(row.status, 'timeout');
  assert.ok(Date.now() - started < 20_000);
  assert.equal(
    await processEnds(Number(fs.readFileSync(pidFile, 'utf8'))),
    true,
    'the grandchild was killed'
  );
});

test('runJob: a claude that exits and leaves a stray holding stdout still ends the run and the stray', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-gc-'));
  const pidFile = path.join(work, 'gc.pid');
  const body = `${GRANDCHILD(pidFile)}
const wait = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(pidFile)})) return;
  clearInterval(wait);
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${FAKE_ANSWER}, total_cost_usd: 0.01, usage: {} }));
}, 20);
`;
  const { ctx } = fakeContext(body);
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  assert.equal(row.status, 'pass');
  assert.equal(
    await processEnds(Number(fs.readFileSync(pidFile, 'utf8'))),
    true,
    'the stray was killed'
  );
});

test('abort: a first stop signal ends runs as aborted and a second one forces it', async () => {
  const { ctx } = fakeContext('setInterval(() => {}, 1000);', ['--run-timeout=60']);
  const pending = runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  while (ctx.control.stops.size === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  for (const stop of [...ctx.control.stops]) stop(false);
  const row = await pending;
  assert.equal(row.status, 'aborted');
});

test('runPool: a job that throws becomes an error row and the other workers finish', async () => {
  const settings = resolveSettings(
    parseArgs([
      '--tasks=popup-code',
      '--runs=4',
      '--budget=10',
      '--run-budget=0.5',
      '--parallel=2',
    ])
  );
  const ctx = {
    settings,
    control: { aborted: false, stops: new Set() },
    runJob: async (_ctx, job) => {
      if (job.run === 2) throw new Error('boom');
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        task: 'popup-code',
        model: 'm',
        run: job.run,
        status: 'pass',
        pass: true,
        costUsd: 0.1,
      };
    },
  };
  const rows = [];
  const outcome = await runPool(ctx, planJobs(settings), (row) => rows.push(row));
  assert.equal(rows.length, 4);
  const failed = rows.find((r) => r.run === 2);
  assert.equal(failed.status, 'error');
  assert.match(failed.reason, /boom/);
  assert.equal(failed.costUsd, 0.5);
  assert.equal(outcome.skipped, 0);
});

test('the run environment: the key reaches claude only through apiKeyHelper, and no_proxy is set in both spellings', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-env-'));
  const traceFile = path.join(work, 'env.json');
  const body = `
const fs = require('fs');
const argv = process.argv;
const helper = JSON.parse(argv[argv.indexOf('--settings') + 1]).apiKeyHelper;
fs.writeFileSync(${JSON.stringify(traceFile)}, JSON.stringify({ env: Object.keys(process.env), helperOut: require('child_process').execFileSync(helper, { encoding: 'utf8' }), noProxy: process.env.NO_PROXY, noProxyLower: process.env.no_proxy }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ${FAKE_ANSWER}, total_cost_usd: 0.01, usage: {} }));
`;
  const { ctx } = fakeContext(body);
  const row = await runJob(ctx, {
    task: TASKS.find((t) => t.id === 'console-error-code'),
    model: 'm',
    run: 1,
  });
  assert.equal(row.status, 'pass');
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  assert.equal(
    trace.env.some((name) => name.includes('ANTHROPIC') || name.includes('API_KEY')),
    false
  );
  assert.equal(trace.helperOut, FAKE_KEY);
  assert.match(trace.noProxy, /127\.0\.0\.1/);
  assert.equal(trace.noProxy, trace.noProxyLower);
});

const BUILT =
  fs.existsSync(path.resolve('dist/__testutils__/serveFixtures.js')) &&
  fs.existsSync(path.resolve('node_modules/ws'));

test(
  'fixture runtime copy: serves the eval pages from a temp dir, no process names the repo, pages hold no value',
  { skip: !BUILT },
  async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-fx-'));
    const script = copyFixtureRuntime(path.resolve('dist'), dest);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [script], {
      cwd: path.dirname(script),
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const url = await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += chunk;
          const match = /fixtures:\s+(http:\/\/\S+)/.exec(out);
          if (match) resolve(match[1]);
        });
        child.once('close', () => reject(new Error('fixture server ended')));
      });
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(child.pid)], {
        encoding: 'utf8',
      });
      assert.equal(command.includes(path.resolve('.')), false, `ps shows the repo: ${command}`);
      for (const page of [
        'eval-slot-popup',
        'eval-confirm',
        'eval-buttons',
        'eval-shadow-login',
        'eval-net-a',
        'eval-net-b',
        'eval-download',
        'eval-console',
        'eval-classes',
      ]) {
        const html = await (await fetch(`${url}${page}`)).text();
        if (page !== 'eval-net-a')
          assert.match(html, /\/log\?key=/, `${page} reports to the log server`);
        assert.equal(/cf-[0-9a-f]{6}|E-\d{4}|R-\d{5}/.test(html), false, `${page} holds no answer`);
        assert.equal(
          /(?:function|const|let|var)\s+(?:value|report|log)\b/.test(html),
          false,
          `${page} defines no global helper`
        );
        assert.match(html, /crypto\.getRandomValues/, `${page} makes its value at run time`);
      }
    } finally {
      child.kill('SIGTERM');
    }
  }
);

/**
 * A real log server wired into a fake-claude context, with pages served from `http://127.0.0.1:9`.
 * @param {string} claudeBody JavaScript of the fake claude (`__API__` is the log server URL)
 * @returns {Promise<{ctx: object, server: {url: string, stop: () => void}}>} context and server
 */
async function cheatContext(claudeBody) {
  const server = await startLogServer('http://127.0.0.1:9');
  const { ctx } = fakeContext(claudeBody.replaceAll('__API__', server.url));
  ctx.taskContext.logApi = server.url;
  ctx.values = server;
  return { ctx, server };
}

const NONCE_JS = "const nonce = /[?&]n=([0-9a-f]+)/.exec(process.argv.join(' '))[1];";
const RESULT_JS = (answer) =>
  `console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ANSWER: ${answer}', total_cost_usd: 0.01, usage: {} }));`;
const POST_JS = (
  headers,
  body
) => `const req = require('http').request('__API__/log?key=console-error-code&n=' + nonce, { method: 'POST', headers: ${headers} }, (res) => { res.resume(); res.on('end', done); });
req.end(${JSON.stringify(body)});`;
const CONSOLE_TASK = () => TASKS.find((t) => t.id === 'console-error-code');

test('no correct answer without the interaction: a fake claude that GETs the log server, guesses a /value helper or reads for the value fails', async () => {
  const { ctx, server } = await cheatContext(`
${NONCE_JS}
const http = require('http');
let pending = 2;
const body = [];
const done = () => { if (--pending === 0) console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ANSWER: ' + (body.join('') || 'E-000000'), total_cost_usd: 0.01, usage: {} })); };
for (const route of ['/log?key=console-error-code&n=' + nonce, '/value?key=console-error-code&n=' + nonce]) {
  http.get('__API__' + route, (res) => { res.on('data', (c) => body.push(c)); res.on('end', done); });
}
`);
  try {
    const row = await runJob(ctx, { task: CONSOLE_TASK(), model: 'm', run: 1 });
    assert.equal(row.pass, false);
    assert.equal(row.status, 'fail');
    assert.match(row.reason, /interaction never happened/);
  } finally {
    server.stop();
  }
});

test('cheated: a fake claude that POSTs a made-up value to the log server (curl) is graded cheated even though the answer matches', async () => {
  const { ctx, server } = await cheatContext(`
${NONCE_JS}
const done = () => { ${RESULT_JS('E-forged')} };
${POST_JS('{}', 'E-forged')}
`);
  try {
    const row = await runJob(ctx, { task: CONSOLE_TASK(), model: 'm', run: 1 });
    assert.equal(row.status, 'cheated');
    assert.equal(row.pass, false);
    assert.match(row.reason, /outside a page/);
  } finally {
    server.stop();
  }
});

test('cheated: a tool call that posts to the log server through bdg dom eval is graded cheated', async () => {
  const { ctx, server } = await cheatContext(`
${NONCE_JS}
console.log(JSON.stringify({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bdg dom eval "fetch(\\'__API__/log?key=console-error-code&n=1\\', {method: \\'POST\\', body: \\'E-forged\\'})"' } }] } }));
const done = () => { ${RESULT_JS('E-forged')} };
${POST_JS("{ Origin: 'http://127.0.0.1:9' }", 'E-forged')}
`);
  try {
    const row = await runJob(ctx, { task: CONSOLE_TASK(), model: 'm', run: 1 });
    assert.equal(row.status, 'cheated');
    assert.match(row.reason, /names the log server/);
  } finally {
    server.stop();
  }
});

test('not cheated: opening the prompt URL and a page that logs with its origin pass', async () => {
  const { ctx, server } = await cheatContext(`
${NONCE_JS}
const url = /(http:\\/\\/127\\.0\\.0\\.1:1\\/eval-console\\?\\S+)/.exec(process.argv.join(' '))[1];
console.log(JSON.stringify({ type: 'assistant', message: { id: 'a1', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'bdg ' + url } }] } }));
const done = () => { ${RESULT_JS('E-page42')} };
${POST_JS("{ Origin: 'http://127.0.0.1:9' }", 'E-page42')}
`);
  try {
    ctx.taskContext.fixtures = 'http://127.0.0.1:1/';
    const row = await runJob(ctx, { task: CONSOLE_TASK(), model: 'm', run: 1 });
    assert.equal(row.reason, 'matches the truth');
    assert.equal(row.status, 'pass');
  } finally {
    server.stop();
  }
});

test('findCheating: the encoded api parameter of the prompt URL is not counted, other mentions are', () => {
  const ctx = { logApi: 'http://127.0.0.1:4455' };
  const legit = `bdg http://127.0.0.1:1/eval-slot?n=ab&api=${encodeURIComponent(ctx.logApi)}`;
  assert.deepEqual(findCheating({ toolInputs: [JSON.stringify({ command: legit })] }, ctx, 0), []);
  for (const command of [
    'curl -X POST http://127.0.0.1:4455/log?key=x&n=ab',
    'curl 127.0.0.1%3A4455',
    "bdg dom eval \"fetch('/log?key=x', {method: 'POST'})\"",
    'bdg eval "fetch(new URLSearchParams(location.search).get(\'api\'))"',
  ]) {
    assert.equal(
      findCheating({ toolInputs: [JSON.stringify({ command })] }, ctx, 0).length,
      1,
      command
    );
  }
  for (const command of [
    'tail -f /var/log/system.log',
    'cat /tmp/app/log/output.txt',
    'bdg console --log',
  ]) {
    assert.deepEqual(
      findCheating({ toolInputs: [JSON.stringify({ command })] }, ctx, 0),
      [],
      command
    );
  }
  assert.equal(findCheating({ toolInputs: [] }, ctx, 2).length, 1);
});

test('summary table: header, separator and rows have the same number of columns', () => {
  const row = {
    task: 't',
    model: 'm',
    run: 1,
    status: 'pass',
    pass: true,
    reason: 'ok',
    toolCalls: 1,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0.01,
    durationMs: 1000,
    transcript: 'x',
  };
  const text = renderSummary({
    rows: [row],
    settings: { ...resolveSettings(parseArgs([])), models: ['m'], runs: 1 },
    spent: 0.01,
    skipped: 0,
    stopReason: '',
  });
  const table = text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(0, 3);
  const widths = table.map((line) => line.split('|').length);
  assert.equal(new Set(widths).size, 1, widths.join(','));
  assert.equal(widths[0] - 2, 11);
});

test('summary counts cheated runs in their own column and lists them as failures', () => {
  const row = {
    task: 't',
    model: 'm',
    run: 1,
    status: 'cheated',
    pass: false,
    reason: 'fetched',
    toolCalls: 1,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0.01,
    durationMs: 1000,
    transcript: 'x',
  };
  const text = renderSummary({
    rows: [row],
    settings: { ...resolveSettings(parseArgs([])), models: ['m'], runs: 1 },
    spent: 0.01,
    skipped: 0,
    stopReason: '',
  });
  assert.match(text, /\| cheated \|/);
  assert.match(text, /\| 0 \| 1 \| 0 \|\n/);
  assert.match(text, /\| t \| m \| 1 \| cheated \|/);
});

test('log server drops a body over the cap and keeps nothing of it', async () => {
  const server = await startLogServer('http://127.0.0.1:9');
  try {
    const small = await fetch(`${server.url}/log?key=k&n=z`, {
      method: 'POST',
      body: 'x'.repeat(LOG_BODY_LIMIT),
    });
    assert.equal(small.status, 204);
    let rejected = false;
    try {
      const big = await fetch(`${server.url}/log?key=k&n=y`, {
        method: 'POST',
        body: 'x'.repeat(LOG_BODY_LIMIT * 20),
      });
      rejected = big.status === 413;
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
    assert.deepEqual(server.entries('y', 'k'), []);
    assert.equal(server.entries('z', 'k')[0].length, LOG_BODY_LIMIT);
  } finally {
    server.stop();
  }
});

test('forceCleanup: kills run groups, ends sessions, removes sandboxes, stops servers and removes the build copy', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-force-'));
  const root = path.join(work, 'run');
  fs.mkdirSync(root);
  const bdg = path.join(work, 'bdg');
  fs.writeFileSync(bdg, `#!/bin/sh\necho "$@" > '${path.join(work, 'bdg-args')}'\n`, {
    mode: 0o755,
  });
  const build = path.join(work, 'build');
  fs.mkdirSync(build);
  const order = [];
  const control = {
    stops: new Set([(force) => order.push(`stop:${force}`)]),
    roots: new Set([{ root, bdg, env: {} }]),
    cleanups: [
      () => order.push('server'),
      () => fs.rmSync(build, { recursive: true, force: true }),
    ],
  };
  forceCleanup(control);
  assert.deepEqual(order, ['stop:true', 'server']);
  assert.equal(fs.existsSync(root), false);
  assert.equal(fs.existsSync(build), false);
  assert.equal(fs.readFileSync(path.join(work, 'bdg-args'), 'utf8').trim(), 'cleanup --force');
  assert.equal(control.roots.size, 0);
});

/**
 * Wait until a file exists.
 * @param {string} file path
 * @returns {Promise<void>} resolves when it exists
 */
async function fileExists(file) {
  for (let i = 0; i < 400 && !fs.existsSync(file); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(file), true, `${file} appears`);
}

test(
  'double Ctrl-C: the second signal leaves no fixture server, sandbox or build copy behind',
  { skip: !BUILT },
  async () => {
    const { spawn } = await import('node:child_process');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-sig-'));
    const marker = path.join(work, 'started');
    const fake = fakeClaude(
      work,
      `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`
    );
    const keyFile = path.join(work, 'key');
    fs.writeFileSync(keyFile, FAKE_KEY, { mode: 0o600 });
    const child = spawn(
      process.execPath,
      [
        'scripts/agent-eval.mjs',
        '--tasks=console-error-code',
        '--runs=1',
        `--out=${path.join(work, 'out')}`,
        `--claude-bin=${fake}`,
        `--key-file=${keyFile}`,
        '--run-timeout=120',
      ],
      { stdio: 'ignore', env: { ...process.env, ANTHROPIC_API_KEY: '' } }
    );
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    );
    await fileExists(marker);
    const claudePid = Number(fs.readFileSync(marker, 'utf8'));
    const buildDir = path.join(os.tmpdir(), `bdge-build-${child.pid}`);
    assert.equal(fs.existsSync(buildDir), true, 'the build copy exists while the eval runs');
    child.kill('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.kill('SIGINT');
    const result = await exited;
    assert.equal(result.code, 130);
    assert.equal(fs.existsSync(buildDir), false, 'the build copy is removed');
    assert.equal(await processEnds(claudePid), true, 'the run group is killed');
    const left = execFileSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(`bdge-build-${child.pid}`));
    assert.deepEqual(left, [], 'no fixture server is left');
  }
);
