/**
 * Compact root help, per-command help and command resolution of `--help --json`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command, Option } from 'commander';

import {
  commandPath,
  generateCommandHelp,
  generateCompactHelp,
  resolveCommand,
} from '@/commands/helpJson.js';

/**
 * A small command tree: `peek`, `dom query <selector> [index]` with an
 * after-help text and a hidden option, `dom a11y tree`.
 *
 * @returns Root command
 */
function program(): Command {
  const root = new Command('bdg').version('0.0.0-test').description('Test CLI');
  root.command('peek').description('Preview data\nSecond line');
  const dom = root.command('dom').description('DOM');
  dom
    .command('query')
    .description('Find elements')
    .argument('<selector>', 'CSS selector')
    .argument('[index]', 'Match index')
    .option('--limit <n>', 'Matches to list')
    .addOption(new Option('--session <name>', 'Named session').hideHelp())
    .addHelpText('after', '\nExamples:\n  bdg dom query h1');
  dom.command('a11y').command('tree');
  return root;
}

void describe('generateCompactHelp', () => {
  const help = generateCompactHelp(program());
  const dom = help.command.subcommands?.find((c) => c.name === 'dom');
  const query = dom?.subcommands?.find((c) => c.name === 'query');

  void it('keeps the first description line, arguments and visible flags', () => {
    const peek = help.command.subcommands?.find((c) => c.name === 'peek');
    assert.equal(peek?.description, 'Preview data');
    assert.deepEqual(query, {
      name: 'query',
      description: 'Find elements',
      arguments: '<selector> [index]',
      options: { '--limit <n>': 'Matches to list' },
    });
  });

  void it('prefers the summary over the first description line', () => {
    const root = new Command('bdg');
    root.command('cdp').summary('CDP execution').description('Long text\n  Discovery: --list');
    assert.equal(generateCompactHelp(root).command.subcommands?.[0]?.description, 'CDP execution');
  });

  void it('keeps exit codes and says where the details are', () => {
    assert.ok(help.exitCodes.length > 0);
    assert.match(help.details, /bdg <command> --help --json/);
  });
});

void describe('generateCommandHelp', () => {
  void it('has the full command with its help text and compact subcommands', () => {
    const root = program();
    const help = generateCommandHelp(root, resolveCommand(root, ['dom', 'query']));
    assert.equal(help.path, 'bdg dom query');
    assert.equal(help.command.helpText, 'Examples:\n  bdg dom query h1');
    assert.ok(help.command.options.some((option) => option.flags === '--session <name>'));
    assert.ok(help.exitCodes.length > 0);
    assert.ok(!('taskMappings' in help), 'root-only fields stay in the root help');

    const dom = generateCommandHelp(root, resolveCommand(root, ['dom']));
    assert.deepEqual(
      dom.command.subcommands.map((sub) => sub.name),
      ['query', 'a11y']
    );
  });
});

void describe('resolveCommand', () => {
  void it('follows command names, skips other words and stops at a leaf', () => {
    const root = program();
    assert.equal(commandPath(resolveCommand(root, ['dom', 'query', 'a11y'])), 'bdg dom query');
    assert.equal(
      commandPath(resolveCommand(root, ['a', 'dom', 'a11y', 'tree'])),
      'bdg dom a11y tree'
    );
    assert.equal(resolveCommand(root, ['https://example.com']), root);
  });
});
