/**
 * Tasks and checkers of the agent eval harness (`scripts/agent-eval.mjs`, #888).
 *
 * One table row per task: the scenario it comes from (`.claude/skills/ship/scenarios.md`),
 * the prompt the agent gets (a goal, never a bdg command or feature name) and a deterministic
 * checker. The truth lives in the checkers, never in a prompt. The agent ends with a last line
 * `ANSWER: <value>`; a checker compares that value with the truth exactly and case-sensitively
 * (after trimming and a trailing period), so a hedged answer ("A or B") or a right value with a
 * wrong extra or repeated item fails. Most truths are a per-run value (HMAC of a nonce, from the
 * harness's value server) that the fixture page shows only after the interaction, so the page
 * source never holds the answer. The pages are `src/__testutils__/fixturePages/agentEvalFixtures.ts`.
 */

/** @typedef {{pass: boolean, reason: string}} Verdict */
/** @typedef {{fixtures: string, refusedUrl: string, valueApi: string, nonce: string, value: (key: string) => string}} TaskContext */
/** @typedef {{id: string, scenario: string, title: string, prompt: (ctx: TaskContext) => string, check: (reply: string, ctx: TaskContext) => Verdict}} Task */

const ANSWER_LINE = /^ANSWER:[ \t]*(.*)$/;

/**
 * The agent's final answer: the value on the last non-empty line, which must be `ANSWER: <value>`.
 * @param {string} text the agent's final reply
 * @returns {{ok: true, value: string} | {ok: false, reason: string}} the value or why there is none
 */
export function extractAnswer(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) return { ok: false, reason: 'empty reply' };
  const match = ANSWER_LINE.exec(last);
  if (!match) return { ok: false, reason: 'the last line is not "ANSWER: <value>"' };
  const value = match[1].trim();
  if (value === '') return { ok: false, reason: 'the ANSWER line is empty' };
  return { ok: true, value };
}

/**
 * Normalise one value for comparison: trim, collapse spaces, drop a trailing period. Case is kept:
 * every truth here is case-sensitive (tokens, class names, paths, file names).
 * @param {string} value raw value
 * @returns {string} comparable form
 */
function normalise(value) {
  return value.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
}

/**
 * Checker for an answer that is one exact value.
 * @param {(ctx: TaskContext) => string[]} accepted accepted spellings of the truth for this run
 * @returns {(reply: string, ctx: TaskContext) => Verdict} checker taking the agent's final reply
 */
export function exactValue(accepted) {
  return (reply, ctx) => {
    const parsed = extractAnswer(reply);
    if (!parsed.ok) return { pass: false, reason: parsed.reason };
    const wanted = accepted(ctx);
    return wanted.includes(normalise(parsed.value))
      ? { pass: true, reason: 'matches the truth' }
      : { pass: false, reason: `answered "${parsed.value}", expected "${wanted[0]}"` };
  };
}

/**
 * Checker for an answer that is a set of items separated by commas or spaces; order is free,
 * items are compared exactly, and a missing, extra or repeated item fails.
 * @param {(ctx: TaskContext) => string[]} expected the truth for this run
 * @param {RegExp} separator what splits the items
 * @returns {(reply: string, ctx: TaskContext) => Verdict} checker taking the agent's final reply
 */
export function exactSet(expected, separator) {
  return (reply, ctx) => {
    const parsed = extractAnswer(reply);
    if (!parsed.ok) return { pass: false, reason: parsed.reason };
    const wanted = expected(ctx);
    const got = parsed.value.split(separator).map(normalise).filter(Boolean);
    const repeated = got.filter((item, i) => got.indexOf(item) !== i);
    const missing = wanted.filter((item) => !got.includes(item));
    const extra = [...new Set(got)].filter((item) => !wanted.includes(item));
    if (missing.length === 0 && extra.length === 0 && repeated.length === 0) return { pass: true, reason: 'matches the truth' };
    return { pass: false, reason: `missing [${missing.join(', ')}], extra [${extra.join(', ')}], repeated [${repeated.join(', ')}]` };
  };
}

const ANSWER_RULE = 'End your reply with a last line `ANSWER: ';
const BUTTON_LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

/**
 * The URL of a fixture page for this run: the nonce makes every value differ per run, and the
 * value server address lets the page fetch its value when the interaction happens.
 * @param {TaskContext} ctx run context
 * @param {string} page page name, such as `eval-signin`
 * @returns {string} URL
 */
export function pageUrl(ctx, page) {
  return `${ctx.fixtures}${page}?n=${ctx.nonce}&api=${encodeURIComponent(ctx.valueApi)}`;
}

/**
 * Why each task cannot be answered from page source or a plain fetch alone: the value that is
 * the answer is requested from the value server by the interaction (click, sign-in, load), is
 * different in every run, and is not in the HTML; `page-never-loads` has no page at all.
 * @type {Task[]}
 */
export const TASKS = [
  {
    id: 'popup-token',
    scenario: 'S01',
    title: 'Sign-in popup posts a token back',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-signin')} and sign in. The sign-in window posts a token back to the page. ${ANSWER_RULE}<token>\` with the token the page shows.`,
    check: exactValue((ctx) => [`tk-${ctx.value('popup-token')}`]),
  },
  {
    id: 'cancel-confirm',
    scenario: 'S05',
    title: 'Cancel a confirmation dialog',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-confirm')} and click "Remove order", but cancel the confirmation question it asks (do not confirm it). ${ANSWER_RULE}<status>\` with the status line the page shows afterwards, word for word.`,
    check: exactValue((ctx) => [`Order A-${ctx.value('cancel-confirm')} kept`]),
  },
  {
    id: 'breaking-buttons',
    scenario: 'S12',
    title: 'Which buttons break something',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-buttons')} and click each button. ${ANSWER_RULE}<labels>\` listing, comma-separated, the labels of the buttons whose click caused an uncaught error (a warning is not an error).`,
    check: exactSet((ctx) => BUTTON_LABELS.filter((_, i) => ctx.value('breaking-buttons')[i] === '1'), /,/),
  },
  {
    id: 'shadow-login',
    scenario: 'S04',
    title: 'Log in through a shadow-DOM form',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-shadow-login')} and log in as ada@example.com with the passphrase hunter22. ${ANSWER_RULE}<reference>\` with the reference number the page shows after signing in (like R-12345).`,
    check: exactValue((ctx) => [`R-${ctx.value('shadow-login')}`]),
  },
  {
    id: 'failed-request-page-two',
    scenario: 'S11',
    title: 'Failed request on the second page',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-net-a')}, follow its "Next page" link, and find the data (fetch) request that failed on the second page; ignore the favicon. ${ANSWER_RULE}<path>\` with that request's URL path (starting with /).`,
    check: exactValue((ctx) => [`/eval-net-b-${ctx.value('failed-request-page-two')}.json`]),
  },
  {
    id: 'download-name',
    scenario: 'S10',
    title: 'Name of a downloaded file',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-download')} and download the report with the page's button. ${ANSWER_RULE}<file name>\` with the name of the file that was saved (the name only, no directory).`,
    check: exactValue((ctx) => [`q3-report-${ctx.value('download-name')}.csv`]),
  },
  {
    id: 'console-error-code',
    scenario: 'S03',
    title: 'Error code among console noise',
    prompt: (ctx) => `Load ${pageUrl(ctx, 'eval-console')} and look at what the page logs to the browser console. ${ANSWER_RULE}<code>\` with the code in the error message (not the warning).`,
    check: exactValue((ctx) => [`E-${ctx.value('console-error-code')}`]),
  },
  {
    id: 'utility-classes',
    scenario: 'S14',
    title: 'Every CSS class of a link',
    prompt: (ctx) => `Open ${pageUrl(ctx, 'eval-classes')} and find the link that leads to account registration. ${ANSWER_RULE}<classes>\` with every CSS class on that link element, exactly as the page has them, separated by spaces.`,
    check: exactSet(
      (ctx) => ['px-4', 'py-2', 'rounded-lg', 'bg-blue-600', 'text-white', 'font-semibold', 'hover:bg-blue-700', 'focus:ring-2', `id-${ctx.value('utility-classes')}`],
      /[\s,]+/
    ),
  },
  {
    id: 'page-never-loads',
    scenario: 'S17',
    title: 'A page that does not load',
    prompt: ({ refusedUrl }) => `Open ${refusedUrl} and tell me what the page shows. ${ANSWER_RULE}<result>\` with Chrome's error code if the page did not load (like net::ERR_SOMETHING), or the page's heading if it did.`,
    check: exactValue(() => ['net::ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_REFUSED']),
  },
];

/**
 * The tasks a `--tasks` selection names.
 * @param {string | undefined} selection comma-separated task ids, or `all`/undefined for every task
 * @returns {Task[]} the selected tasks, in table order
 */
export function selectTasks(selection) {
  if (selection === undefined || selection === 'all') return TASKS;
  const wanted = selection.split(',').map((id) => id.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !TASKS.some((task) => task.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown task "${unknown[0]}". Tasks: ${TASKS.map((task) => task.id).join(', ')}`);
  }
  return TASKS.filter((task) => wanted.includes(task.id));
}

/**
 * Wrap a task's goal in the framing every run gets.
 * @param {Task} task the task
 * @param {TaskContext} ctx fixture URLs and the run's nonce
 * @returns {string} the prompt for `claude -p`
 */
export function buildPrompt(task, ctx) {
  return [
    'A command-line tool named `bdg` is installed. It controls a headless Chrome browser so you can load pages, interact with them and read what they log and request. Learn how to use it from `bdg --help`. Use bdg for the task; do not look for other tools or files on this machine.',
    '',
    `Task: ${task.prompt(ctx)}`,
  ].join('\n');
}
