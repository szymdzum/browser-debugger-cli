/**
 * Smoke tests for the one visibility verdict `dom inspect`, `dom layout` and
 * `:visible` give an element, from what it paints (#609), against a real
 * Chrome and the `/visibility-verdict` fixture page. Expectations are what a
 * person sees on the page, not what bdg printed before.
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

/** What a person sees of one element, and what each command must say */
interface Case {
  /** Element id */
  id: string;
  /** `dom inspect` tag about visibility (`hidden: …`, `offscreen: below`), or null for none */
  inspect: RegExp | null;
  /** `dom layout --json` `inViewport` */
  inViewport: string;
  /** `dom layout --json` `hiddenReason` pattern, when hidden */
  hiddenReason?: RegExp;
  /** Whether `dom query '#id:visible'` matches */
  visible: boolean;
}

/**
 * Cases of the matrix. `opacity: 0` and `clip-path` elements still match
 * `:visible` (documented Playwright contract), while both commands call them hidden.
 */
const CASES: Case[] = [
  {
    id: 'acc',
    inspect: /\[hidden: [^\]]*clipped by div[^\]]*zero height\]/,
    inViewport: 'hidden',
    hiddenReason: /clipped by div.*zero height/,
    visible: false,
  },
  { id: 'h', inspect: null, inViewport: 'visible', visible: true },
  { id: 'inline-block', inspect: null, inViewport: 'visible', visible: true },
  { id: 'contents', inspect: null, inViewport: 'visible', visible: true },
  {
    id: 'collapsed',
    inspect: /\[hidden: zero size\]/,
    inViewport: 'hidden',
    hiddenReason: /^zero size$/,
    visible: false,
  },
  {
    id: 'transparent',
    inspect: /\[hidden: opacity: 0\]/,
    inViewport: 'hidden',
    hiddenReason: /^opacity: 0$/,
    visible: true,
  },
  {
    id: 'clip-path',
    inspect: /\[hidden: clip-path: inset\(100%\)\]/,
    inViewport: 'hidden',
    hiddenReason: /^clip-path: inset\(100%\)$/,
    visible: true,
  },
  {
    id: 'vis-hidden',
    inspect: /\[hidden: visibility: hidden\]/,
    inViewport: 'hidden',
    hiddenReason: /^visibility: hidden$/,
    visible: false,
  },
  { id: 'far', inspect: /\[offscreen: below\]/, inViewport: 'below', visible: true },
];

/**
 * Run a bdg command.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Exit code and combined stdout and stderr
 */
async function bdg(args: string[]): Promise<{ exitCode: number; output: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

/**
 * Run a bdg command that must succeed.
 *
 * @param args - Full bdg argument list
 * @returns Combined stdout and stderr
 */
async function ok(args: string[]): Promise<string> {
  const { exitCode, output } = await bdg(args);
  assert.equal(exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

void describe('Visibility verdict from what an element paints', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await ok([`${fixture.url}visibility-verdict`, '--port', String(port), '--headless']);
    await ok(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const c of CASES) {
    void it(`#${c.id}: dom inspect, dom layout and :visible agree`, async () => {
      const inspect = (await ok(['dom', 'inspect', `#${c.id}`])).split('\n')[0] ?? '';
      if (c.inspect) assert.match(inspect, c.inspect, `inspect #${c.id}`);
      else assert.doesNotMatch(inspect, /\[(hidden|not rendered)/, `inspect #${c.id}`);

      const layout = await ok(['dom', 'layout', `#${c.id}`, '--json']);
      const [element] = (
        JSON.parse(layout) as { data: { elements: { inViewport: string; hiddenReason?: string }[] } }
      ).data.elements;
      assert.equal(element?.inViewport, c.inViewport, `layout #${c.id}: ${layout}`);
      if (c.hiddenReason) assert.match(element.hiddenReason ?? '', c.hiddenReason, `layout #${c.id}`);

      const query = await bdg(['dom', 'query', `#${c.id}:visible`, '--json']);
      const matched = query.exitCode === 0 && /"count":\s*[1-9]/.test(query.output);
      assert.equal(matched, c.visible, `query #${c.id}:visible: ${query.output}`);
    });
  }
});
