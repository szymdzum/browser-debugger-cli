/**
 * Element targeting smoke test.
 *
 * Indices from `dom query` / `dom form` must keep addressing the exact element
 * they listed: other elements appearing, selector-based commands in between,
 * or same-name radio buttons must not redirect them, and an element that is
 * gone (removed, or the page navigated) must fail with exit 87 instead of
 * silently acting on whatever matches now.
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
import { LAYOUT_REASONS } from '@/ui/messages/commands.js';

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
 * Evaluate an expression in the page and return its result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

const LIST_HTML =
  '<ul id="list">' +
  ['one', 'two', 'three']
    .map((t) => `<li class="item" onclick="window.hit='${t}'">${t}</li>`)
    .join('') +
  '</ul>' +
  '<form id="sizes"><label>S<input type="radio" name="size" value="s"></label>' +
  '<label>M<input type="radio" name="size" value="m"></label>' +
  '<label>L<input type="radio" name="size" value="l"></label></form>';

const TODO_HTML =
  '<ul id="todos">' +
  ['Buy milk', 'Write report', 'Call Ada']
    .map((t) => `<li><input class="toggle" type="checkbox"><label>${t}</label></li>`)
    .join('') +
  '</ul>';

const SCOPES_HTML =
  '<div class="card"><span>Pro plan</span><div id="card-host"></div></div>' +
  '<section id="nest"><div><div><i class="x">1</i></div><i class="x">2</i></div></section>' +
  '<div id="hidden-script" style="display:none">Hidden words<script>var secretWord = 1;</script>' +
  '<style>.secretWord{}</style></div>';

const TEXT_HTML =
  '<div id="flash" class="flash">Saved your changes!<a href="#" class="close">×</a></div>' +
  `<div id="long-text">${'Lorem ipsum dolor sit amet. '.repeat(40)}The end.</div>`;

/** Same click target: an overlay span in the link, a news card's overlay link, a button under it */
const CLICK_TARGETS_HTML =
  '<div id="click-targets">' +
  '<a href="#pic" style="position: absolute; left: 450px; top: 10px; width: 60px; height: 40px">' +
  '<img id="pic" style="display: block; width: 60px; height: 40px" alt="">' +
  '<span style="position: absolute; inset: 0"></span></a>' +
  '<div style="position: absolute; left: 520px; top: 10px; width: 160px; height: 80px">' +
  '<h3 id="faux-headline" style="margin: 0; font-size: 14px">Headline</h3>' +
  '<button id="under-card-link" style="left: 0; top: 40px">Save</button>' +
  '<a href="#story" style="position: absolute; inset: 0"></a></div>' +
  '<div style="position: absolute; left: 450px; top: 360px; width: 100px; height: 40px">' +
  '<h4 id="promo-headline" style="margin: 0">Promo</h4>' +
  '<a href="#promo" style="position: absolute; inset: 0">Buy now</a></div>' +
  '<div style="position: absolute; left: 560px; top: 360px; width: 100px; height: 40px">' +
  '<h4 id="role-headline" style="margin: 0">Role</h4>' +
  '<a href="#role" role="button" style="position: absolute; inset: 0"></a></div>' +
  '<div style="position: absolute; left: 450px; top: 410px; width: 100px; height: 40px">' +
  '<h4 id="dismiss-headline" style="margin: 0">Dismiss</h4>' +
  '<button style="left: 0; top: 0; width: 100px; height: 40px">×</button></div>' +
  '<div style="position: absolute; top: 2500px; left: 0; height: 300px">' +
  '<div id="sticky-note" style="position: sticky; top: 0">Note</div></div></div>';

const VISIBILITY_HTML =
  '<ul id="shown"><li>shown</li><li style="display:none">gone</li>' +
  '<li style="visibility:hidden">invisible</li></ul>';

/**
 * Text previews of the elements a selector matches.
 *
 * @param selector - Selector for `dom query`
 * @returns Previews in match order
 */
async function queryPreviews(selector: string): Promise<string[]> {
  const output = await bdg(['dom', 'query', selector, '--json']);
  const data = JSON.parse(output) as { data: { nodes: Array<{ preview?: string }> } };
  return data.data.nodes.map((node) => node.preview ?? '');
}

void describe('Element targeting', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}interactions`, '--port', String(port), '--headless']);
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(LIST_HTML)}); 1`
    );
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('keeps clicking the queried element after the DOM changes', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate(
      `document.getElementById('list').insertAdjacentHTML('afterbegin', '<li class="item" onclick="window.hit=\\'new\\'">new</li>'); 1`
    );
    await bdg(['dom', 'click', '0']);
    assert.equal(await evaluate('window.hit'), 'one');
  });

  void it('keeps indices valid across selector-based commands', async () => {
    await bdg(['dom', 'query', '.item']);
    await bdg(['dom', 'get', 'h1'], 83);
    await bdg(['dom', 'get', '#form']);
    assert.match(await bdg(['dom', 'get', '1']), /one/);
  });

  void it('fails with 87 for an element that was removed', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate("document.querySelector('.item').remove(); 1");
    assert.match(await bdg(['dom', 'click', '0'], 87), /no longer in the page/);
    await bdg(['dom', 'get', '0'], 87);
    await bdg(['dom', 'get', '1']);
  });

  void it('fills the right radio button from dom form indices', async () => {
    const output = await bdg(['dom', 'form', '--all', '--json']);
    const data = JSON.parse(output) as {
      data: { forms: Array<{ fields: Array<{ index: number; selector: string }> }> };
    };
    const fields = data.data.forms.flatMap((form) => form.fields);
    const medium = fields.find((field) => field.selector.includes('"m"'));
    assert.ok(medium, `radio fields: ${JSON.stringify(fields.map((f) => f.selector))}`);
    await bdg(['dom', 'fill', String(medium.index), 'true']);
    assert.equal(await evaluate("document.querySelector('[name=size]:checked')?.value"), 'm');
  });

  void it('clicks by text with :has-text()', async () => {
    const before = Number(await evaluate('window.submits'));
    await bdg(['dom', 'click', 'button:has-text("send")']);
    assert.equal(await evaluate('window.submits'), before + 1);
  });

  void it('filters matches with :visible, :text-is() and selector lists', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(VISIBILITY_HTML)}); 1`
    );
    assert.deepEqual(await queryPreviews('#shown li:visible'), ['shown']);
    assert.deepEqual(
      await queryPreviews('#shown li:text-is("Shown"), #menu-trigger:has-text("MENU")'),
      ['Menu']
    );
    assert.deepEqual(await queryPreviews('#shown li:text-is("shown"), #shown li:visible'), [
      'shown',
    ]);
  });

  void it('clicks the control in the row that holds a text (scoped filters, :has)', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(TODO_HTML)}); 1`
    );
    const checked = (): Promise<unknown> =>
      evaluate("[...document.querySelectorAll('#todos .toggle')].map((t) => t.checked)");
    await bdg(['dom', 'click', 'li:has-text("Write report") .toggle']);
    assert.deepEqual(await checked(), [false, true, false]);
    await bdg(['dom', 'click', '#todos li:has(label:text-is("Buy milk")) > .toggle']);
    assert.deepEqual(await checked(), [true, true, false]);
    assert.deepEqual(await queryPreviews('#todos li:has-text("report") label'), ['Write report']);
  });

  void it('rejects filters before sibling combinators or inside :not() with 81', async () => {
    const output = await bdg(['dom', 'click', 'li:has-text("Buy milk") + li .toggle'], 81);
    assert.match(output, /descendant \(space\) or child \(>\) combinator/);
    assert.match(await bdg(['dom', 'query', 'li:not(:visible)'], 81), /inside :has\(\)/);
    await bdg(['dom', 'query', 'p:has-text("")'], 81);
  });

  void it('scopes into open shadow roots, in document order and without duplicates', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(SCOPES_HTML)}); ` +
        "document.getElementById('card-host').attachShadow({ mode: 'open' }).innerHTML = " +
        '\'<button class="btn" onclick="window.hit=\\\'shadow\\\'">Buy</button>\'; 1'
    );
    await bdg(['dom', 'click', 'div.card:has-text("Pro plan") .btn']);
    assert.equal(await evaluate('window.hit'), 'shadow');
    assert.equal((await queryPreviews('div.card:has(.btn:text-is("Buy"))')).length, 1);
    assert.deepEqual(await queryPreviews('#nest div:visible .x'), ['1', '2']);
    assert.deepEqual(await queryPreviews('#nest i:text-is("2"), #nest i:text-is("1")'), ['1', '2']);
    await bdg(['dom', 'query', '#nest div:has(:scope > i:visible)'], 81);
  });

  void it('ignores script and style text of hidden elements', async () => {
    assert.equal((await queryPreviews('#hidden-script:has-text("hidden words")')).length, 1);
    await bdg(['dom', 'query', '#hidden-script:has-text("secretWord")'], 83);
  });

  void it('matches the text of hidden elements and counts what :visible left out', async () => {
    assert.equal((await queryPreviews('#shown li:has-text("invisible")')).length, 1);
    assert.equal((await queryPreviews('#shown li:text-is("gone")')).length, 1);
    const output = await bdg(['dom', 'query', '#shown li:has-text("invisible"):visible'], 83);
    assert.match(output, /1 element match(es)? without :visible but is hidden/);
  });

  void it('shows all of the text with --full, without close buttons', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(TEXT_HTML)}); 1`
    );
    assert.match(
      await bdg(['dom', 'get', '#flash']),
      /"Saved your changes!"$/m,
      'no × at the end of the flash text'
    );
    const cut = await bdg(['dom', 'get', '#long-text']);
    assert.match(cut, /\(cut at 500 characters; --full shows all of it\)$/m);
    const full = await bdg(['dom', 'get', '#long-text', '--full']);
    assert.match(full, /The end\.$/m);
    assert.doesNotMatch(full, /cut at 500/);
    await bdg(['dom', 'get', '#long-text', '--full', '--raw'], 81);
  });

  void it('fails with 87 after the page navigated', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate('location.href = location.href; 1');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await bdg(['dom', 'get', '0'], 87);
    await bdg(['dom', 'click', '0'], 87);
  });
});

/** The `data` of `dom layout --json` (the fields the tests read). */
interface LayoutData {
  count: number;
  page: { viewport: { width: number; height: number }; document: { height: number } };
  elements: Array<{
    index: number;
    element: string;
    context?: string;
    bounds: { x: number; y: number; width: number; height: number };
    inViewport: string;
    hiddenReason?: string;
    scrollBy?: { x: number; y: number };
    clippedBy?: string;
    offScreenReason?: string;
    coveredBy?: string;
    invisible?: string;
  }>;
}

/**
 * Layout of the elements an argument refers to.
 *
 * @param args - Selector or index, then options
 * @returns Layout data
 */
async function layout(...args: string[]): Promise<LayoutData> {
  const output = await bdg(['dom', 'layout', ...args, '--json']);
  return (JSON.parse(output) as { data: LayoutData }).data;
}

void describe('Element layout', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}layout`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports an element below the fold with page coordinates and the scroll to it', async () => {
    const data = await layout('#save');
    const [save] = data.elements;
    assert.deepEqual(save?.bounds, { x: 20, y: 2000, width: 120, height: 40 });
    assert.equal(save?.inViewport, 'below');
    assert.equal(save?.scrollBy?.y, Math.round(2020 - data.page.viewport.height / 2));
    assert.ok(data.page.document.height >= 3000);
    assert.match(
      await bdg(['dom', 'layout', '#save']),
      /20,2000 120×40 {2}below fold \(scroll down \d+px to centre it\)/
    );
  });

  void it('names the element covering another, and none for an uncovered one', async () => {
    const data = await layout('#top, #covered');
    assert.deepEqual(
      data.elements.map((element) => [element.inViewport, element.coveredBy]),
      [
        ['visible', undefined],
        ['visible', 'div#overlay'],
      ]
    );
  });

  void it('reports no cover where hit-testing passes through or a link wraps', async () => {
    const data = await layout('#click-through, #under-glass, #wrapped');
    assert.deepEqual(
      data.elements.map((element) => [element.inViewport, element.coveredBy]),
      [
        ['visible', undefined],
        ['visible', undefined],
        ['visible', undefined],
      ]
    );
  });

  void it('does not clip an absolutely positioned dropdown by a static overflow parent', async () => {
    const [dropdown] = (await layout('#dropdown')).elements;
    assert.equal(dropdown?.inViewport, 'visible', JSON.stringify(dropdown));
  });

  void it('says why a hidden element is hidden', async () => {
    const [gone] = (await layout('#gone')).elements;
    assert.equal(gone?.inViewport, 'hidden');
    assert.equal(gone?.hiddenReason, 'display: none');
  });

  void it('reports content in a closed <details> as hidden and not :visible', async () => {
    const [answer] = (await layout('#in-details')).elements;
    assert.equal(answer?.inViewport, 'hidden');
    assert.equal(answer?.hiddenReason, 'inside a closed <details>');
    const visible = JSON.parse(await bdg(['dom', 'query', 'button:visible', '--json'])) as {
      data: { nodes: Array<{ id?: string }> };
    };
    const ids = visible.data.nodes.map((node) => node.id);
    assert.ok(ids.includes('top') && !ids.includes('in-details'), JSON.stringify(ids));
  });

  void it('gives no page scroll for a fixed off-canvas link or one beyond the scroll range', async () => {
    const [offCanvas, skip] = (await layout('#off-canvas, #skip')).elements;
    assert.equal(offCanvas?.inViewport, 'left');
    assert.equal(offCanvas?.scrollBy, undefined);
    assert.match(offCanvas?.offScreenReason ?? '', /fixed/);
    assert.equal(skip?.inViewport, 'left');
    assert.equal(skip?.scrollBy, undefined);
    assert.match(skip?.offScreenReason ?? '', /scroll range/);

    const [inTransform] = (await layout('#fixed-in-transform')).elements;
    assert.equal(
      inTransform?.inViewport,
      'below',
      'fixed inside a transform scrolls with the page'
    );
    assert.ok(inTransform?.scrollBy, 'gets scroll advice');
    assert.equal(inTransform?.offScreenReason, undefined);
  });

  void it('names a scrolling body instead of advising a page scroll it cannot do', async () => {
    await evaluate(
      "document.documentElement.style.cssText = 'height: 100%; overflow: hidden'; document.body.style.cssText = 'position: relative; overflow: auto; height: 100%'; 1"
    );
    try {
      const [save] = (await layout('#save')).elements;
      assert.equal(save?.inViewport, 'below');
      assert.equal(save?.clippedBy, 'body');
      assert.equal(save?.scrollBy, undefined);
    } finally {
      await evaluate(
        "document.documentElement.style.cssText = ''; document.body.style.cssText = ''; 1"
      );
    }
  });

  void it('says page scrolling is locked instead of calling in-flow content fixed', async () => {
    await evaluate(
      "document.body.style.cssText = 'position: fixed; overflow: hidden; top: 0; left: 0; right: 0'; 1"
    );
    try {
      const [save] = (await layout('#save')).elements;
      assert.equal(save?.inViewport, 'below');
      assert.equal(save?.scrollBy, undefined);
      assert.equal(
        save?.offScreenReason,
        'page scrolling is locked (position: fixed, overflow: hidden on body)'
      );
      const [offCanvas] = (await layout('#off-canvas')).elements;
      assert.match(offCanvas?.offScreenReason ?? '', /fixed position/);

      await evaluate(
        'document.body.insertAdjacentHTML(\'beforeend\', \'<div id="consent" role="dialog" style="position: fixed; left: 300px; top: 300px; width: 200px; height: 100px">Cookies?</div><div id="closed" role="dialog" hidden>Old</div>\'); 1'
      );
      assert.match(
        await bdg(['dom', 'layout', '#save']),
        /below fold; page scrolling is locked \(position: fixed, overflow: hidden on body\), likely by dialog div#consent$/m
      );
    } finally {
      await evaluate(
        "document.body.style.cssText = ''; document.querySelectorAll('#consent, #closed').forEach((el) => el.remove()); 1"
      );
    }
  });

  void it('reports the same viewport (without scrollbars) in dom scroll and dom layout', async () => {
    const { page } = await layout('#top');
    const scroll = JSON.parse(await bdg(['dom', 'scroll', '#top', '--json'])) as {
      data: { viewportSize: { width: number; height: number } };
    };
    assert.deepEqual(scroll.data.viewportSize, page.viewport);
  });

  void it('clips a scroll list inside CSS zoom where it shows', async () => {
    const data = await layout('.zoomed');
    assert.deepEqual(
      data.elements.map((element) => [element.inViewport, element.clippedBy]),
      [
        ['visible', undefined],
        ['visible', undefined],
        ['partly', 'div#zoom-box'],
        ['below', 'div#zoom-box'],
      ],
      JSON.stringify(data.elements)
    );
  });

  void it('reports an ancestor ::after overlay as cover, like dom click', async () => {
    const [inCard] = (await layout('#in-card')).elements;
    assert.equal(inCard?.coveredBy, 'div.card');
    assert.match(
      await bdg(['dom', 'click', '#in-card']),
      /covered by another element \(div\.card\)/
    );
  });

  void it('reports a collapsed accordion as hiding, and an opacity: 0 parent', async () => {
    const [inAccordion, inFaded] = (await layout('#in-accordion, #in-faded')).elements;
    assert.equal(inAccordion?.inViewport, 'hidden');
    assert.equal(inAccordion?.hiddenReason, 'clipped by div#accordion: zero height');
    assert.equal(inFaded?.inViewport, 'visible');
    assert.equal(inFaded?.invisible, 'opacity: 0 on div#faded');
    const human = await bdg(['dom', 'layout', '#in-accordion']);
    assert.match(
      human,
      /^ {2}\[0\] a#in-accordion "Answer link" {2}hidden \(clipped by div#accordion: zero height\)$/m
    );
  });

  void it('flags clip, clip-path and slot-wrapper opacity, and explains a hidden <option>', async () => {
    const data = await layout('#sr-only, #in-clipped, #first-option, #slotted, #in-sliver');
    const byElement = new Map(data.elements.map((element) => [element.element, element]));
    assert.equal(byElement.get('span#sr-only')?.invisible, 'clip: rect(0px, 0px, 0px, 0px)');
    assert.equal(byElement.get('a#in-clipped')?.invisible, 'clip-path: inset(50%) on div#clipped');
    assert.equal(byElement.get('a#slotted')?.invisible, 'opacity: 0 on div#slot-fade');
    const option = byElement.get('option#first-option');
    assert.equal(option?.inViewport, 'hidden');
    assert.equal(option?.hiddenReason, LAYOUT_REASONS.option);
    const sliver = byElement.get('a#in-sliver');
    assert.notEqual(sliver?.inViewport, 'hidden', JSON.stringify(sliver));
  });

  void it('finds content of a closed <details> by its text', async () => {
    const found = JSON.parse(
      await bdg(['dom', 'query', 'button:has-text("answer")', '--json'])
    ) as { data: { nodes: Array<{ id?: string }> } };
    assert.deepEqual(
      found.data.nodes.map((node) => node.id),
      ['in-details']
    );
  });

  void it('matches :has-text against the text of visibility: hidden elements', async () => {
    const ghost = JSON.parse(
      await bdg(['dom', 'query', 'span:has-text("ghost text")', '--json'])
    ) as { data: { nodes: Array<{ id?: string }> } };
    assert.deepEqual(
      ghost.data.nodes.map((node) => node.id),
      ['ghost']
    );
  });

  void it('suggests the command that was run when an index gets --index', async () => {
    assert.match(
      await bdg(['dom', 'layout', '0', '--index', '1'], 81),
      /bdg dom layout 0, or bdg dom layout "<selector>" --index <n>/
    );
  });

  void it('exits 81 for an empty selector', async () => {
    assert.match(await bdg(['dom', 'layout', ''], 81), /selector is empty/);
    await bdg(['dom', 'click', ''], 81);
  });

  void it('adds the iframe offset for an element inside a same-origin iframe', async () => {
    const [button] = (await layout('#frame-button')).elements;
    assert.equal(button?.context, 'iframe');
    assert.equal(button?.inViewport, 'visible');
    assert.ok((button?.bounds.x ?? 0) >= 300 + 5 + 10 + 120, JSON.stringify(button));
    assert.ok((button?.bounds.y ?? 0) >= 100 + 5 + 10, JSON.stringify(button));
  });

  void it('ignores covers that are part of the same click target, and explains sticky and partly visible elements', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(CLICK_TARGETS_HTML)}); 1`
    );
    try {
      const data = await layout('#pic, #faux-headline, #under-card-link');
      assert.deepEqual(
        data.elements.map((element) => [element.inViewport, element.coveredBy]),
        [
          ['visible', undefined],
          ['visible', undefined],
          ['visible', 'a'],
        ],
        JSON.stringify(data.elements)
      );
      const covers = await layout('#promo-headline, #role-headline, #dismiss-headline');
      assert.deepEqual(
        covers.elements.map((element) => element.coveredBy),
        ['a', 'a', 'button'],
        'links with text, role=button overlays and dismiss buttons still cover'
      );
      assert.match(
        await bdg(['dom', 'layout', '#sticky-note']),
        /below fold \(off-screen: sticky position, page scroll moves it only until it sticks\)$/m
      );
      await evaluate(
        "document.getElementById('click-targets').insertAdjacentHTML('beforeend', '<p id=\"straddle\" style=\"position: absolute; left: 10px; margin: 0; width: 100px; height: 60px; top: ' + (document.documentElement.clientHeight + scrollY - 20) + 'px\">Straddle</p>'); 1"
      );
      assert.match(
        await bdg(['dom', 'layout', '#straddle']),
        /partly visible \(33%\); scroll down \d+px to see all of it$/m
      );
    } finally {
      await evaluate("document.getElementById('click-targets').remove(); 1");
    }
  });

  void it('marks query matches outside the viewport and measures cached indices', async () => {
    const output = await bdg(['dom', 'query', 'button']);
    assert.match(output, /\[2\] <button id="save"> Save \(below fold\)$/m);
    assert.match(output, /\[0\] <button id="top"> Top$/m);
    const [save] = (await layout('2')).elements;
    assert.equal(save?.index, 2);
    assert.equal(save?.inViewport, 'below');
  });

  void it('exits 81 for --index out of range, 83 for no match and 87 for a stale index', async () => {
    await bdg(['dom', 'layout', 'button', '--index', '9'], 81);
    await bdg(['dom', 'layout', '#missing'], 83);
    await bdg(['dom', 'query', '#save']);
    await bdg(['dom', 'eval', "document.getElementById('save').remove(); 1"]);
    await bdg(['dom', 'layout', '0'], 87);
  });
});
