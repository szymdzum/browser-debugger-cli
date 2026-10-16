/**
 * Low-priority polish smoke test (#644, #646, #608, #567, #458).
 *
 * One session walks three pages: `/polish-net` (a multipart request whose
 * file part Chrome leaves out of the event says so in `details network`;
 * `peek` console lines name the URL of each 404; `Performance.getMetrics`
 * explains an empty list; a sorted `network list` notes earlier pages),
 * `/polish-forms` (`dom form` lists `type=image` buttons, takes a field's
 * label from its `labels` and a button's from `aria-labelledby`) and
 * `/components` (text filters read what a slot shows, not a `<script>`).
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
 * Run a bdg command with `--json` and return its envelope data.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The envelope's `data`
 */
async function bdgData<T>(args: string[]): Promise<T> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: T }).data;
}

/**
 * Wait until the page title is `done`.
 */
async function waitForDone(): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const title = await runCommand('dom', ['eval', 'document.title', '--json'], { timeout: 30000 });
    if (title.stdout.includes('"done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('page did not finish its requests');
}

/** What the tests read of `dom form --all --json` */
interface FormsJson {
  forms: Array<{
    fields: Array<{ name: string | null; label: string }>;
    buttons: Array<{ label: string; type: string; explicitSubmit: boolean }>;
  }>;
}

/**
 * The form holding a field with a name.
 *
 * @param data - Discovery data
 * @param fieldName - Field name
 * @returns The form
 */
function formWith(data: FormsJson, fieldName: string): FormsJson['forms'][number] {
  const form = data.forms.find((f) => f.fields.some((field) => field.name === fieldName));
  assert.ok(form, `no form with field ${fieldName}: ${JSON.stringify(data.forms)}`);
  return form;
}

void describe('Low-priority polish', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}polish-net`, '--port', String(port), '--headless']);
    await waitForDone();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('details network says a multipart body with a file part was not captured (#646)', async () => {
    const list = await bdgData<{ requests: Array<{ requestId: string; url: string }> }>([
      'network',
      'list',
      '--last',
      '0',
    ]);
    const id = list.requests.find((r) => r.url.endsWith('/polish-upload'))?.requestId ?? '';
    assert.ok(id, JSON.stringify(list.requests));
    assert.match(await bdg(['details', 'network', id]), /Request Body:\s+[━\s]*\(not captured: /);
    const data = await bdgData<{ item: { requestBody?: string; requestBodyNotCaptured?: string } }>(
      ['details', 'network', id]
    );
    assert.equal(data.item.requestBody, undefined);
    assert.match(data.item.requestBodyNotCaptured ?? '', /file|multipart/i);
  });

  void it('details network says a body over 1 MB was not captured (#646)', async () => {
    const list = await bdgData<{ requests: Array<{ requestId: string; url: string }> }>([
      'network',
      'list',
      '--last',
      '0',
    ]);
    const id = list.requests.find((r) => r.url.endsWith('/polish-big'))?.requestId ?? '';
    assert.ok(id, JSON.stringify(list.requests));
    assert.match(await bdg(['details', 'network', id]), /\(not captured: .*over 1 MB/);
  });

  void it('peek console lines name the URL of each 404 (#567)', async () => {
    const output = await bdg(['peek', '--console']);
    assert.match(output, /missing-page/);
    assert.match(output, /spa-missing/);
  });

  void it('an empty Performance.getMetrics says to enable the domain (#458)', async () => {
    const output = await bdg(['cdp', 'Performance.getMetrics']);
    assert.match(output, /bdg cdp Performance\.enable/);
    const json = await runCommand('cdp', ['Performance.getMetrics', '--json'], { timeout: 60000 });
    assert.match(json.stderr, /Performance\.enable/);
  });

  void it('the Runtime.evaluate pattern hint suggests bdg eval (#567)', async () => {
    const first = await bdg(['cdp', 'Runtime.evaluate', '--params', '{"expression":"1"}']);
    const second = await bdg(['cdp', 'Runtime.evaluate', '--params', '{"expression":"2"}']);
    const third = await bdg(['cdp', 'Runtime.evaluate', '--params', '{"expression":"3"}']);
    const output = `${first}${second}${third}`;
    assert.match(output, /bdg eval <javascript>/);
    assert.doesNotMatch(output, /bdg dom eval <javascript>/);
  });

  void it('dom form lists image buttons, labels by labels and buttons by aria-labelledby (#644)', async () => {
    await bdg(['page', 'navigate', `${fixture.url}polish-forms`]);
    const data = await bdgData<FormsJson>(['dom', 'form', '--all']);
    const pictured = formWith(data, 'term');
    assert.deepEqual(
      pictured.buttons.map((b) => [b.label, b.type]),
      [['Search now', 'submit']]
    );
    const dupes = formWith(data, 'first');
    const [first, second] = dupes.fields;
    assert.match(first?.label ?? '', /Name/);
    assert.equal(second?.label, 'Phone');
    assert.deepEqual(
      formWith(data, 'q').buttons.map((b) => b.label),
      ['Hover me']
    );
  });

  void it('a sorted network list notes requests of earlier pages (#567)', async () => {
    const output = await bdg(['network', 'list', '--sort', 'size']);
    assert.match(output, /from earlier pages included \(--page current\)/);
    const data = await bdgData<{ earlierPagesIncluded?: number }>([
      'network',
      'list',
      '--sort',
      'size',
    ]);
    assert.ok((data.earlierPagesIncluded ?? 0) > 0);
  });

  void it('text filters read what a slot shows and skip scripts (#608)', async () => {
    await bdg(['page', 'navigate', `${fixture.url}components`]);
    await bdg(['dom', 'query', 'slot:text-is("Shown Title")']);
    await bdg(['dom', 'query', 'slot:text-is("Hidden TitleShown Title")'], 83);
    await bdg(['dom', 'query', 'slot:has-text("Hidden Title")'], 83);
    await bdg(['dom', 'query', 'script:has-text("Fallback")'], 83);
    await bdg(['dom', 'query', 'style:has-text("display")'], 83);
  });

  void it('peek masks a token in a console stack frame URL, as the session records it (#800)', async () => {
    await bdg(['page', 'navigate', `${fixture.url}polish-token-stack`]);
    await waitForDone();
    const human = await bdg(['peek', '--console']);
    assert.doesNotMatch(human, /tok-S800/);
    for (const flags of [[], ['--include-sensitive']]) {
      const json = await bdg(['peek', '--console', '--json', ...flags]);
      assert.doesNotMatch(json, /tok-S800/, `peek --json ${flags.join(' ')}`);
      assert.match(json, /app\.js\?token=••••/);
    }
  });
});
});
