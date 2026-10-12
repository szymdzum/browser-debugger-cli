/**
 * `bdg dom pressKey --help` states the `--times` range (#612).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { registerFormInteractionCommands } from '@/commands/dom/formInteraction.js';

void describe('dom pressKey --help', () => {
  const program = new Command();
  program.command('dom');
  registerFormInteractionCommands(program);
  const pressKey = program.commands
    .find((cmd) => cmd.name() === 'dom')
    ?.commands.find((cmd) => cmd.name() === 'pressKey');

  void it('shows the range --times accepts', () => {
    assert.ok(pressKey, 'pressKey is registered');
    assert.match(pressKey.helpInformation(), /--times <n>[^\n]*1-1000/);
  });
});
