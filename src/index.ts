#!/usr/bin/env node

import { Command } from 'commander';

import { generateMachineReadableHelp, generateSubcommandHelp } from '@/commands/helpJson.js';
import { commandRegistry } from '@/commands.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { enableDebugLogging } from '@/ui/logging/index.js';
import { getErrorExitCode, getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

const CLI_NAME = 'bdg';
const CLI_DESCRIPTION = 'Browser telemetry via Chrome DevTools Protocol';

/**
 * Extract command path from argv for subcommand help routing.
 *
 * Parses argv to find command names before --help flag.
 * Stops at first flag (starts with -) or --help.
 *
 * @param argv - Process arguments array
 * @returns Array of command names (e.g., ['dom', 'query'])
 *
 * @example
 * ```typescript
 * extractCommandPath(['node', 'bdg', 'dom', 'query', '--help', '--json'])
 * // Returns: ['dom', 'query']
 *
 * extractCommandPath(['node', 'bdg', '--help', '--json'])
 * // Returns: []
 * ```
 */
function extractCommandPath(argv: string[]): string[] {
  const commandPath: string[] = [];
  const args = argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith('-')) {
      break;
    }
    commandPath.push(arg);
  }

  return commandPath;
}

/**
 * Main entry point.
 *
 * Registers commands and dispatches. Only `bdg <url>` spawns the daemon (see
 * the start command); every other command talks to an existing daemon and
 * reports "no active session" when there is none.
 */
async function main(): Promise<void> {
  if (process.argv.includes('--debug')) {
    enableDebugLogging();
  }

  const program = new Command()
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose output)');

  commandRegistry.forEach((register) => register(program));

  if (process.argv.includes('--help') && process.argv.includes('--json')) {
    const commandPath = extractCommandPath(process.argv);
    const help =
      commandPath.length > 0
        ? generateSubcommandHelp(program, commandPath)
        : generateMachineReadableHelp(program);
    console.log(JSON.stringify(help, null, 2));
    process.exit(0);
  }

  await program.parseAsync();
}

/**
 * Last-resort handler for errors that escaped command handlers.
 *
 * Prints one clean message (or a JSON envelope with `--json`) instead of a
 * raw stack trace, and exits with the error's semantic code when it has one.
 *
 * @param error - Unhandled error
 */
function handleFatalError(error: unknown): never {
  const exitCode = getErrorExitCode(error, EXIT_CODES.UNHANDLED_EXCEPTION);
  const message = getErrorMessage(error);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(message, { exitCode }), null, 2));
  } else {
    console.error(genericError(message));
  }
  process.exit(exitCode);
}

main().catch(handleFatalError);
