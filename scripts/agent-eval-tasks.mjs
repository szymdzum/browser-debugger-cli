/**
 * Tasks and checkers of the agent eval harness (`scripts/agent-eval.mjs`, #888).
 *
 * One table row per task: the scenario it comes from (`.claude/skills/ship/scenarios.md`),
 * the prompt the agent gets (a goal, never a bdg command or feature name) and a deterministic
 * checker. The truth lives in the checkers, never in a prompt. The agent ends with a last line
 * `ANSWER: <value>`; a checker compares that value with the truth exactly and case-sensitively
 * (after trimming and a trailing period), so a hedged answer ("A or B") or a right value with a
 * wrong extra or repeated item fails. Most truths are a per-run value that the fixture page
 * generates (`crypto.getRandomValues`) inside the handler of the interaction, shows, and reports to
 * the harness's log server; the checker compares the answer with what the page logged in that run,
 * and a run with nothing logged fails ("interaction never happened"). The page source and every
 * GET hold no value. The pages are `src/__testutils__/fixturePages/agentEvalFixtures.ts`.
 */

/** @typedef {{pass: boolean, reason: string}} Verdict */
/** @typedef {{fixtures: string, refusedUrl: string, logApi: string, nonce: string, logged: (key: string) => string[]}} TaskContext */
/** @typedef {{id: string, scenario: string, title: string, prompt: (ctx: TaskContext) => string, check: (reply: string, ctx: TaskContext) => Verdict}} Task */

const ANSWER_LINE = /^ANSWER:[ \t]*(.*)$/;

/**
 * Trim a line and the markdown emphasis or code ticks a model puts around an answer
 * (`**ANSWER: x**`, `ANSWER: \`x\``).
 * @param {string} text a line or a value
 * @returns {string} the text without surrounding spaces, asterisks and backticks
 */
function stripEmphasis(text) {
  return text.replace(/^[\s*`]+|[\s*`]+$/g, '');
}

/**
 * The agent's final answer: the value on the last non-empty line, which must be `ANSWER: <value>`.
 * @param {string} text the agent's final reply
 * @returns {{ok: true, value: string} | {ok: false, reason: string}} the value or why there is none
 */
export function extractAnswer(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map(stripEmphasis)
    .filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) return { ok: false, reason: 'empty reply' };
  const match = ANSWER_LINE.exec(last);
  if (!match) return { ok: false, reason: 'the last line is not "ANSWER: <value>"' };
  const value = stripEmphasis(match[1]);
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
 * @param {(ctx: TaskContext) => string[] | string} accepted accepted spellings of the truth for this run, or the reason it cannot be checked (a failure)
 * @returns {(reply: string, ctx: TaskContext) => Verdict} checker taking the agent's final reply
 */
export function exactValue(accepted) {
  return (reply, ctx) => {
    const parsed = extractAnswer(reply);
    if (!parsed.ok) return { pass: false, reason: parsed.reason };
    const wanted = accepted(ctx);
    if (typeof wanted === 'string') return { pass: false, reason: wanted };
    return wanted.includes(normalise(parsed.value))
      ? { pass: true, reason: 'matches the truth' }
      : { pass: false, reason: `answered "${parsed.value}", expected "${wanted[0]}"` };
  };
}

/**
 * Checker for an answer that is a set of items separated by commas or spaces; order is free,
 * items are compared exactly, and a missing, extra or repeated item fails.
 * @param {(ctx: TaskContext) => string[] | string[][] | string} expected the truth for this run (several arrays: any one matches), or the reason it cannot be checked (a failure)
 * @param {RegExp} separator what splits the items
 * @returns {(reply: string, ctx: TaskContext) => Verdict} checker taking the agent's final reply
 */
export function exactSet(expected, separator) {
  return (reply, ctx) => {
    const parsed = extractAnswer(reply);
    if (!parsed.ok) return { pass: false, reason: parsed.reason };
    const truth = expected(ctx);
    if (typeof truth === 'string') return { pass: false, reason: truth };
    const alternatives = Array.isArray(truth[0]) ? truth : [truth];
    const got = parsed.value.split(separator).map(normalise).filter(Boolean);
    const repeated = got.filter((item, i) => got.indexOf(item) !== i);
    const verdicts = alternatives.map((wanted) => {
      const missing = wanted.filter((item) => !got.includes(item));
      const extra = [...new Set(got)].filter((item) => !wanted.includes(item));
      return { missing, extra };
    });
    if (
      repeated.length === 0 &&
      verdicts.some((v) => v.missing.length === 0 && v.extra.length === 0)
    ) {
      return { pass: true, reason: 'matches the truth' };
    }
    const { missing, extra } = verdicts[verdicts.length - 1];
    return {
      pass: false,
      reason: `missing [${missing.join(', ')}], extra [${extra.join(', ')}], repeated [${repeated.join(', ')}]`,
    };
  };
}

const ANSWER_RULE = 'End your reply with a last line `ANSWER: ';
const BUTTON_LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const NEVER_HAPPENED = 'interaction never happened (the page logged no value in this run)';

/**
 * Truth for a task whose answer is a value the page made in this run. A page that makes its value
 * at load logs a new one on every reload, and a repeated click makes another, so any value logged
 * in the run is accepted: an honest reload must not fail the run.
 * @param {string} key task key
 * @param {(logged: string[]) => string[] | string[][] | string} [derive] truth from the logged texts (default: each text is accepted)
 * @returns {(ctx: TaskContext) => string[] | string[][] | string} truth function
 */
function loggedTruth(key, derive = (logged) => logged) {
  return (ctx) => {
    const logged = ctx.logged(key);
    return logged.length === 0 ? NEVER_HAPPENED : derive(logged);
  };
}

/**
 * Truth for cancel-confirm: any `kept` status the page logged, unless the last one logged says the
 * order was removed (the confirmation ended up accepted), which fails whatever the answer is.
 * @param {string[]} logged statuses the page logged
 * @returns {string[] | string} accepted answers, or why the run fails
 */
function keptStatuses(logged) {
  if (!logged.at(-1).endsWith(' kept')) return 'the confirmation was accepted, not cancelled';
  return logged.filter((status) => status.endsWith(' kept'));
}

/**
 * Labels of the buttons that broke in this run: the page logs `Label=1` when a button's first
 * click threw and `Label=0` when it only warned. All five buttons must have been clicked, and the
 * last outcome per button counts.
 * @param {TaskContext} ctx run context
 * @returns {string[] | string} the labels, or why they are unknown
 */
function brokenButtons(ctx) {
  const outcomes = new Map();
  for (const entry of ctx.logged('breaking-buttons')) {
    const [label, broke] = entry.split('=');
    outcomes.set(label, broke === '1');
  }
  if (outcomes.size === 0) return NEVER_HAPPENED;
  if (BUTTON_LABELS.some((label) => !outcomes.has(label))) return 'not all buttons clicked';
  return BUTTON_LABELS.filter((label) => outcomes.get(label));
}

/**
 * The URL of a fixture page for this run: the nonce names the run in the log and the log server
 * address is where the page reports what it showed.
 * @param {TaskContext} ctx run context
 * @param {string} page page name, such as `eval-slot`
 * @returns {string} URL
 */
export function pageUrl(ctx, page) {
  return `${ctx.fixtures}${page}?n=${ctx.nonce}&api=${encodeURIComponent(ctx.logApi)}`;
}

/**
 * Why each task cannot be answered without the interaction: the value (or, for the buttons and
 * the failed request, the outcome) is generated in the page by the handler of the interaction or
 * at load, shown there and logged; it is in no page source and no GET returns it. See the
 * fixture module for what each page generates. `page-never-loads` has no page: the truth is
 * Chrome's error for a port the harness found closed.
 * @type {Task[]}
 */
export const TASKS = [
  {
    id: 'popup-code',
    scenario: 'S01',
    title: 'Slot popup posts a confirmation code back',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-slot')} and choose a delivery slot: the button opens a small window where you confirm the slot, and that window sends a confirmation code back to the page. ${ANSWER_RULE}<code>\` with the confirmation code the page shows.`,
    check: exactValue(loggedTruth('popup-code')),
  },
  {
    id: 'cancel-confirm',
    scenario: 'S05',
    title: 'Cancel a confirmation dialog',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-confirm')} and click "Remove order", but cancel the confirmation question it asks (do not confirm it). ${ANSWER_RULE}<status>\` with the status line the page shows afterwards, word for word.`,
    check: exactValue(loggedTruth('cancel-confirm', keptStatuses)),
  },
  {
    id: 'breaking-buttons',
    scenario: 'S12',
    title: 'Which buttons break something',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-buttons')} and click each button. ${ANSWER_RULE}<labels>\` listing, comma-separated, the labels of the buttons whose click caused an uncaught error (a warning is not an error).`,
    check: exactSet(brokenButtons, /,/),
  },
  {
    id: 'shadow-login',
    scenario: 'S04',
    title: 'Log in through a shadow-DOM form',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-shadow-login')} and log in as ada@example.com with the passphrase hunter22. ${ANSWER_RULE}<reference>\` with the reference number the page shows after signing in (like R-12345).`,
    check: exactValue(loggedTruth('shadow-login')),
  },
  {
    id: 'failed-request-page-two',
    scenario: 'S11',
    title: 'Failed request on the second page',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-net-a')}, follow its "Next page" link, and find the data (fetch) request that failed on the second page; ignore the favicon. ${ANSWER_RULE}<path>\` with that request's URL path (starting with /).`,
    check: exactValue(loggedTruth('failed-request-page-two')),
  },
  {
    id: 'download-name',
    scenario: 'S10',
    title: 'Name of a downloaded file',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-download')} and download the report with the page's button. ${ANSWER_RULE}<file name>\` with the name of the file that was saved (the name only, no directory).`,
    check: exactValue(loggedTruth('download-name')),
  },
  {
    id: 'console-error-code',
    scenario: 'S03',
    title: 'Error code among console noise',
    prompt: (ctx) =>
      `Load ${pageUrl(ctx, 'eval-console')} and look at what the page logs to the browser console. ${ANSWER_RULE}<code>\` with the code in the error message (not the warning).`,
    check: exactValue(loggedTruth('console-error-code')),
  },
  {
    id: 'utility-classes',
    scenario: 'S14',
    title: 'Every CSS class of a link',
    prompt: (ctx) =>
      `Open ${pageUrl(ctx, 'eval-classes')} and find the link that leads to account registration. ${ANSWER_RULE}<classes>\` with every CSS class on that link element, exactly as the page has them, separated by spaces.`,
    check: exactSet(
      loggedTruth('utility-classes', (logged) =>
        logged.map((extra) => [
          'px-4',
          'py-2',
          'rounded-lg',
          'bg-blue-600',
          'text-white',
          'font-semibold',
          'hover:bg-blue-700',
          'focus:ring-2',
          extra,
        ])
      ),
      /[\s,]+/
    ),
  },
  {
    id: 'page-never-loads',
    scenario: 'S17',
    title: 'A page that does not load',
    prompt: ({ refusedUrl }) =>
      `Open ${refusedUrl} and tell me what the page shows. ${ANSWER_RULE}<result>\` with Chrome's error code if the page did not load (like net::ERR_SOMETHING), or the page's heading if it did.`,
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
  const wanted = selection
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const unknown = wanted.filter((id) => !TASKS.some((task) => task.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown task "${unknown[0]}". Tasks: ${TASKS.map((task) => task.id).join(', ')}`
    );
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
