/**
 * Machine-readable help generation using Commander.js introspection API.
 */

import type { Command, Option, Argument } from 'commander';

import { filterDefined } from '@/utils/objects.js';

/**
 * Option metadata for machine-readable help.
 */
export interface OptionMetadata {
  /** Option flags (e.g., "-j, --json") */
  flags: string;
  /** Option description */
  description: string;
  /** Whether option is required */
  required: boolean;
  /** Whether option has an optional value */
  optional: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** Description of default value */
  defaultValueDescription?: string;
  /** Allowed choices if restricted */
  choices?: readonly string[];
}

/**
 * Argument metadata for machine-readable help.
 */
export interface ArgumentMetadata {
  /** Argument name */
  name: string;
  /** Argument description */
  description: string;
  /** Whether argument is required */
  required: boolean;
  /** Whether argument accepts multiple values */
  variadic: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** Allowed choices if restricted */
  choices?: readonly string[];
}

/**
 * Command metadata for machine-readable help.
 */
export interface CommandMetadata {
  /** Command name */
  name: string;
  /** Command aliases */
  aliases: readonly string[];
  /** Command description */
  description: string;
  /** Command usage string */
  usage: string;
  /** Command arguments */
  arguments: ArgumentMetadata[];
  /** Command options */
  options: OptionMetadata[];
  /** Subcommands */
  subcommands: CommandMetadata[];
}

/**
 * Root machine-readable help structure.
 */
export interface MachineReadableHelp {
  /** CLI name */
  name: string;
  /** CLI version */
  version: string;
  /** CLI description */
  description: string;
  /** Root command metadata */
  command: CommandMetadata;
  /** Exit code documentation */
  exitCodes: {
    /** Exit code value */
    code: number;
    /** Exit code name */
    name: string;
    /** Exit code description */
    description: string;
  }[];
}

/**
 * Converts a Commander Option to OptionMetadata.
 *
 * @param option - Commander option instance
 * @returns Option metadata
 */
function convertOption(option: Option): OptionMetadata {
  return filterDefined({
    flags: option.flags,
    description: option.description,
    required: option.required,
    optional: option.optional,
    defaultValue: option.defaultValue as unknown,
    defaultValueDescription: option.defaultValueDescription,
    choices: option.argChoices,
  }) as unknown as OptionMetadata;
}

/**
 * Converts a Commander Argument to ArgumentMetadata.
 *
 * @param argument - Commander argument instance
 * @returns Argument metadata
 */
function convertArgument(argument: Argument): ArgumentMetadata {
  return filterDefined({
    name: argument.name(),
    description: argument.description,
    required: argument.required,
    variadic: argument.variadic,
    defaultValue: argument.defaultValue as unknown,
    choices: argument.argChoices,
  }) as unknown as ArgumentMetadata;
}

/**
 * Recursively converts a Commander Command to CommandMetadata.
 *
 * @param command - Commander command instance
 * @returns Command metadata
 */
function convertCommand(command: Command): CommandMetadata {
  return {
    name: command.name(),
    aliases: command.aliases(),
    description: command.description(),
    usage: command.usage(),
    arguments: command.registeredArguments.map(convertArgument),
    options: command.options.map(convertOption),
    subcommands: command.commands.map(convertCommand),
  };
}

/**
 * Generates machine-readable help from a Commander program.
 *
 * @param program - Commander program instance
 * @returns Machine-readable help structure
 *
 * @example
 * ```typescript
 * import { program } from 'commander';
 * import { generateMachineReadableHelp } from './help/machineReadableHelp.js';
 *
 * const help = generateMachineReadableHelp(program);
 * console.log(JSON.stringify(help, null, 2));
 * ```
 */
export function generateMachineReadableHelp(program: Command): MachineReadableHelp {
  return {
    name: program.name(),
    version: program.version() ?? 'unknown',
    description: program.description(),
    command: convertCommand(program),
    exitCodes: [
      { code: 0, name: 'SUCCESS', description: 'Operation completed successfully' },
      { code: 1, name: 'GENERIC_FAILURE', description: 'Generic failure' },
      {
        code: 80,
        name: 'INVALID_URL',
        description: 'Invalid URL format provided',
      },
      {
        code: 81,
        name: 'INVALID_ARGUMENTS',
        description: 'Invalid command arguments',
      },
      {
        code: 82,
        name: 'PERMISSION_DENIED',
        description: 'Insufficient permissions',
      },
      {
        code: 83,
        name: 'RESOURCE_NOT_FOUND',
        description: 'Required resource not found',
      },
      {
        code: 84,
        name: 'RESOURCE_BUSY',
        description: 'Resource is currently in use',
      },
      {
        code: 85,
        name: 'OPERATION_NOT_PERMITTED',
        description: 'Operation not permitted in current state',
      },
      {
        code: 86,
        name: 'DAEMON_ALREADY_RUNNING',
        description: 'Daemon is already running',
      },
      {
        code: 100,
        name: 'CHROME_LAUNCH_FAILURE',
        description: 'Failed to launch Chrome browser',
      },
      {
        code: 101,
        name: 'CDP_CONNECTION_FAILURE',
        description: 'Failed to connect to Chrome DevTools Protocol',
      },
      {
        code: 102,
        name: 'CDP_TIMEOUT',
        description: 'CDP operation timed out',
      },
      {
        code: 110,
        name: 'IPC_ERROR',
        description: 'Inter-process communication error',
      },
    ],
  };
}
