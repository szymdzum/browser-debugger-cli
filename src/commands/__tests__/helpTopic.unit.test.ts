/**
 * `bdg help <topic>` validation and Commander hint splitting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { assertKnownHelpTopic, helpTopicPath, splitCommanderHint } from '@/commands/helpTopic.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * A small command tree: `peek`, `dom query`, `dom a11y tree`.
 *
 * @returns Root command
 */
function program(): Command {
  const root = new Command('bdg');
  root.command('peek');
  const dom = root.command('dom');
  dom.command('query').argument('<selector>');
  dom.command('a11y').command('tree');
  return root;
}

/**
 * The error thrown for a help topic.
 *
 * @param topic - Command path
 * @returns The CommandError
 */
function errorFor(topic: string[]): CommandError {
  try {
    assertKnownHelpTopic(program(), topic);
  } catch (error) {
    assert.ok(error instanceof CommandError);
    return error;
  }
  assert.fail(`expected "${topic.join(' ')}" to be rejected`);
}

void describe('assertKnownHelpTopic', () => {
  void it('accepts existing commands, their arguments and `help`', () => {
    for (const topic of [[], ['peek'], ['dom', 'a11y', 'tree'], ['dom', 'query', 'h1'], ['help']]) {
      assert.doesNotThrow(() => assertKnownHelpTopic(program(), topic));
    }
  });

  void it('rejects an unknown top-level command with a did-you-mean (81)', () => {
    const error = errorFor(['peak']);
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.equal(error.message, 'Unknown command: "peak"');
    assert.equal(error.metadata.suggestion, 'Did you mean: bdg help peek?');
  });

  void it('names the full path of an unknown subcommand', () => {
    const error = errorFor(['dom', 'a11y', 'tre']);
    assert.equal(error.message, 'Unknown command: "dom a11y tre"');
    assert.equal(error.metadata.suggestion, 'Did you mean: bdg help dom a11y tree?');
  });

  void it('points to the parent help without a close match', () => {
    assert.equal(
      errorFor(['dom', 'zzzzzz']).metadata.suggestion,
      'Run "bdg dom --help" for commands'
    );
  });
});

void describe('helpTopicPath', () => {
  void it('stops at the first option', () => {
    assert.deepEqual(helpTopicPath(['dom', 'query', '--json', 'x']), ['dom', 'query']);
  });
});

void describe('splitCommanderHint', () => {
  void it('moves "(Did you mean …?)" into the suggestion', () => {
    assert.deepEqual(splitCommanderHint("error: unknown option '--lsat'\n(Did you mean --last?)"), {
      message: "unknown option '--lsat'",
      suggestion: 'Did you mean: --last?',
    });
  });

  void it('leaves other messages alone', () => {
    assert.deepEqual(splitCommanderHint("error: unknown option '--zzz'"), {
      message: "unknown option '--zzz'",
    });
  });
});
