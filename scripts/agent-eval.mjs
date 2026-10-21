#!/usr/bin/env node
/**
 * Agent eval harness (#888): runs the scenario tasks of `scripts/agent-eval-tasks.mjs` through
 * `claude -p` N times per model on local fixture pages, grades every answer with a script (no
 * LLM judge) and writes one JSONL line per run plus a Markdown table (task x model: success %,
 * tool calls, tokens, dollars). It spends money, so it is not part of `npm test`.
 *
 * ```bash
 * npm run build
 * node scripts/agent-eval.mjs --dry-run --model=claude-haiku-5-5 --runs=10     # plan and worst case
 * node scripts/agent-eval.mjs --tasks=popup-token,download-name --runs=3 --budget=2
 * ```
 *
 * Flags: --tasks=a,b|all  --model=a,b (default claude-haiku-5-5)  --runs=N (1)  --parallel=N (4)
 * --budget=USD (5)  --run-budget=USD (0.5, passed as --max-budget-usd)  --max-turns=N (40)
 * --run-timeout=SECONDS (600)  --build=DIR (the repo's dist)  --out=DIR (/tmp/bdg-agent-eval-*)
 * --key-file=PATH (~/.config/bdg-eval/anthropic-key)  --fixtures-url=URL  --claude-bin=PATH  --dry-run
 *
 * Isolation of the agent under test, per run:
 * - an empty temp cwd, and a temp HOME and CLAUDE_CONFIG_DIR, so there is no ~/.claude;
 * - `--bare` (no hooks, auto-memory, CLAUDE.md discovery, plugin sync, keychain),
 *   `--setting-sources ""` (no user, project or local settings), `--strict-mcp-config` (no MCP
 *   servers), `--disable-slash-commands` (no skills), `--tools Bash`, `--no-session-persistence`;
 * - `bdg` is a PATH script (BDG_SESSION_DIR, BDG_ATTACH_REQUIRE_WS_URL=1 and CI=1, so Chrome is
 *   headless) over a copy of the build in a temp dir, so the repo's path does not show;
 * - a scrubbed environment: only the API key, proxy settings and a minimal PATH reach the child.
 * A transcript that mentions the repo path or ~/.claude is graded `contaminated`, not pass.
 * `claude` has no turn-cap flag, so the harness counts assistant turns in the stream and stops the run.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPrompt, extractAnswer, selectTasks } from './agent-eval-tasks.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEY_FILE = path.join(os.homedir(), '.config/bdg-eval/anthropic-key');
const DEFAULT_MODEL = 'claude-haiku-5-5';
const KILL_GRACE_MS = 5_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const PASSTHROUGH_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CHROME_PATH', 'LANG'];
const BUILD_FILES = ['index.js', 'cli.js', 'daemon.js'];

/**
 * Parse `--flag=value` and `--flag value` arguments.
 * @param {string[]} argv arguments after the script name
 * @returns {Record<string, string | true>} flags by name; a flag without value is `true`
 */
export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (arg === '--dry-run') {
      flags['dry-run'] = true;
    } else {
      flags[arg.slice(2)] = argv[++i] ?? '';
    }
  }
  return flags;
}

/**
 * A positive number flag with a default.
 * @param {Record<string, string | true>} flags parsed flags
 * @param {string} name flag name
 * @param {number} fallback default
 * @returns {number} the value
 */
function numberFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number, got "${flags[name]}"`);
  return value;
}

/**
 * Turn flags into the eval's settings.
 * @param {Record<string, string | true>} flags parsed flags
 * @param {Date} [now] clock for the default output directory
 * @returns {object} settings
 */
export function resolveSettings(flags, now = new Date()) {
  const known = new Set(['tasks', 'model', 'runs', 'parallel', 'budget', 'run-budget', 'max-turns', 'run-timeout', 'build', 'out', 'key-file', 'fixtures-url', 'claude-bin', 'dry-run']);
  const unknown = Object.keys(flags).find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown flag --${unknown}`);
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const out = path.resolve(String(flags.out ?? path.join(os.tmpdir(), `bdg-agent-eval-${stamp}`)));
  if (out === REPO_ROOT || out.startsWith(REPO_ROOT + path.sep)) throw new Error('--out must be outside the repository');
  const settings = {
    tasks: selectTasks(flags.tasks === undefined ? undefined : String(flags.tasks)),
    models: String(flags.model ?? DEFAULT_MODEL).split(',').map((m) => m.trim()).filter(Boolean),
    runs: numberFlag(flags, 'runs', 1),
    parallel: numberFlag(flags, 'parallel', 4),
    budget: numberFlag(flags, 'budget', 5),
    runBudget: numberFlag(flags, 'run-budget', 0.5),
    maxTurns: numberFlag(flags, 'max-turns', 40),
    runTimeoutMs: numberFlag(flags, 'run-timeout', 600) * 1000,
    build: path.resolve(String(flags.build ?? path.join(REPO_ROOT, 'dist'))),
    out,
    keyFile: String(flags['key-file'] ?? DEFAULT_KEY_FILE),
    fixturesUrl: flags['fixtures-url'] === undefined ? undefined : String(flags['fixtures-url']),
    claudeBin: flags['claude-bin'] === undefined ? undefined : String(flags['claude-bin']),
    dryRun: flags['dry-run'] === true,
  };
  if (settings.models.length === 0) throw new Error('--model names no model');
  return settings;
}

/**
 * The runs of an eval, ordered by run number first so that a budget stop leaves every task and
 * model with a similar number of runs.
 * @param {{tasks: {id: string}[], models: string[], runs: number}} settings eval settings
 * @returns {{task: {id: string}, model: string, run: number}[]} jobs
 */
export function planJobs(settings) {
  const jobs = [];
  for (let run = 1; run <= settings.runs; run++) {
    for (const task of settings.tasks) {
      for (const model of settings.models) jobs.push({ task, model, run });
    }
  }
  return jobs;
}

/**
 * The plan `--dry-run` prints: counts and the worst case, which spends nothing.
 * @param {object} settings eval settings
 * @returns {string} plan text
 */
export function renderPlan(settings) {
  const jobs = planJobs(settings);
  const worst = jobs.length * settings.runBudget;
  const lines = [
    `tasks:   ${settings.tasks.length} (${settings.tasks.map((t) => t.id).join(', ')})`,
    `models:  ${settings.models.length} (${settings.models.join(', ')})`,
    `runs:    ${settings.runs} per task and model`,
    `total:   ${jobs.length} runs, ${settings.parallel} in parallel, at most ${settings.maxTurns} turns and ${settings.runTimeoutMs / 1000}s each`,
    `cost:    worst case $${worst.toFixed(2)} (${jobs.length} x $${settings.runBudget} per-run cap); total budget $${settings.budget}`,
  ];
  if (worst > settings.budget) {
    lines.push(`note:    the worst case exceeds the budget: the eval stops starting runs when spent + in flight + the per-run cap would pass $${settings.budget}`);
  }
  return lines.join('\n');
}

/**
 * Remove an API key (and anything shaped like one) from text.
 * @param {string} text text that may hold the key
 * @param {string} key the key in use
 * @returns {string} text without the key
 */
export function redact(text, key) {
  let result = text;
  if (key) result = result.split(key).join('[redacted]');
  return result.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

/**
 * Read the API key from the environment or the key file.
 * @param {string} keyFile path of the key file
 * @param {NodeJS.ProcessEnv} [env] environment
 * @returns {string} the key
 */
export function readApiKey(keyFile, env = process.env) {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  let text;
  try {
    text = fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    throw new Error(`No API key: set ANTHROPIC_API_KEY or put the key in ${keyFile} (mode 600)`);
  }
  if (!text) throw new Error(`The key file ${keyFile} is empty`);
  return text;
}

/**
 * What the stream of one `claude -p --output-format stream-json` run showed.
 * @param {string} streamText the raw stream, one JSON object per line
 * @returns {{turns: number, toolCalls: number, toolInputs: string[], toolResults: string[], result: object | null, lastText: string, init: object | null}} summary
 */
export function parseStream(streamText) {
  const summary = { turns: 0, toolCalls: 0, toolInputs: [], toolResults: [], result: null, lastText: '', init: null };
  const seenTurns = new Set();
  for (const line of streamText.split('\n')) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === 'system' && message.subtype === 'init') summary.init = message;
    else if (message.type === 'result') summary.result = message;
    else if (message.type === 'assistant') collectAssistant(message, summary, seenTurns);
    else if (message.type === 'user') collectToolResults(message, summary);
  }
  return summary;
}

/**
 * Add an assistant message to the stream summary.
 * @param {any} message stream message
 * @param {any} summary summary to extend
 * @param {Set<string>} seenTurns message ids already counted
 */
function collectAssistant(message, summary, seenTurns) {
  const id = message.message?.id ?? `${seenTurns.size}`;
  if (!seenTurns.has(id)) {
    seenTurns.add(id);
    summary.turns++;
  }
  for (const block of message.message?.content ?? []) {
    if (block.type === 'tool_use') {
      summary.toolCalls++;
      summary.toolInputs.push(JSON.stringify(block.input ?? {}));
    } else if (block.type === 'text') {
      summary.lastText = block.text;
    }
  }
}

/**
 * Add the tool results of a user message to the stream summary.
 * @param {any} message stream message
 * @param {any} summary summary to extend
 */
function collectToolResults(message, summary) {
  const content = message.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type !== 'tool_result') continue;
    summary.toolResults.push(typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''));
  }
}

/**
 * Patterns that show the agent reached for the repository or the owner's Claude configuration.
 * @param {{repoRoot: string, home: string}} paths repository root and the real home directory
 * @returns {{label: string, pattern: RegExp, inputsOnly?: boolean}[]} patterns; `inputsOnly` ones are checked in tool calls only, since bdg's own help text names ~/.claude
 */
export function contaminationPatterns(paths) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const roots = new Set([paths.repoRoot]);
  try {
    roots.add(fs.realpathSync(paths.repoRoot));
  } catch {
    roots.add(paths.repoRoot);
  }
  return [
    ...[...roots].map((root) => ({ label: `repository path ${root}`, pattern: new RegExp(escape(root)) })),
    { label: `${paths.home}/.claude`, pattern: new RegExp(escape(`${paths.home}/.claude`)) },
    { label: '~/.claude', pattern: /(?:~|\$HOME|\$\{HOME\})\/\.claude\b/, inputsOnly: true },
  ];
}

/**
 * The contamination a run's tool calls and results show.
 * @param {{toolInputs: string[], toolResults: string[]}} stream parsed stream
 * @param {{label: string, pattern: RegExp}[]} patterns patterns from `contaminationPatterns`
 * @returns {string[]} labels of what was seen, each once, with where
 */
export function findContamination(stream, patterns) {
  const found = [];
  for (const { label, pattern, inputsOnly } of patterns) {
    if (stream.toolInputs.some((text) => pattern.test(text))) found.push(`${label} in a tool call`);
    else if (!inputsOnly && stream.toolResults.some((text) => pattern.test(text))) found.push(`${label} in a tool result`);
  }
  return found;
}

/**
 * Turn a run's stream into its row: status, the checker's verdict, cost and counts.
 * @param {object} args run data
 * @param {{id: string, check: (reply: string) => {pass: boolean, reason: string}}} args.task the task
 * @param {ReturnType<typeof parseStream>} args.stream parsed stream
 * @param {string[]} args.contamination what contaminated the run
 * @param {'turn-cap' | 'timeout' | 'aborted' | null} args.stoppedBy why the harness stopped the child, if it did
 * @param {number} args.runBudget per-run cap, charged when the cost is unknown
 * @returns {object} the graded fields of the run
 */
export function gradeRun({ task, stream, contamination, stoppedBy, runBudget }) {
  const result = stream.result;
  const costKnown = typeof result?.total_cost_usd === 'number';
  const reply = typeof result?.result === 'string' && result.result !== '' ? result.result : stream.lastText;
  const usage = result?.usage ?? {};
  const base = {
    turns: stream.turns,
    toolCalls: stream.toolCalls,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    costUsd: costKnown ? result.total_cost_usd : runBudget,
    costEstimated: !costKnown,
    answer: extractAnswer(reply).value ?? null,
  };
  if (stoppedBy) return { ...base, status: stoppedBy, pass: false, reason: `stopped: ${stoppedBy}` };
  if (!result || result.is_error) {
    return { ...base, status: 'error', pass: false, reason: result ? `claude reported ${result.subtype ?? 'an error'}` : 'claude ended without a result' };
  }
  const verdict = task.check(reply);
  if (verdict.pass && contamination.length > 0) {
    return { ...base, status: 'contaminated', pass: false, reason: `read outside the sandbox: ${contamination.join('; ')}` };
  }
  return { ...base, status: verdict.pass ? 'pass' : 'fail', pass: verdict.pass, reason: verdict.reason };
}

/**
 * Aggregate run rows into one line per task and model.
 * @param {{task: string, model: string, status: string, pass: boolean, toolCalls: number, inputTokens: number, outputTokens: number, costUsd: number, durationMs: number}[]} rows run rows
 * @returns {object[]} cells in first-seen order
 */
export function aggregate(rows) {
  const cells = new Map();
  for (const row of rows) {
    const key = `${row.task}\u0000${row.model}`;
    const cell = cells.get(key) ?? { task: row.task, model: row.model, runs: 0, passes: 0, contaminated: 0, errors: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 };
    cell.runs++;
    if (row.pass) cell.passes++;
    if (row.status === 'contaminated') cell.contaminated++;
    if (['error', 'timeout', 'turn-cap', 'aborted'].includes(row.status)) cell.errors++;
    cell.toolCalls += row.toolCalls;
    cell.tokens += row.inputTokens + row.outputTokens;
    cell.cost += row.costUsd;
    cell.durationMs += row.durationMs;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/**
 * The Markdown summary of an eval.
 * @param {object} args summary inputs
 * @param {object[]} args.rows run rows
 * @param {object} args.settings eval settings
 * @param {number} args.spent dollars spent
 * @param {number} args.skipped runs not started because of the budget or an abort
 * @param {string} args.stopReason why the eval ended early, or empty
 * @returns {string} Markdown
 */
export function renderSummary({ rows, settings, spent, skipped, stopReason }) {
  const cells = aggregate(rows);
  const lines = [
    '# Agent eval summary',
    '',
    `Models: ${settings.models.join(', ')}. Runs per task and model: ${settings.runs}. Cost: $${spent.toFixed(4)} of $${settings.budget} budget.`,
    '',
    '| task | model | success | runs | tool calls (avg) | tokens (avg) | $ | time (avg) | contaminated | errors |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const c of cells) {
    const pct = Math.round((c.passes / c.runs) * 100);
    lines.push(
      `| ${c.task} | ${c.model} | ${pct}% (${c.passes}/${c.runs}) | ${c.runs} | ${(c.toolCalls / c.runs).toFixed(1)} | ${Math.round(c.tokens / c.runs)} | ${c.cost.toFixed(4)} | ${Math.round(c.durationMs / c.runs / 1000)}s | ${c.contaminated} | ${c.errors} |`
    );
  }
  const total = rows.length;
  const passes = rows.filter((r) => r.pass).length;
  lines.push('', `Total: ${passes}/${total} runs passed.`);
  if (skipped > 0) lines.push(`Not started: ${skipped} runs (${stopReason || 'stopped early'}).`);
  const failures = rows.filter((r) => !r.pass);
  if (failures.length > 0) {
    lines.push('', '## Failures', '', '| task | model | run | status | reason | transcript |', '| --- | --- | ---: | --- | --- | --- |');
    for (const r of failures) lines.push(`| ${r.task} | ${r.model} | ${r.run} | ${r.status} | ${String(r.reason).replace(/\|/g, '/')} | ${r.transcript} |`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Whether another run may start without the total budget being exceeded in the worst case.
 * @param {{spent: number, inFlight: number, runBudget: number, budget: number}} state money state
 * @returns {boolean} true when a run fits
 */
export function fitsBudget({ spent, inFlight, runBudget, budget }) {
  return spent + inFlight + runBudget <= budget + 1e-9;
}

/**
 * Find an executable on a PATH string.
 * @param {string} name command name
 * @param {string} searchPath PATH value
 * @returns {string} absolute path
 */
function resolveBin(name, searchPath) {
  for (const dir of searchPath.split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Cannot find "${name}" on PATH`);
}

/**
 * Copy the build under test into a temp directory, so the PATH script's target does not show the repo.
 * @param {string} build the build directory (`dist/`)
 * @param {string} dest directory to create
 * @returns {string} path of the copied `dist/index.js`
 */
export function copyBuild(build, dest) {
  fs.mkdirSync(path.join(dest, 'dist'), { recursive: true });
  if (!fs.existsSync(path.join(build, 'index.js'))) throw new Error(`No build at ${build}: run npm run build first`);
  for (const file of BUILD_FILES) {
    if (fs.existsSync(path.join(build, file))) fs.copyFileSync(path.join(build, file), path.join(dest, 'dist', file));
  }
  fs.writeFileSync(path.join(dest, 'package.json'), '{"type":"module"}\n');
  const protocol = path.join(path.dirname(build), 'node_modules/devtools-protocol');
  if (fs.existsSync(protocol)) fs.cpSync(protocol, path.join(dest, 'node_modules/devtools-protocol'), { recursive: true });
  return path.join(dest, 'dist/index.js');
}

/**
 * Write the `bdg` PATH script of one run.
 * @param {string} binDir directory for the script
 * @param {string} entry the copied `dist/index.js`
 * @param {string} sessionDir the run's BDG_SESSION_DIR
 */
function writeBdgScript(binDir, entry, sessionDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const script = `#!/bin/sh\nexport BDG_SESSION_DIR='${sessionDir}' BDG_ATTACH_REQUIRE_WS_URL=1 CI=1\nexec '${process.execPath}' '${entry}' "$@"\n`;
  fs.writeFileSync(path.join(binDir, 'bdg'), script, { mode: 0o755 });
}

/**
 * The scrubbed environment of one run's `claude` process.
 * @param {object} args run directories and key
 * @returns {NodeJS.ProcessEnv} environment
 */
function childEnv({ binDir, home, configDir, sessionDir, key }) {
  const env = {
    PATH: [binDir, path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter),
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_API_KEY: key,
    BDG_SESSION_DIR: sessionDir,
    BDG_ATTACH_REQUIRE_WS_URL: '1',
    CI: '1',
    NO_COLOR: '1',
  };
  for (const name of PASSTHROUGH_ENV) if (process.env[name]) env[name] = process.env[name];
  const bypass = '127.0.0.1,localhost';
  env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${bypass}` : bypass;
  return env;
}

/**
 * The `claude` arguments of one run (see the header for why each isolation flag).
 * @param {object} settings eval settings
 * @param {string} model model
 * @param {string} prompt prompt
 * @returns {string[]} arguments
 */
export function claudeArgs(settings, model, prompt) {
  return [
    '-p', prompt,
    '--model', model,
    '--bare',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--tools', 'Bash',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    '--max-budget-usd', String(settings.runBudget),
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

/**
 * Run a command to completion without throwing.
 * @param {string} file command
 * @param {string[]} args arguments
 * @param {NodeJS.ProcessEnv} env environment
 * @returns {Promise<void>} resolves when it ends or times out
 */
function runQuietly(file, args, env) {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: CLEANUP_TIMEOUT_MS }, () => resolve());
  });
}

/**
 * The message id of an assistant line of the stream.
 * @param {string} line one stream line
 * @returns {string | null} the id, or null for any other line
 */
function assistantTurnId(line) {
  if (!line.includes('"type":"assistant"')) return null;
  try {
    const message = JSON.parse(line);
    return message.type === 'assistant' ? String(message.message?.id ?? line.length + ':' + line.slice(-40)) : null;
  } catch {
    return null;
  }
}

/**
 * Run `claude -p` and stream its output to a transcript, enforcing the turn cap and the timeout.
 * @param {object} args spawn data
 * @returns {Promise<{streamText: string, stoppedBy: 'turn-cap' | 'timeout' | 'aborted' | null, code: number | null}>} what happened
 */
function runClaude({ claudeBin, argv, env, cwd, maxTurns, timeoutMs, control, key }) {
  return new Promise((resolve) => {
    const child = spawn(claudeBin, argv, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let streamText = '';
    let stoppedBy = null;
    const stop = (reason) => {
      if (stoppedBy || child.exitCode !== null) return;
      stoppedBy = reason;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    control.stops.add(() => stop('aborted'));
    const turnIds = new Set();
    let pending = '';
    child.stdout.on('data', (chunk) => {
      streamText += chunk.toString();
      const lines = (pending + chunk.toString()).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const id = assistantTurnId(line);
        if (id !== null) turnIds.add(id);
      }
      if (turnIds.size > maxTurns) stop('turn-cap');
    });
    child.stderr.on('data', (chunk) => {
      streamText += JSON.stringify({ type: 'stderr', text: redact(chunk.toString(), key) }) + '\n';
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ streamText: streamText + JSON.stringify({ type: 'spawn-error', text: error.message }) + '\n', stoppedBy, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ streamText, stoppedBy, code });
    });
  });
}

/**
 * Run one job in its own sandbox and clean it up afterwards, whatever happens.
 * @param {object} ctx shared run context
 * @param {{task: any, model: string, run: number}} job the job
 * @returns {Promise<object>} the run's row
 */
export async function runJob(ctx, job) {
  const { settings, key, entry } = ctx;
  const root = fs.mkdtempSync(path.join('/tmp', 'bdge-'));
  const dirs = { home: path.join(root, 'h'), configDir: path.join(root, 'c'), cwd: path.join(root, 'w'), sessionDir: path.join(root, 's'), binDir: path.join(root, 'bin') };
  const started = Date.now();
  const env = childEnv({ ...dirs, key });
  try {
    for (const dir of [dirs.home, dirs.configDir, dirs.cwd, dirs.sessionDir]) fs.mkdirSync(dir, { recursive: true });
    writeBdgScript(dirs.binDir, entry, dirs.sessionDir);
    const prompt = buildPrompt(job.task, ctx.taskContext);
    const run = await runClaude({ claudeBin: settings.claudeBin, argv: claudeArgs(settings, job.model, prompt), env, cwd: dirs.cwd, maxTurns: settings.maxTurns, timeoutMs: settings.runTimeoutMs, control: ctx.control, key });
    const stream = parseStream(run.streamText);
    const graded = gradeRun({ task: job.task, stream, contamination: findContamination(stream, ctx.patterns), stoppedBy: run.stoppedBy, runBudget: settings.runBudget });
    const name = `${job.task.id}-${job.model}-${job.run}.jsonl`;
    fs.writeFileSync(path.join(settings.out, 'transcripts', name), redact(run.streamText, key));
    return { task: job.task.id, model: job.model, run: job.run, ...graded, durationMs: Date.now() - started, transcript: path.join('transcripts', name), init: summariseInit(stream.init) };
  } finally {
    await runQuietly(path.join(dirs.binDir, 'bdg'), ['stop'], env);
    await runQuietly(path.join(dirs.binDir, 'bdg'), ['cleanup', '--force'], env);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The parts of the init message that show what the agent's context held.
 * @param {any} init the stream's init message
 * @returns {object | null} tools, MCP servers, skills and slash commands
 */
function summariseInit(init) {
  if (!init) return null;
  return { tools: init.tools, mcpServers: init.mcp_servers, skills: init.skills, slashCommands: init.slash_commands, cwd: init.cwd };
}

/**
 * Pull jobs through a pool, starting a run only when the budget allows it.
 * @param {object} ctx run context
 * @param {object[]} jobs planned jobs
 * @param {(row: object) => void} onRow called with every finished row
 * @returns {Promise<{skipped: number, stopReason: string, spent: number}>} outcome
 */
export async function runPool(ctx, jobs, onRow) {
  const { settings } = ctx;
  const state = { next: 0, spent: 0, inFlight: 0, stopReason: '' };
  const worker = async () => {
    while (state.next < jobs.length && !state.stopReason && !ctx.control.aborted) {
      if (!fitsBudget({ spent: state.spent, inFlight: state.inFlight, runBudget: settings.runBudget, budget: settings.budget })) {
        if (state.inFlight === 0) state.stopReason = `budget: $${state.spent.toFixed(4)} spent, another run could cost $${settings.runBudget}`;
        else await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      const job = jobs[state.next++];
      state.inFlight += settings.runBudget;
      try {
        const row = await ctx.runJob(ctx, job);
        state.spent += row.costUsd;
        onRow(row);
      } finally {
        state.inFlight -= settings.runBudget;
      }
    }
  };
  await Promise.all(Array.from({ length: settings.parallel }, worker));
  if (ctx.control.aborted) state.stopReason = 'interrupted';
  return { skipped: jobs.length - state.next, stopReason: state.stopReason, spent: state.spent };
}

/**
 * Pick a TCP port nothing listens on, for the task that opens a refused connection.
 * @returns {Promise<number>} a free port
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Start the shared fixture server from the repo and return its URL and a stop function.
 * @returns {Promise<{url: string, stop: () => void}>} server handle
 */
function startFixtures() {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), ['src/__testutils__/serveFixtures.ts'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = /fixtures:\s+(http:\/\/\S+)/.exec(output);
      if (match) resolve({ url: match[1], stop: () => child.kill('SIGTERM') });
    });
    child.once('close', () => reject(new Error('The fixture server ended before it printed its URL')));
  });
}

/**
 * Run the eval described by the settings.
 * @param {object} settings eval settings
 * @returns {Promise<number>} exit code
 */
export async function main(settings) {
  process.stdout.write(renderPlan(settings) + '\n');
  if (settings.dryRun) return 0;
  const key = readApiKey(settings.keyFile);
  settings.claudeBin ??= resolveBin('claude', process.env.PATH ?? '');
  fs.mkdirSync(path.join(settings.out, 'transcripts'), { recursive: true });
  const build = path.join(os.tmpdir(), `bdge-build-${process.pid}`);
  const entry = copyBuild(settings.build, build);
  const fixtures = settings.fixturesUrl ? { url: settings.fixturesUrl.replace(/\/?$/, '/'), stop: () => {} } : await startFixtures();
  const control = { aborted: false, stops: new Set() };
  const onSignal = () => {
    control.aborted = true;
    for (const stop of control.stops) stop();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const rows = [];
  try {
    const taskContext = { fixtures: fixtures.url, refusedUrl: `http://127.0.0.1:${await freePort()}/` };
    const ctx = { settings, key, entry, taskContext, control, runJob, patterns: contaminationPatterns({ repoRoot: REPO_ROOT, home: os.homedir() }) };
    const jsonl = path.join(settings.out, 'runs.jsonl');
    const outcome = await runPool(ctx, planJobs(settings), (row) => {
      rows.push(row);
      fs.appendFileSync(jsonl, redact(JSON.stringify(row), key) + '\n');
      process.stdout.write(`${row.pass ? 'pass' : row.status.padEnd(4)}  ${row.task} ${row.model} #${row.run}  $${row.costUsd.toFixed(4)}  ${row.reason}\n`);
    });
    const summary = renderSummary({ rows, settings, spent: outcome.spent, skipped: outcome.skipped, stopReason: outcome.stopReason });
    fs.writeFileSync(path.join(settings.out, 'SUMMARY.md'), redact(summary, key));
    process.stdout.write(`\n${summary}\nOutput: ${settings.out}\n`);
    return control.aborted ? 130 : 0;
  } finally {
    fixtures.stop();
    fs.rmSync(build, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(resolveSettings(parseArgs(process.argv.slice(2))));
  } catch (error) {
    process.stderr.write(`agent-eval: ${error.message}\n`);
    process.exitCode = 2;
  }
}
