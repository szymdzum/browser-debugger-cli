/**
 * `bdg cdp` event flags before anything is sent: which mode the flags ask
 * for, event names checked against the bundled protocol (typos exit 81 with
 * suggestions), flags given without the mode they belong to, and the
 * `--timeout`/`--wait` ranges. Also the notes on event-based methods.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { cdpCallResult } from '@/commands/cdp.js';
import { parseEventNames, planEventCommand } from '@/commands/cdpEvents.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Assert a call fails with exit 81 and a message matching a pattern.
 *
 * @param run - Call
 * @param message - Expected message
 * @param suggestion - Expected suggestion
 */
function assertInvalid(run: () => unknown, message: RegExp, suggestion?: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof CommandError, String(error));
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, message);
    if (suggestion) assert.match(String(error.metadata['suggestion']), suggestion);
    return true;
  });
}

void describe('parseEventNames', () => {
  void it('normalizes bundled events, comma-separated', () => {
    assert.deepEqual(parseEventNames('tracing.datacollected, Tracing.tracingComplete'), {
      events: ['Tracing.dataCollected', 'Tracing.tracingComplete'],
    });
  });

  void it('suggests the bundled event a typo was meant to be', () => {
    assertInvalid(
      () => parseEventNames('Fetch.requestPausd'),
      /Unknown CDP event 'Fetch.requestPausd'/,
      /Did you mean:\n {2}- Fetch\.requestPaused/
    );
  });

  void it('says a method is not an event and lists the events of its domain', () => {
    assertInvalid(
      () => parseEventNames('Tracing.end'),
      /Tracing.end is a method, not an event/,
      /Tracing\.dataCollected/
    );
  });

  void it('takes an event the bundled protocol lacks as typed, with a warning', () => {
    const parsed = parseEventNames('Fetch.somethingBrandNew');
    assert.deepEqual(parsed.events, ['Fetch.somethingBrandNew']);
    assert.match(parsed.warning ?? '', /not an event in the bundled protocol/);
  });

  void it('rejects names that are not Domain.event', () => {
    assertInvalid(() => parseEventNames('requestPaused'), /not a CDP event name/);
    assertInvalid(() => parseEventNames(' , '), /not a CDP event name/);
  });
});

void describe('planEventCommand', () => {
  void it('leaves plain calls and discovery alone', () => {
    assert.equal(planEventCommand('Network.getCookies', {}), undefined);
    assert.equal(planEventCommand(undefined, { list: true }), undefined);
  });

  void it('plans a collection with a 10 s default timeout', () => {
    const plan = planEventCommand('Tracing.end', {
      collect: 'Tracing.dataCollected',
      until: 'Tracing.tracingComplete',
      out: 't.ndjson',
    });
    assert.equal(plan?.mode, 'collect');
    assert.deepEqual(plan.mode === 'collect' && plan.collect, {
      events: ['Tracing.dataCollected'],
      until: 'Tracing.tracingComplete',
      timeoutMs: 10_000,
      out: path.resolve('t.ndjson'),
    });
  });

  void it('takes --until alone as the event to collect and wait for', () => {
    const plan = planEventCommand('Page.reload', { until: 'Page.loadEventFired', timeout: '2.5' });
    assert.ok(plan?.mode === 'collect');
    assert.deepEqual(plan.collect.events, []);
    assert.equal(plan.collect.timeoutMs, 2500);
  });

  void it('limits --timeout to 120 s and --wait to 120 s', () => {
    assertInvalid(
      () => planEventCommand('Tracing.end', { collect: 'Tracing.dataCollected', timeout: '121' }),
      /--timeout must be a number of seconds from 0 to 120/
    );
    assertInvalid(
      () => planEventCommand('Tracing.end', { collect: 'Tracing.dataCollected', timeout: '0' }),
      /--timeout must be/
    );
    assertInvalid(() => planEventCommand(undefined, { events: true, wait: 'soon' }), /--wait/);
  });

  void it('plans listen, events and unlisten', () => {
    assert.deepEqual(planEventCommand(undefined, { listen: 'fetch.requestPaused' }), {
      mode: 'listen',
      events: ['Fetch.requestPaused'],
    });
    assert.deepEqual(
      planEventCommand(undefined, { events: 'Fetch.requestPaused', wait: '5', clear: true }),
      {
        mode: 'events',
        request: {
          action: 'read',
          events: ['Fetch.requestPaused'],
          waitMs: 5000,
          clear: true,
        },
      }
    );
    assert.deepEqual(planEventCommand(undefined, { events: true }), {
      mode: 'events',
      request: { action: 'read' },
    });
    assert.deepEqual(planEventCommand(undefined, { unlisten: true }), { mode: 'unlisten' });
  });

  void it('takes a method with --listen as one to call once listening', () => {
    const plan = planEventCommand('Fetch.enable', { listen: 'Fetch.requestPaused' });
    assert.deepEqual(plan, { mode: 'listen', events: ['Fetch.requestPaused'] });
  });

  void it('rejects flags without the mode they belong to', () => {
    assertInvalid(
      () => planEventCommand(undefined, { collect: 'Tracing.dataCollected' }),
      /--collect needs a method/
    );
    assertInvalid(
      () => planEventCommand('Tracing.end', { timeout: '5' }),
      /--timeout needs --collect or --until/
    );
    assertInvalid(() => planEventCommand('Tracing.end', { out: 'x.ndjson' }), /--out needs/);
    assertInvalid(() => planEventCommand(undefined, { wait: '5' }), /--wait needs --events/);
    assertInvalid(() => planEventCommand(undefined, { clear: true }), /--clear needs --events/);
    assertInvalid(
      () => planEventCommand('Fetch.enable', { events: true }),
      /--events and a method cannot be combined/
    );
    assertInvalid(
      () => planEventCommand(undefined, { events: true, clear: true, out: 'x.ndjson' }),
      /--clear and --out cannot be combined/
    );
  });
});

void describe('notes on event-based methods', () => {
  void it('Fetch.enable says requests pause and how to read and release them', () => {
    const result = cdpCallResult('Fetch.enable', {});
    assert.match(result.hint ?? '', /pause until continued/);
    assert.match(result.hint ?? '', /--listen Fetch\.requestPaused/);
    assert.match(result.hint ?? '', /Fetch\.disable/);
  });

  void it('Tracing.start and an empty Tracing.end point to --collect', () => {
    assert.match(cdpCallResult('Tracing.start', {}).hint ?? '', /--collect Tracing\.dataCollected/);
    assert.match(cdpCallResult('Tracing.end', {}).hint ?? '', /--collect Tracing\.dataCollected/);
  });
});
