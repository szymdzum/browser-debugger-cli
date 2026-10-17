/**
 * bdg's page scripts get their data (the selector, the typed value, the
 * options) as `Runtime.callFunctionOn` arguments, never interpolated into
 * the script source (#637): a `dom fill` of a password must not put the
 * password into any expression Chrome could quote back in an error or a
 * debug log. Each script is driven against a recording CDP double with a
 * selector holding a quote and a backslash and a value holding a quote, a
 * newline, `</script>` and a `${` sequence.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { startFakeDaemon, type FakeDaemon } from '@/__testutils__/fakeDaemon.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { queryDOMElements } from '@/commands/dom/helpers/query.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { DomAuditCommand } from '@/ipc/protocol/commands.js';
import { auditPage } from '@/runtime/dom/audit.js';
import { inspectEventListeners } from '@/runtime/dom/eventListeners.js';
import { clickElement, fillElement } from '@/runtime/dom/formFillHelpers/fill.js';
import { pressKeyElement } from '@/runtime/dom/formFillHelpers/pressKey.js';
import { scrollPage } from '@/runtime/dom/formFillHelpers/scroll.js';
import { submitForm } from '@/runtime/dom/formSubmitHelpers.js';
import { inspectElement } from '@/runtime/dom/inspect.js';
import { onScriptTarget } from '@/runtime/dom/targetNode.js';
import { waitForCondition } from '@/runtime/dom/wait.js';
import { normalizeWaitText } from '@/runtime/dom/waitCondition.js';
import { scrollIntoViewAgain, scrollToElement } from '@/runtime/page/captureScroll.js';

/** A selector with a quote and a backslash */
const SELECTOR = `input[name="a\\b'c"]`;

/** A typed value with a quote, a newline, a closing script tag and a template sequence */
const VALUE = "PW-637-SECRET'\n</script>${x}";

/** A `dom audit` check name that is in no script's source */
const CHECK = 'probe-637';

/** One CDP call as the page saw it */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/** A `dom wait` snapshot that meets a selector condition at once */
const SNAPSHOT = { count: 1, textCount: 1, visibleCount: 1, readyState: 'complete', documentId: 1 };

/**
 * Properties of a page-side list: as a collected built-ins list, its first
 * built-in (the selector search) is replaced; as a list of matches, two
 * remote objects.
 */
const LIST_PROPERTIES = {
  result: [
    { name: '0', value: { type: 'number', value: 0, objectId: 'item-0' } },
    { name: '1', value: { type: 'function', description: 'function () {}', objectId: 'item-1' } },
  ],
};

/**
 * Answer a CDP call like a page that has what every script asks for.
 *
 * @param method - CDP method
 * @param params - Its parameters
 * @returns The answer
 */
function answer(method: string, params: Record<string, unknown>): unknown {
  if (method === 'Runtime.evaluate' || method === 'Runtime.callFunctionOn') {
    return params['returnByValue'] === true
      ? { result: { type: 'object', value: SNAPSHOT } }
      : { result: { type: 'object', objectId: 'obj-1' } };
  }
  if (method === 'Runtime.getProperties') return LIST_PROPERTIES;
  return {};
}

/**
 * A CDP double recording every call.
 *
 * @returns The connection and the calls it got
 */
function recordingCdp(): { cdp: CDPConnection; calls: Call[] } {
  const calls: Call[] = [];
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      calls.push({ method, params });
      return Promise.resolve(answer(method, params));
    },
    on: () => () => undefined,
    off: () => undefined,
  } as unknown as CDPConnection;
  return { cdp, calls };
}

/**
 * The script sources the page was sent: `Runtime.evaluate` expressions and
 * `Runtime.callFunctionOn` function declarations.
 *
 * @param calls - Recorded calls
 * @returns The sources
 */
function scriptSources(calls: Call[]): string[] {
  return calls.flatMap(({ params }) =>
    [params['expression'], params['functionDeclaration']].filter(
      (source): source is string => typeof source === 'string'
    )
  );
}

/**
 * Whether a call's arguments carry a value, as it is or inside an object.
 *
 * @param calls - Recorded calls
 * @param probe - The value
 * @returns True when some argument holds it
 */
function carriedAsArgument(calls: Call[], probe: string): boolean {
  const escaped = JSON.stringify(probe).slice(1, -1);
  return calls.some(({ params }) => {
    const args = params['arguments'];
    if (!Array.isArray(args)) return false;
    return args.some((arg: { value?: unknown }) => {
      const { value } = arg;
      if (value === probe) return true;
      return value !== null && typeof value === 'object' && JSON.stringify(value).includes(escaped);
    });
  });
}

/**
 * The forms a value takes when interpolated into script source: as it is,
 * as a JSON string literal's body, and as a single-quoted literal's body.
 *
 * @param probe - The value
 * @returns Its encodings
 */
function sourceForms(probe: string): string[] {
  const json = JSON.stringify(probe).slice(1, -1);
  return [probe, json, json.replace(/'/g, "\\'")];
}

/**
 * Assert that no script source holds a probe and that the arguments do.
 *
 * @param calls - Recorded calls
 * @param probes - The data the script was given
 */
function assertPassedAsArguments(calls: Call[], probes: string[]): void {
  const sources = scriptSources(calls);
  assert.ok(sources.length > 0, 'no page script was sent');
  for (const probe of probes) {
    const forms = sourceForms(probe);
    const leaked = sources.find((source) => forms.some((form) => source.includes(form)));
    assert.ok(
      leaked === undefined,
      `${JSON.stringify(probe)} is in a script source: ${leaked?.slice(0, 160)}`
    );
    assert.ok(carriedAsArgument(calls, probe), `${JSON.stringify(probe)} is not in the arguments`);
  }
}

/** A page script with the data it is given and the command that runs it */
interface Script {
  name: string;
  probes: string[];
  run: (cdp: CDPConnection) => Promise<unknown>;
}

const SCRIPTS: Script[] = [
  {
    name: 'dom fill (REACT_FILL_SCRIPT)',
    probes: [SELECTOR, VALUE],
    run: (cdp) => fillElement(cdp, SELECTOR, VALUE),
  },
  {
    name: 'dom click (CLICK_ELEMENT_SCRIPT)',
    probes: [SELECTOR],
    run: (cdp) => clickElement(cdp, SELECTOR, { index: 1 }),
  },
  {
    name: 'dom scroll (SCROLL_TO_ELEMENT_SCRIPT)',
    probes: [SELECTOR],
    run: (cdp) => scrollPage(cdp, SELECTOR, { index: 1 }),
  },
  {
    name: 'dom press-key (FOCUS_ELEMENT_SCRIPT)',
    probes: [SELECTOR],
    run: (cdp) => pressKeyElement(cdp, SELECTOR, 'Enter'),
  },
  {
    name: 'dom listeners (SELECT_JS)',
    probes: [SELECTOR],
    run: (cdp) => inspectEventListeners(cdp, { selector: SELECTOR, index: 1 }),
  },
  {
    name: 'dom inspect (DEEP_QUERY_JS)',
    probes: [SELECTOR],
    run: (cdp) => inspectElement(cdp, { selector: SELECTOR }),
  },
  {
    name: 'dom wait (WAIT_SNAPSHOT_JS)',
    probes: [SELECTOR, normalizeWaitText(VALUE)],
    run: (cdp) => waitForCondition(cdp, { selector: SELECTOR, text: VALUE, timeout: 2000 }),
  },
  {
    name: 'dom audit (AUDIT_PAGE_JS)',
    probes: [CHECK],
    run: (cdp) =>
      auditPage(cdp, { checks: [CHECK] as unknown as DomAuditCommand['checks'], limit: 1 }),
  },
  {
    name: 'dom screenshot --scroll (captureScroll)',
    probes: [SELECTOR],
    run: (cdp) => scrollToElement(cdp, SELECTOR),
  },
  {
    name: 'dom screenshot --scroll again (captureScroll)',
    probes: [SELECTOR],
    run: (cdp) => scrollIntoViewAgain(cdp, SELECTOR),
  },
  {
    name: 'dom submit (PREPARE_SUBMIT_SCRIPT)',
    probes: [SELECTOR],
    run: (cdp) => submitForm(cdp, SELECTOR, { index: 1, waitNetwork: 0, timeout: 100 }),
  },
  {
    name: 'bound matches of a tampered page (window.__bdgMatches)',
    probes: [SELECTOR],
    run: (cdp) => onScriptTarget(cdp, { selector: SELECTOR }, () => Promise.resolve({})),
  },
];

void describe('page scripts get their data as arguments (#637)', () => {
  for (const script of SCRIPTS) {
    void it(`${script.name}: the data is in the arguments, not in the source`, async () => {
      const { cdp, calls } = recordingCdp();
      await script.run(cdp).catch(() => undefined);
      assertPassedAsArguments(calls, script.probes);
    });
  }
});

void describe('dom query sends the selector as an argument (#637)', () => {
  const sessionDir = process.env['BDG_SESSION_DIR'];
  let daemon: FakeDaemon | undefined;

  before(() => {
    process.env['BDG_SESSION_DIR'] = makeTempDir('bdg-637-');
  });

  afterEach(async () => {
    await daemon?.close();
    daemon = undefined;
  });

  after(() => {
    if (sessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
    else process.env['BDG_SESSION_DIR'] = sessionDir;
    removeTempDirs();
  });

  void it('dom query (DEEP_QUERY_JS): the selector is in the arguments, not in the source', async () => {
    const { cdp, calls } = recordingCdp();
    daemon = await startFakeDaemon({ send: (method, params) => cdp.send(method, params) });
    await queryDOMElements(SELECTOR).catch(() => undefined);
    assertPassedAsArguments(calls, [SELECTOR]);
  });
});
