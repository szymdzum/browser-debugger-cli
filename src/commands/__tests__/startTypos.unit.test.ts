/**
 * Words that are commands of a group, typed without the group.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { assertNotMistypedCommand } from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { invalidSelectorError } from '@/errors/messages.js';

/**
 * A program with a `dom` group and a top-level `status` command.
 *
 * @returns Root command
 */
function program(): Command {
  const root = new Command();
  root.command('dom').command('query');
  root.command('status');
  root.command('network').command('list');
  root.option('--session <name>');
  return root;
}

void describe('assertNotMistypedCommand', () => {
  void it('names the full command for a subcommand typed alone', () => {
    assert.throws(
      () => assertNotMistypedCommand(program(), ['node', 'bdg', 'query', '.item']),
      (error) =>
        error instanceof CommandError && /bdg dom query/.test(String(error.metadata.suggestion))
    );
  });

  void it('suggests the command for a mistyped one followed by more words', () => {
    for (const argv of [
      ['netwrk', 'list'],
      ['--session', 'a', 'netwrk', 'list', '--json'],
    ]) {
      assert.throws(
        () => assertNotMistypedCommand(program(), ['node', 'bdg', ...argv]),
        (error) =>
          error instanceof CommandError &&
          error.message === 'Unknown command: "netwrk"' &&
          error.metadata.suggestion === 'Did you mean: bdg network?'
      );
    }
  });

  void it('skips option values, and leaves a single word to the start command', () => {
    assert.doesNotThrow(() =>
      assertNotMistypedCommand(program(), ['node', 'bdg', '--session', 'dim', 'example.com'])
    );
    assert.doesNotThrow(() => assertNotMistypedCommand(program(), ['node', 'bdg', 'netwrk']));
    assert.doesNotThrow(() =>
      assertNotMistypedCommand(program(), ['node', 'bdg', 'zzzzzzzz', 'list'])
    );
  });

  void it('leaves URLs and top-level commands alone', () => {
    assert.doesNotThrow(() =>
      assertNotMistypedCommand(program(), ['node', 'bdg', 'https://example.com'])
    );
    assert.doesNotThrow(() => assertNotMistypedCommand(program(), ['node', 'bdg', 'status']));
  });
});

void describe('invalidSelectorError', () => {
  void it('names the supported filters for other Playwright syntax', () => {
    assert.match(invalidSelectorError('button:text("Save")').suggestion, /:has-text\("…"\)/);
    assert.match(invalidSelectorError('form >> button').suggestion, /a11y query/);
    assert.match(invalidSelectorError('button[').suggestion, /Check the selector syntax/);
  });
});
