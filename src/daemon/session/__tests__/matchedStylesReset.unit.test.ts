/**
 * Daemon commands that may change the page drop `dom inspect`'s kept matched
 * rules (`:checked` after a click changes with no CDP event); read-only ones
 * keep them. Checked on the hook and through `Session.execute`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { Session } from '@/daemon/session/Session.js';
import {
  KEEPS_MATCHED_STYLES,
  withMatchedStylesReset,
} from '@/daemon/session/matchedStylesReset.js';
import { matchedStyles } from '@/runtime/dom/inspectRules.js';
import { delay } from '@/utils/async.js';

/** An answer slow enough to be kept (over 300 ms) */
const SLOW_MS = 350;

/**
 * A CDP connection whose matched-styles answers are slow enough to be kept.
 *
 * @returns Connection and how many requests it received
 */
function slowCdp(): { cdp: CDPConnection; sent: () => number } {
  let sent = 0;
  const cdp = {
    send: async () => {
      sent++;
      await delay(SLOW_MS);
      return { matchedCSSRules: [] };
    },
    on: () => () => undefined,
  } as unknown as CDPConnection;
  return { cdp, sent: () => sent };
}

/**
 * Read the element's matched rules twice around a step.
 *
 * @param cdp - CDP connection
 * @param step - What runs between the reads
 */
async function readAround(cdp: CDPConnection, step: () => Promise<unknown>): Promise<void> {
  await matchedStyles(cdp, 7, 2000);
  await step();
  await matchedStyles(cdp, 7, 2000);
}

/**
 * A session with a fake connection and stub command handlers, as if launched.
 *
 * @param cdp - CDP connection
 * @returns Session
 */
function launchedSession(cdp: CDPConnection): Session {
  const session = Session.create('http://localhost:9', {}, () => undefined);
  const internals = session as unknown as {
    cdp: CDPConnection;
    started: boolean;
    registry: Record<string, () => Promise<unknown>>;
  };
  internals.cdp = cdp;
  internals.started = true;
  internals.registry = {
    dom_click: () => Promise.resolve({}),
    dom_inspect: () => Promise.resolve({}),
  };
  return session;
}

void describe('withMatchedStylesReset', () => {
  void it('drops kept answers around a command that may change the page (a click)', async () => {
    const { cdp, sent } = slowCdp();
    await readAround(cdp, () => withMatchedStylesReset(cdp, 'dom_click', () => Promise.resolve()));
    assert.equal(sent(), 2);
  });

  void it('drops them when the command fails too, and passes the failure on', async () => {
    const { cdp, sent } = slowCdp();
    await readAround(cdp, () =>
      assert.rejects(
        withMatchedStylesReset(cdp, 'cdp_call', () => Promise.reject(new Error('boom'))),
        /boom/
      )
    );
    assert.equal(sent(), 2);
  });

  void it('keeps them across commands that only read the page', async () => {
    const { cdp, sent } = slowCdp();
    await readAround(cdp, async () => {
      await withMatchedStylesReset(cdp, 'dom_inspect', () => Promise.resolve());
      await withMatchedStylesReset(cdp, 'session_peek', () => Promise.resolve());
    });
    assert.equal(sent(), 1);
  });

  void it('lists only commands that leave the page as it is (a deliberate change)', () => {
    assert.deepEqual([...KEEPS_MATCHED_STYLES].sort(), [
      'css_search',
      'dom_audit',
      'dom_form_discover',
      'dom_frames',
      'dom_inspect',
      'dom_layout',
      'dom_listeners',
      'session_details',
      'session_har_data',
      'session_network_headers',
      'session_peek',
      'session_status',
    ]);
  });
});

void describe('Session.execute', () => {
  void it('drops the kept matched rules when it runs dom_click', async () => {
    const { cdp, sent } = slowCdp();
    const session = launchedSession(cdp);
    await readAround(cdp, () => session.execute('dom_click', { selector: '#c' }));
    assert.equal(sent(), 2);
  });

  void it('keeps them when it runs dom_inspect', async () => {
    const { cdp, sent } = slowCdp();
    const session = launchedSession(cdp);
    await readAround(cdp, () => session.execute('dom_inspect', { selector: '#c' }));
    assert.equal(sent(), 1);
  });

  void it('rejects a name that is not a registered command, such as a prototype key', async () => {
    const { cdp } = slowCdp();
    const session = launchedSession(cdp);
    const execute = session.execute.bind(session) as (
      name: string,
      params: unknown
    ) => Promise<unknown>;
    await assert.rejects(execute('constructor', {}), /Unknown session command: "constructor"/);
  });
});
