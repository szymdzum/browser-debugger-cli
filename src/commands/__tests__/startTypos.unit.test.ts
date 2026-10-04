/**
 * Words that are commands of a group, typed without the group.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { assertNotGroupSubcommand } from '@/commands/start.js';
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
  return root;
}

void describe('assertNotGroupSubcommand', () => {
  void it('names the full command for a subcommand typed alone', () => {
    assert.throws(
      () => assertNotGroupSubcommand(program(), ['node', 'bdg', 'query', '.item']),
      (error) =>
        error instanceof CommandError && /bdg dom query/.test(String(error.metadata.suggestion))
    );
  });

  void it('leaves URLs and top-level commands alone', () => {
    assert.doesNotThrow(() =>
      assertNotGroupSubcommand(program(), ['node', 'bdg', 'https://example.com'])
    );
    assert.doesNotThrow(() => assertNotGroupSubcommand(program(), ['node', 'bdg', 'status']));
  });
});

void describe('invalidSelectorError', () => {
  void it('points Playwright text selectors to an a11y name query', () => {
    assert.match(
      invalidSelectorError('button:has-text("Save")').suggestion,
      /bdg dom a11y query name="Save"/
    );
    assert.match(invalidSelectorError(`a:has-text("it's here")`).suggestion, /name="it's here"/);
    assert.match(invalidSelectorError('li:visible').suggestion, /:visible is not CSS/);
  });
});
