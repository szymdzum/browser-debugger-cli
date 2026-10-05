/**
 * Options that only apply to a launched Chrome, given with `--chrome-ws-url`
 * (#321): `--headless` counts only when given on the command line.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import {
  applyCollectorOptions,
  launchOptionConflicts,
  type CollectorOptions,
} from '@/commands/start.js';

/**
 * Parse start arguments with the real start options.
 *
 * @param args - Arguments after the URL
 * @returns Conflicting flags
 */
function conflicts(args: string[]): string[] {
  const program = applyCollectorOptions(new Command().argument('[url]')).action(() => {});
  program.exitOverride().parse(['node', 'bdg', 'http://a/', ...args]);
  return launchOptionConflicts(program.opts<CollectorOptions>(), program);
}

void describe('launchOptionConflicts', () => {
  void it('ignores the default of --headless', () => {
    assert.deepEqual(conflicts(['--chrome-ws-url', '9222']), []);
  });

  void it('reports --headless and --no-headless given explicitly', () => {
    assert.deepEqual(conflicts(['--chrome-ws-url', '9222', '--headless']), ['--headless']);
    assert.deepEqual(conflicts(['--chrome-ws-url', '9222', '--no-headless']), ['--no-headless']);
  });

  void it('reports --port and -u', () => {
    assert.deepEqual(conflicts(['--chrome-ws-url', '9222', '--port', '9700', '-u', '/tmp/p']), [
      '--port',
      '--user-data-dir',
    ]);
  });
});
