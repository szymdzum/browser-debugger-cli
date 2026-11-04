/**
 * `dom fill` judges a value the page rewrites while the fill runs as the
 * late read does (#901), smoke test.
 *
 * On `/fill-immediate-format` the page formats, replaces or restores the
 * value synchronously. Formatting (a postcode upper-cased on blur, a phone
 * mask on input) keeps the input: the fill succeeds with `Page shows:` /
 * `data.pageValue`. A value replaced with unrelated text fails with exit 90
 * and the replaced message; a return to the old value fails with exit 90 as
 * before (#866, #867).
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

/** Exit code of a fill whose value the page did not keep (RESOURCE_CONFLICT) */
const MISMATCH_EXIT = 90;

/** What the tests read of the `--json` envelope of `dom fill` */
interface FillEnvelope {
  success: boolean;
  error?: string;
  suggestion?: string;
  valueMismatch?: Record<string, unknown>;
  data?: { value?: string; pageValue?: string; valueMismatch?: unknown };
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  const start = await runCommand(
    `${fixture.url}fill-immediate-format`,
    ['--port', String(port), '--headless'],
    { timeout: 60000 }
  );
  assert.equal(start.exitCode, 0, `${start.stdout}${start.stderr}`);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill: synchronous formatting passes, a synchronous replace or restore fails (#901)', () => {
  void it('a postcode upper-cased on blur succeeds, showing what the page shows', async () => {
    const result = await runCommand('dom', ['fill', '#post', 'sw1a 1aa'], { timeout: 60000 });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.exitCode, 0, output);
    assert.match(result.stdout, /^Page shows: +SW1A 1AA$/m, output);
  });

  void it('a phone mask on input succeeds with data.pageValue', async () => {
    const result = await runCommand('dom', ['fill', '#ph', '5551234567', '--json'], {
      timeout: 60000,
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.exitCode, 0, output);
    const envelope = JSON.parse(result.stdout) as FillEnvelope;
    assert.equal(envelope.data?.valueMismatch, undefined, output);
    assert.equal(envelope.data?.pageValue, '(555) 123-4567', output);
  });

  void it('a value replaced with unrelated text fails with 90 and the replaced message', async () => {
    const result = await runCommand('dom', ['fill', '#note', 'leave at the door', '--json'], {
      timeout: 60000,
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.exitCode, MISMATCH_EXIT, output);
    const envelope = JSON.parse(result.stdout) as FillEnvelope;
    assert.match(
      envelope.error ?? '',
      /^Fill '#note' \(input#note "Delivery note"\): the page replaced the value within 2 s of filling: the field's value is "draft-[0-9a-f]{6}" \(expected "leave at the door"\); it did not keep the input/,
      output
    );
    assert.match(envelope.suggestion ?? '', /report that the fill was rejected/, output);
    assert.deepEqual(
      Object.keys(envelope.valueMismatch ?? {}).sort(),
      ['actual', 'expected'],
      output
    );
  });

  void it('a return to the old value fails with 90 as before', async () => {
    const result = await runCommand('dom', ['fill', '#city', 'Paris'], { timeout: 60000 });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.exitCode, MISMATCH_EXIT, output);
    assert.match(
      result.stderr,
      /^(Error: )?Fill '#city' \(input#city "City"\): the field's value is "Berlin" after filling \(expected "Paris"\)/m,
      output
    );
  });
});
