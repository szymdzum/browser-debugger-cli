/**
 * `bdg state save <file>` and `bdg state load <file>`: browser auth state
 * (cookies, localStorage, sessionStorage) to and from a JSON file, so a
 * login survives `bdg stop` and moves to another session. Output shows
 * counts and origins, never values.
 */

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { readStateFile, writeStateFile } from '@/commands/shared/stateFile.js';
import { CommandError } from '@/errors/index.js';
import { stateLoad, stateSave } from '@/ipc/client.js';
import type { StateLoadData, StateSummary } from '@/ipc/protocol/stateTypes.js';
import {
  STATE_DESCRIPTION,
  STATE_FILE_WARNING,
  STATE_LOAD_DESCRIPTION,
  STATE_SAVE_DESCRIPTION,
  invalidStateOriginError,
  stateLoadedMessage,
  stateSavedMessage,
} from '@/ui/messages/stateMessages.js';
import { httpOrigin, summarizeState } from '@/utils/authStateFormat.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options of `bdg state save` */
interface StateSaveOptions extends BaseOptions {
  /** `--origin`, repeatable */
  origin?: string[];
}

/** Options of `bdg state load` */
interface StateLoadOptions extends BaseOptions {
  /** False with `--no-reload` */
  reload: boolean;
}

/** What `bdg state save` reports */
interface StateSaveResult extends StateSummary {
  /** Absolute path written */
  file: string;
}

/** A daemon answer as the state commands read it */
interface StateResponse<T> {
  status: string;
  data?: T | undefined;
  error?: string | undefined;
  exitCode?: number | undefined;
  suggestion?: string | undefined;
}

/**
 * A failed daemon answer as a command result.
 *
 * @param response - Answer with status error (or without data)
 * @param failure - Message when the daemon gave none
 * @returns Failed result
 */
function failed<T>(response: StateResponse<unknown>, failure: string): CommandResult<T> {
  return {
    success: false,
    error: response.error ?? failure,
    exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
    ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
  };
}

/**
 * Collect repeated `--origin` values.
 *
 * @param value - This value
 * @param previous - Values so far
 * @returns All values
 */
function collectOrigin(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * The origins of `--origin` values.
 *
 * @param values - URLs or origins
 * @returns Origins
 * @throws CommandError (81) for a value that is not an http(s) URL
 */
function parseOrigins(values: string[]): string[] {
  return values.map((value) => {
    const origin = httpOrigin(value);
    if (origin !== undefined) return origin;
    const err = invalidStateOriginError(value);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  });
}

/**
 * Save the session's state to a file.
 *
 * @param file - Path given
 * @param options - Command options
 * @returns Where it was written and what it holds (counts)
 */
async function saveState(
  file: string,
  options: StateSaveOptions
): Promise<CommandResult<StateSaveResult>> {
  const origins = parseOrigins(options.origin ?? []);
  const response = await stateSave(origins.length ? { origins } : {});
  if (response.status === 'error' || !response.data) {
    return failed(response, 'Failed to read the browser state');
  }
  const { state, skipped } = response.data;
  const written = await writeStateFile(file, state);
  return { success: true, data: { file: written, ...summarizeState(state, skipped) } };
}

/**
 * Restore a state file into the session.
 *
 * @param file - Path given
 * @param options - Command options
 * @returns What was restored (counts) and the page after the reload
 */
async function loadState(
  file: string,
  options: StateLoadOptions
): Promise<CommandResult<StateLoadData>> {
  const state = readStateFile(file);
  const response = await stateLoad({ state, reload: options.reload });
  if (response.status === 'error' || !response.data) {
    return failed(response, 'Failed to load the browser state');
  }
  return { success: true, data: response.data };
}

/**
 * Register the `state` command group.
 *
 * @param program - Root command
 */
export function registerStateCommands(program: Command): void {
  const state = program
    .command('state')
    .description(STATE_DESCRIPTION)
    .addHelpText('after', `\n${STATE_FILE_WARNING}.`);

  state
    .command('save')
    .description(STATE_SAVE_DESCRIPTION)
    .argument('<file>', 'JSON file to write (created 0600)')
    .option(
      '--origin <url>',
      'Save the storage of this origin (repeatable; default: every origin of the page and its same-site frames)',
      collectOrigin
    )
    .addOption(jsonOption())
    .addHelpText('after', `\n${STATE_FILE_WARNING}.`)
    .action(async (file: string, options: StateSaveOptions) => {
      await runCommand(
        () => saveState(file, options),
        options,
        (data) => stateSavedMessage(data.file, data)
      );
    });

  state
    .command('load')
    .description(STATE_LOAD_DESCRIPTION)
    .argument('<file>', 'JSON file written by bdg state save')
    .option('--no-reload', 'Restore without reloading the page')
    .addOption(jsonOption())
    .addHelpText('after', `\n${STATE_FILE_WARNING}.`)
    .action(async (file: string, options: StateLoadOptions) => {
      await runCommand(() => loadState(file, options), options, stateLoadedMessage);
    });
}
