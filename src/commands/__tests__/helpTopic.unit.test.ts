/**
 * `bdg help <topic>` validation and Commander hint splitting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command, CommanderError, Option } from 'commander';

import {
  assertKnownHelpTopic,
  helpTopicPath,
  splitCommanderHint,
  usageErrorDetails,
} from '@/commands/helpTopic.js';
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

/**
 * `bdg peek` with `--last <n>`, `--json` and a hidden `--session <name>`.
 *
 * @returns The peek command
 */
function peek(): Command {
  const root = new Command('bdg');
  return root
    .command('peek')
    .option('--last <n>')
    .option('-j, --json')
    .addOption(new Option('--session <name>').hideHelp());
}

/**
 * A Commander error as the parser throws it.
 *
 * @param code - Commander error code
 * @param message - Commander message
 * @returns The error
 */
function commanderError(code: string, message: string): CommanderError {
  return new CommanderError(81, code, message);
}

void describe('usageErrorDetails', () => {
  void it('suggests the closest option of the command, hidden ones included', () => {
    for (const [typed, closest] of [
      ['--lsat', '--last'],
      ['--sesion', '--session'],
      ['--sesion=a', '--session'],
    ]) {
      const error = commanderError(
        'commander.unknownOption',
        `error: unknown option '${typed}'\n(Did you mean --json?)`
      );
      assert.deepEqual(usageErrorDetails(error, peek()), {
        message: `unknown option '${typed}'`,
        suggestion: `Did you mean: ${closest}?`,
      });
    }
  });

  void it('names a word typed after one dash as typed, and matches it to the long options', () => {
    const error = commanderError('commander.unknownOption', "error: unknown option '-osn'");
    assert.deepEqual(usageErrorDetails(error, peek(), ['node', 'bdg', 'peek', '-josn']), {
      message: "unknown option '-josn'",
      suggestion: 'Did you mean: --json?',
    });
  });

  void it('points to the command help without a close option', () => {
    const error = commanderError('commander.unknownOption', "error: unknown option '--frob'");
    assert.equal(usageErrorDetails(error, peek()).suggestion, 'Run "bdg peek --help" for usage');
  });

  void it("keeps Commander's hint, else points to the help, for other errors", () => {
    const missing = commanderError(
      'commander.missingArgument',
      "error: missing required argument 'selector'"
    );
    assert.deepEqual(usageErrorDetails(missing, peek()), {
      message: "missing required argument 'selector'",
      suggestion: 'Run "bdg peek --help" for usage',
    });
    const unknown = commanderError(
      'commander.unknownCommand',
      "error: unknown command 'quer'\n(Did you mean query?)"
    );
    assert.equal(usageErrorDetails(unknown, peek()).suggestion, 'Did you mean: query?');
  });

  void it('reports a group run without a subcommand', () => {
    const error = commanderError('commander.help', '(outputHelp)');
    assert.deepEqual(usageErrorDetails(error, peek()), {
      message: 'Missing subcommand',
      suggestion: 'Run "bdg peek --help" for usage',
    });
  });
});
