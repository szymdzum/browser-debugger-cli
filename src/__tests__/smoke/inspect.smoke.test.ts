/**
 * Smoke tests for `bdg dom inspect`: what one element looks like, against a
 * real Chrome and the `/inspect` fixture page.
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

/** Most tokens (bytes/4) the default output of a styled button may take */
const BUTTON_TOKEN_BUDGET = 120;

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
 * Inspect an element and return the JSON data.
 *
 * @param args - Selector and options
 * @returns `data` of the envelope
 */
async function inspectJson(...args: string[]): Promise<Record<string, unknown>> {
  const output = await bdg(['dom', 'inspect', ...args, '--json']);
  return (JSON.parse(output) as { data: Record<string, unknown> }).data;
}

void describe('dom inspect', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}inspect`, '--port', String(port), '--headless']);
    await bdg(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('describes a styled button in Figma-like groups, within the token budget', async () => {
    const output = await bdg(['dom', 'inspect', '#buy']);
    assert.match(output, /^button#buy "Buy now" [\d.]+x50 @16,16/);
    assert.match(output, /\nbox +m 0 0 16 · p 12 24 · b 1\n/);
    assert.match(
      output,
      /\ntext +Arial( \(rendered "[^"]+"\))? 600 16\/24 · color #fff · contrast [\d.]+ fail · align center/
    );
    assert.match(output, /\nfill +bg #0a7cff\n/);
    assert.match(output, /\nborder +1 solid #0a7cff · radius 8\n/);
    assert.match(output, /\nfx +shadow #00000033 0 1 2 0\n/);
    assert.match(output, /\nstate +cursor pointer/);
    assert.ok(
      Buffer.byteLength(output) / 4 <= BUTTON_TOKEN_BUDGET,
      `about ${Math.round(Buffer.byteLength(output) / 4)} tokens:\n${output}`
    );
  });

  void it('shows a flex container with its child tree, and groups identical grid items', async () => {
    const card = await bdg(['dom', 'inspect', '.card']);
    assert.match(card, /\[flex\]/);
    assert.match(card, /\nlayout +flex column · gap 16\n/);
    assert.match(
      card,
      /\ntree\n {2}h3 280x\d+ "Card title"\n {2}p 280x\d+ "Some text"\n {2}a 280x\d+ "Go"/
    );

    const grid = await bdg(['dom', 'inspect', '#grid']);
    assert.match(grid, /\nlayout +grid · cols repeat\(3,100\) · rows repeat\(2,40\) · gap 8\n/);
    assert.match(grid, /\n {2}li\.tile ×6 100x40/);

    assert.doesNotMatch(await bdg(['dom', 'inspect', '.card', '--tree', '0']), /\ntree\n/);

    const children = (await inspectJson('.card'))['children'] as Array<{
      x: number;
      y: number;
      h: number;
    }>;
    const [title, text] = children;
    assert.deepEqual([title?.x, title?.y], [17, 17], 'inside the 1px border and 16px padding');
    assert.ok(
      Math.abs((text?.y ?? 0) - (17 + (title?.h ?? 0) + 16)) <= 1,
      'the next child sits one gap lower'
    );
  });

  void it('shows a placeholder, a ::before and a fallback font', async () => {
    const field = await bdg(['dom', 'inspect', '#email']);
    assert.match(field, /placeholder "E-mail"/);
    assert.match(field, /\nborder +bottom 1 solid #ededed\n/);
    assert.match(
      field,
      /\npseudo +::placeholder color #6d7584 · contrast [\d.]+ (fail|AA|AAA|AA large)/
    );

    assert.match(
      await bdg(['dom', 'inspect', '#badge']),
      /\npseudo +::before content "★" block absolute [\d.]+x[\d.]+ color #f5a623/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#webfont']),
      /\ntext +Fixture Sans \(rendered "(?!Fixture Sans")[^"]+"\) /
    );
  });

  void it('says why an element cannot be seen', async () => {
    assert.match(await bdg(['dom', 'inspect', '#ghost']), /\[not rendered: display: none\]/);
    assert.match(await bdg(['dom', 'inspect', '#behind']), /\[covered by div#cover\]/);
  });

  void it('reaches elements in open shadow roots and same-origin iframes', async () => {
    assert.match(
      await bdg(['dom', 'inspect', '#shadowed']),
      /^span#shadowed "In shadow" .* in shadow root of <div#host>.*\ntext +Arial( \(rendered "[^"]+"\))? 700 16\/normal · color #c00/s
    );
    assert.match(await bdg(['dom', 'inspect', '#in-frame']), /in iframe#frame.*\nfill +bg #222\n/s);
  });

  void it('returns Figma-aligned JSON', async () => {
    const data = await inspectJson('#buy');
    assert.equal(data['element'], 'button#buy');
    assert.deepEqual((data['box'] as { padding: unknown }).padding, [12, 24, 12, 24]);
    assert.deepEqual(data['fills'], [{ type: 'solid', color: '#0a7cff' }]);
    assert.deepEqual(data['strokes'], [
      { side: 'all', width: 1, style: 'solid', color: '#0a7cff' },
    ]);
    assert.deepEqual(data['radius'], [8, 8, 8, 8]);
    const layout = data['layout'] as { sizing: { w: string; h: string } };
    assert.deepEqual(layout.sizing, { w: 'hug', h: 'hug' });
    const text = data['text'] as { size: number; weight: number; color: string };
    assert.deepEqual([text.size, text.weight, text.color], [16, 600, '#fff']);
  });

  void it('lists chosen properties, or every non-default one', async () => {
    const props = await bdg(['dom', 'inspect', '#buy', '--props', 'padding-top,color']);
    assert.match(props, /\npadding-top: 12px = 12\n/);
    assert.match(props, /\ncolor: rgb\(255, 255, 255\) = #fff/);
    const unknown = await bdg(['dom', 'inspect', '#buy', '--props', 'colr'], 81);
    assert.match(unknown, /Unknown CSS property: colr/);

    const all = await bdg(['dom', 'inspect', '#buy', '--all', '--tree', '0']);
    assert.match(all, /background-color #0a7cff/);
    assert.match(all, /padding 12 24/);
    assert.doesNotMatch(all, /block-size|inline-size|timeline-trigger| · {2}/);
  });

  void it('never shows secret values, in text, the tree or JSON', async () => {
    const outputs = [
      await bdg(['dom', 'inspect', '#pw']),
      await bdg(['dom', 'inspect', '#exp']),
      await bdg(['dom', 'inspect', '#secrets']),
      await bdg(['dom', 'inspect', '#pw', '--json']),
      await bdg(['dom', 'inspect', '#exp', '--json']),
    ].join('\n');
    assert.doesNotMatch(outputs, /hunter2/);
    assert.doesNotMatch(outputs, /"11"|\b11\b(?!\.)/);
    assert.match(outputs, /••••/);
  });

  void it('fades contrast by ancestor opacity and lets a block image hug its size', async () => {
    assert.match(
      await bdg(['dom', 'inspect', '#faded-text']),
      /contrast [\d.]+ (fail|AA large) .*\(faded: opacity 0\.4\)/
    );
    const pic = await inspectJson('#pic');
    assert.deepEqual((pic['layout'] as { sizing: unknown }).sizing, { w: 'hug', h: 'hug' });
  });

  void it('reads a shorthand whose sides differ, skips contrast no one sees, and badges only dark pages', async () => {
    const border = await bdg(['dom', 'inspect', '#email', '--props', 'border']);
    assert.match(border, /\nborder: top .* \/ bottom 1px solid/);
    await bdg([
      'dom',
      'eval',
      'document.body.insertAdjacentHTML(\'beforeend\', \'<label id="invisible" style="opacity:0">Hidden label</label>\'); 1',
    ]);
    assert.doesNotMatch(await bdg(['dom', 'inspect', '#invisible']), /contrast/);
    assert.doesNotMatch(await bdg(['dom', 'inspect', '#buy']), /\[dark theme|\[prefers/);
  });

  void it('describes the text a user sees: the drawing descendant, slotted text, none for icons', async () => {
    assert.match(
      await bdg(['dom', 'inspect', '#via-child']),
      /\ntext\s+in b · .*color #eaecf0 · contrast [\d.]+ fail on #ddd/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#own-svg']),
      /\ntext\s+Georgia .*color #fff · contrast/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#slotted']),
      /\ntext\s+in slot\.label · Arial( \(rendered "[^"]+"\))? 500 14.*color #fff · contrast [\d.]+ fail on #0284c7/
    );
    assert.doesNotMatch(await bdg(['dom', 'inspect', '#icon-only']), /\ntext |font-family/);
  });

  void it('answers --why for shorthands Chrome expands, and rejects a misspelled property', async () => {
    assert.match(
      await bdg(['dom', 'inspect', '#moving', '--why', 'transition']),
      /why\s+transition = color 1s ease-in\n\s+✓ transition: color 1s ease-in/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#moving', '--why', 'outline']),
      /✓ outline: 2px solid/
    );
    assert.match(
      await bdg(['dom', 'inspect', '#moving', '--why', 'colour'], 81),
      /Unknown CSS property: colour[\s\S]*Did you mean: color\?/
    );
  });

  void it('hints at declarations that have no effect, by default', async () => {
    const hero = await bdg(['dom', 'inspect', '#hero']);
    assert.match(
      hero,
      /\nhints +justify-content: center has no effect: display is block → use display: flex or grid on this element · in #hero \(<style> in inspect:\d+\)/
    );
    assert.match(hero, /gap: 12px has no effect/);
    assert.match(
      await bdg(['dom', 'inspect', '#themed']),
      /color: var\(--brand-color\) has no effect: --brand-color is not set/
    );
    assert.doesNotMatch(await bdg(['dom', 'inspect', '#hero', '--no-hints']), /\nhints/);
  });

  void it('names the rule that sets each property, and why a value wins', async () => {
    const rules = await bdg(['dom', 'inspect', '#tag', '--rules', '--tree', '0']);
    assert.match(
      rules,
      /\nrules +.*color #06c ← \.tag\.primary \(<style> in inspect:\d+\) over \.tag/s
    );
    assert.match(rules, /padding 4px 8px ← \.tag \(<style> in inspect:\d+\)/);

    const why = await bdg(['dom', 'inspect', '#tag', '--why', 'color', '--tree', '0']);
    assert.match(why, /\nwhy +color = #06c\n +✓ #06c +\.tag\.primary/);
    assert.match(why, /\n +✗ #c00 +\.tag \(<style> in inspect:\d+\)/);
    assert.match(why, /\n +in \.tag\.primary \{ color: #06c; \}\n/, 'the winning rule as written');

    const json = await inspectJson('#tag', '--rules');
    const colorRule = (json['rules'] as Array<{ property: string; overrides?: string[] }>).find(
      (rule) => rule.property === 'color'
    );
    assert.deepEqual(colorRule?.overrides, ['.tag']);

    const attribute = await bdg(['dom', 'inspect', '#sized', '--why', 'width', '--tree', '0']);
    assert.match(attribute, /\n +✓ 120px +HTML attribute/);
    const variables = await bdg(['dom', 'inspect', '#tag', '--props', '--accent*']);
    assert.match(variables, /\n--accent: #06c\n--accent-dark: #036/);
    const shorthand = await bdg(['dom', 'inspect', '#tag', '--why', 'padding', '--tree', '0']);
    assert.match(shorthand, /\nwhy +padding = 4 8\n +✓ padding: 4px 8px +\.tag \(/);
    const onlyColor = await bdg(['dom', 'inspect', '#tag', '--props', 'color', '--rules']);
    assert.match(onlyColor, /\nrules +color #06c ← \.tag\.primary/);
    assert.doesNotMatch(onlyColor, /padding/);
  });

  void it('inspects the first rendered match and says so, and exits 83 when nothing matches', async () => {
    await bdg([
      'dom',
      'eval',
      'document.body.insertAdjacentHTML(\'afterbegin\', \'<p class="dup" style="display:none">a</p><p class="dup">b</p>\'); 1',
    ]);
    const output = await bdg(['dom', 'inspect', '.dup']);
    assert.match(output, /^p\.dup "b"/);
    assert.match(output, /2 elements match; inspected the first visible one \(\[1\]\)/);
    await bdg(['dom', 'inspect', '#nope'], 83);
  });
});
