/**
 * Smoke tests for `bdg dom audit a11y` (#455) against a real Chrome and the
 * `/a11y-audit-bad` and `/a11y-audit-good` fixture pages.
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

/** The a11y section of `dom audit --json` */
interface A11yJson {
  data: {
    checks: string[];
    a11y: {
      rules: Array<{
        id: string;
        count: number;
        elements: Array<{ element: string; detail: string }>;
      }>;
    };
  };
}

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * The a11y rules of the audit, by id.
 *
 * @param args - Extra arguments after `dom audit`
 * @returns Rules by id
 */
async function rulesOf(
  args: string[]
): Promise<Map<string, A11yJson['data']['a11y']['rules'][number]>> {
  const json = JSON.parse(await bdg(['dom', 'audit', ...args, '--json'])) as A11yJson;
  return new Map(json.data.a11y.rules.map((rule) => [rule.id, rule]));
}

void describe('dom audit a11y', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}a11y-audit-bad`, '--port', String(port), '--headless']);
    await bdg(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('flags each failure of the bad page, shadow roots and iframes included', async () => {
    const rules = await rulesOf(['a11y']);
    assert.deepEqual(
      [...rules.keys()],
      ['img-alt', 'control-name', 'heading-order', 'landmarks', 'duplicate-id', 'aria-reference']
    );
    const names = (id: string): string[] => (rules.get(id)?.elements ?? []).map((e) => e.element);
    assert.equal(
      rules.get('img-alt')?.count,
      3,
      'the image, the svg role=img and the one in the iframe'
    );
    assert.ok(names('img-alt').includes('#svgimg'));
    assert.ok(names('img-alt').includes('#pic'));
    assert.equal(rules.get('control-name')?.count, 4, 'input, icon button, two in the shadow root');
    assert.ok(
      rules
        .get('control-name')
        ?.elements.some((e) => e.element === '<button>' && /no unique selector/.test(e.detail)),
      'an element no selector finds alone is not given as a selector'
    );
    assert.ok(names('control-name').includes('#plain'));
    assert.ok(names('control-name').includes('#icon'));
    assert.ok(names('control-name').includes('#shadowed'));
    assert.equal(rules.get('heading-order')?.count, 2, 'second h1 and the skip to h4');
    assert.ok(rules.get('landmarks')?.elements.some((e) => /main/.test(e.detail)));
    assert.equal(rules.get('duplicate-id')?.count, 3, 'all three elements sharing the id');
    assert.equal(rules.get('duplicate-id')?.elements.length, 3, 'count and list agree');
    assert.equal(rules.get('aria-reference')?.count, 1, 'aria-labelledby naming no element');
  });

  void it('runs alone and in the default run; the elements resolve for the next command', async () => {
    const all = JSON.parse(await bdg(['dom', 'audit', '--json'])) as A11yJson;
    assert.ok(all.data.checks.includes('a11y'));
    assert.equal(all.data.a11y.rules.length, 6);
    assert.deepEqual(
      (JSON.parse(await bdg(['dom', 'audit', 'a11y', '--json'])) as A11yJson).data.checks,
      ['a11y']
    );
    for (const element of ['#pic', '#plain', '#icon']) {
      assert.match(await bdg(['dom', 'a11y', 'describe', element]), /\w/);
      assert.match(await bdg(['dom', 'get', element]), /\w/);
    }
    const human = await bdg(['dom', 'audit', 'a11y']);
    assert.match(human, /^A11y: \d+ issues? /);
    assert.match(human, /img-alt/);
    assert.match(human, /bdg dom a11y describe /);
    assert.match(await bdg(['dom', 'audit', 'a11y', '--limit', '1']), /\(\+1 more; --limit/);
  });

  void it('reports zero for every rule on a page with only correct variants', async () => {
    await bdg(['page', 'navigate', `${fixture.url}a11y-audit-good`]);
    await bdg(['dom', 'wait', '--load']);
    const rules = await rulesOf(['a11y']);
    for (const [id, rule] of rules) {
      assert.equal(rule.count, 0, `${id}: ${JSON.stringify(rule.elements)}`);
    }
    const human = await bdg(['dom', 'audit', 'a11y']);
    assert.match(human, /^A11y: no issues/);
    assert.doesNotMatch(human, /hunter2/);
  });

  void it('names an open modal dialog and reports no false page structure', async () => {
    await bdg(['page', 'navigate', `${fixture.url}a11y-audit-modal`]);
    await bdg(['dom', 'wait', '--load']);
    const json = JSON.parse(await bdg(['dom', 'audit', 'a11y', '--json'])) as A11yJson & {
      data: { a11y: { modal?: { element: string } } };
    };
    assert.equal(json.data.a11y.modal?.element, '#consent');
    for (const rule of json.data.a11y.rules) assert.equal(rule.count, 0, rule.id);
    const human = await bdg(['dom', 'audit', 'a11y']);
    assert.match(human, /^⚠ #consent is a modal dialog: it hides the rest of the page/m);
    assert.ok(human.indexOf('modal dialog') < human.indexOf('A11y:'), 'the note comes first');
  });
});
