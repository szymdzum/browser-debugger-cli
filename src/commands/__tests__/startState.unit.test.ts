/**
 * `bdg <url> --state` with `--chrome-ws-url` (#454): restoring before the
 * first load would walk the user's own tab through the saved origins, clear
 * its history and write into their profile, so it is refused (81) before
 * anything is attached, pointing at `bdg state load`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import {
  applyCollectorOptions,
  assertStateNotAttached,
  type CollectorOptions,
} from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Parse start arguments with the real start options.
 *
 * @param args - Arguments after the URL
 * @returns Parsed options
 */
function parse(args: string[]): CollectorOptions {
  const program = applyCollectorOptions(new Command().argument('[url]')).action(() => {});
  program.exitOverride().parse(['node', 'bdg', 'http://a/', ...args]);
  return program.opts<CollectorOptions>();
}

void describe('assertStateNotAttached', () => {
  void it('refuses --state with --chrome-ws-url (81), suggesting state load', () => {
    assert.throws(
      () => assertStateNotAttached(parse(['--chrome-ws-url', '9222', '--state', 's.json'])),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
        assert.match(error.message, /--state cannot be used with --chrome-ws-url/);
        assert.match(String(error.metadata.suggestion), /bdg state load s\.json/);
        assert.match(String(error.metadata.suggestion), /without --chrome-ws-url/);
        return true;
      }
    );
  });

  void it('allows either alone', () => {
    assertStateNotAttached(parse(['--state', 's.json']));
    assertStateNotAttached(parse(['--chrome-ws-url', '9222']));
  });
});
