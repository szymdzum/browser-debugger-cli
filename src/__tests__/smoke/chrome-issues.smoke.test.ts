/**
 * Chrome Issues smoke test.
 *
 * Each fixture page (no doctype, a label whose `for` matches no id, two
 * fields with the same id, a failing `@import`, `eval` under a CSP) makes
 * Chrome report one issue bdg keeps: `bdg console` lists exactly that one,
 * in human and JSON output. Issues of a page are gone after a navigation.
 * `dom form` shows form errors next to the field, `peek` counts the issues.
 *
 * Chrome reports issues while the page loads, a little after `page navigate`
 * may return, so each check waits until the issue is there (and its elements
 * are described), not for a fixed time.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import type { PageIssue } from '@/types.js';

/** How long Chrome may take to report a page's issues */
const ISSUE_DEADLINE_MS = 10000;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Its stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * The page's issues from `console --json`.
 *
 * @returns Issues
 */
async function issues(): Promise<PageIssue[]> {
  const output = await bdg(['console', '--json']);
  return (JSON.parse(output) as { data: { issues?: PageIssue[] } }).data.issues ?? [];
}

/**
 * Whether Chrome has reported an issue on every element expected, and bdg
 * described them.
 *
 * @param found - Issues so far
 * @param elements - Elements expected on the first issue
 * @returns True when complete
 */
function complete(found: PageIssue[], elements: number): boolean {
  const nodes = found[0]?.nodes ?? [];
  return (
    found.length > 0 &&
    nodes.length >= elements &&
    nodes.every((node) => node.description !== undefined)
  );
}

/**
 * Wait until the page's issue has arrived (with its elements described).
 *
 * @param elements - Elements expected on it
 * @returns The page's issues then
 */
async function waitForIssue(elements = 0): Promise<PageIssue[]> {
  const deadline = Date.now() + ISSUE_DEADLINE_MS;
  for (;;) {
    const found = await issues();
    if (complete(found, elements) || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * The issue lines of the `bdg console` Issues block.
 *
 * @returns Lines starting with `• ` after the `Issues (n)` heading
 */
async function issueLines(): Promise<string[]> {
  const lines = (await bdg(['console'])).split('\n');
  const start = lines.findIndex((line) => line.startsWith('Issues ('));
  if (start === -1) return [];
  return lines.slice(start + 2).filter((line) => line.startsWith('• '));
}

interface IssueCase {
  path: string;
  code: string;
  type?: string;
  /** Elements Chrome names */
  elements?: number;
  /** The Issues block line */
  line: RegExp;
}

const CASES: IssueCase[] = [
  {
    path: 'issues/quirks',
    code: 'QuirksModeIssue',
    line: /^• Page is in quirks mode .* → http:\/\/127\.0\.0\.1:\d+\/issues\/quirks$/,
  },
  {
    path: 'issues/label-for',
    code: 'GenericIssue',
    type: 'FormLabelForMatchesNonExistingIdError',
    elements: 1,
    line: /^• Label's for attribute matches no element id.* → label\[for="missing"\]$/,
  },
  {
    path: 'issues/duplicate-ids',
    code: 'GenericIssue',
    type: 'FormDuplicateIdForInputError',
    elements: 2,
    line: /^• Duplicate id on form fields.* → input#pet, input#pet$/,
  },
  {
    path: 'issues/import',
    code: 'StylesheetLoadingIssue',
    type: 'RequestFailed',
    line: /^• Stylesheet failed to load: http:\/\/127\.0\.0\.1:\d+\/issues\/missing\.css .* → import:\d+:\d+$/,
  },
  {
    path: 'issues/csp-eval',
    code: 'ContentSecurityPolicyIssue',
    type: 'kEvalViolation',
    line: /^• CSP blocked eval\(\) or new Function\(\): script-src → csp-eval:3:\d+$/,
  },
];

void describe('Chrome Issues', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}issues/clean`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const issueCase of CASES) {
    void it(`lists the one issue of ${issueCase.path}, in JSON and text`, async () => {
      await bdg(['page', 'navigate', `${fixture.url}${issueCase.path}`]);

      const found = await waitForIssue(issueCase.elements);
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.equal(found[0]?.code, issueCase.code);
      assert.equal(found[0]?.type, issueCase.type);
      if (issueCase.elements) assert.equal(found[0]?.count, issueCase.elements);

      const lines = await issueLines();
      assert.equal(lines.length, 1, lines.join('\n'));
      assert.match(lines[0] ?? '', issueCase.line);
    });
  }

  void it("drops the previous page's issues after a navigation", async () => {
    await bdg(['page', 'navigate', `${fixture.url}issues/quirks`]);
    assert.equal((await waitForIssue()).length, 1);

    await bdg(['page', 'navigate', `${fixture.url}issues/clean`]);

    assert.deepEqual(await issues(), []);
    assert.deepEqual(await issueLines(), []);
  });

  void it('counts the issues in peek', async () => {
    await bdg(['page', 'navigate', `${fixture.url}issues/quirks`]);
    assert.equal((await waitForIssue()).length, 1);

    assert.match(await bdg(['peek']), /^ISSUES: 1 \(bdg console lists them\)$/m);
    const peek = JSON.parse(await bdg(['peek', '--json'])) as {
      data: { totals: { issues?: number } };
    };
    assert.equal(peek.data.totals.issues, 1);
  });

  void it('shows form errors next to the field in dom form, and the others below', async () => {
    await bdg(['page', 'navigate', `${fixture.url}issues/duplicate-ids`]);
    await waitForIssue(2);
    const duplicates = JSON.parse(await bdg(['dom', 'form', '--json'])) as {
      data: { forms: Array<{ fields: Array<{ name: string; issues?: string[] }> }> };
    };
    assert.deepEqual(
      duplicates.data.forms[0]?.fields.map((field) => [field.name, field.issues?.length]),
      [
        ['first-pet', 1],
        ['second-pet', 1],
      ]
    );
    assert.match(await bdg(['dom', 'form']), /First pet .*\n {6}⚠ Duplicate id on form fields/);

    await bdg(['page', 'navigate', `${fixture.url}issues/label-for`]);
    await waitForIssue(1);
    const labels = JSON.parse(await bdg(['dom', 'form', '--json'])) as {
      data: { formIssues?: Array<{ elements?: string[] }> };
    };
    assert.deepEqual(labels.data.formIssues?.[0]?.elements, ['label[for="missing"]']);
  });
});
