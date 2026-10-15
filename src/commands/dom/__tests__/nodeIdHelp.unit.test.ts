/**
 * `dom query --help` and `dom get --help` say which id `nodeId` is and where it appears (#589).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { registerDomCommands } from '@/commands/dom/index.js';

/**
 * The help text of one `dom` subcommand.
 *
 * @param name - Subcommand name
 * @returns Its help, with the text added after the options
 */
function domHelp(name: string): string {
  const program = new Command();
  registerDomCommands(program);
  const sub = program.commands
    .find((cmd) => cmd.name() === 'dom')
    ?.commands.find((cmd) => cmd.name() === name);
  assert.ok(sub, `dom ${name} is registered`);
  let text = '';
  sub.configureOutput({ writeOut: (chunk) => (text += chunk) });
  sub.outputHelp();
  return text;
}

void describe('node id help', () => {
  void it('dom query --help says nodeId is a backend node id and how to use it with CDP', () => {
    const help = domHelp('query');
    assert.match(help, /backend node id/i);
    assert.match(help, /DOM\.resolveNode/);
  });

  void it('dom get --help names where --node-id values appear', () => {
    const help = domHelp('get').replace(/\s+/g, ' ');
    assert.match(help, /--node-id <id>[^]*--json[^]*backendDOMNodeId/);
    assert.doesNotMatch(help, /from dom query\/get --raw/);
  });
});
