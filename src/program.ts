/**
 * The bdg command tree: root command, its options and every registered command.
 */

import { Command, Option, type OutputConfiguration } from 'commander';

import { commandRegistry } from '@/commands.js';
import { VERSION } from '@/utils/version.js';

const CLI_NAME = 'bdg';
const CLI_DESCRIPTION = 'Browser telemetry via Chrome DevTools Protocol';
const SESSION_OPTION_FLAGS = '--session <name>';
const SESSION_OPTION_DESCRIPTION =
  'Use a named session (own daemon, Chrome and port) instead of the default one; env: BDG_SESSION';

/**
 * Make `--debug`, `-q` and `--session` accepted after any subcommand (program
 * options are positional).
 *
 * @param command - Command whose subcommands get the hidden global options
 */
function addGlobalOptions(command: Command): void {
  for (const sub of command.commands) {
    if (!sub.options.some((option) => option.long === '--debug')) {
      sub.addOption(new Option('--debug', 'Enable debug logging').hideHelp());
    }
    if (!sub.options.some((option) => option.long === '--quiet')) {
      sub.addOption(new Option('-q, --quiet', 'Hide tips and hints').hideHelp());
    }
    if (!sub.options.some((option) => option.long === '--session')) {
      sub.addOption(new Option(SESSION_OPTION_FLAGS, SESSION_OPTION_DESCRIPTION).hideHelp());
    }
    addGlobalOptions(sub);
  }
}

/**
 * Build the bdg program with every command registered, without parsing
 * anything. Commander errors throw instead of exiting; the output
 * configuration is set before commands are registered so they inherit it.
 *
 * @param output - Where Commander writes help and errors
 * @returns Root command
 */
export function buildProgram(output: OutputConfiguration = {}): Command {
  const program = new Command()
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose output)')
    .option(SESSION_OPTION_FLAGS, SESSION_OPTION_DESCRIPTION)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput(output);

  commandRegistry.forEach((register) => register(program));
  addGlobalOptions(program);
  return program;
}
