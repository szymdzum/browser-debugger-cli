/**
 * Machine-readable help generation using Commander.js introspection API.
 */

import type { Command, Option, Argument } from 'commander';

import { getAllDomainSummaries } from '@/cdp/schema.js';
import { isDaemonRunning } from '@/daemon/launcher.js';
import { readPid } from '@/session/pid.js';
import { getAllDecisionTrees, type DecisionTree } from '@/utils/decisionTrees.js';
import { filterDefined } from '@/utils/objects.js';
import { isProcessAlive } from '@/utils/process.js';
import { getAllTaskMappings, type TaskMapping } from '@/utils/taskMappings.js';

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
 * Runtime state information for dynamic command availability.
 */
export interface RuntimeState {
  /** Whether a session is currently active */
  sessionActive: boolean;
  /** Whether the daemon is running */
  daemonRunning: boolean;
  /** Commands available in current state */
  availableCommands: string[];
}

/**
 * Tool capabilities summary for agent discovery.
 */
export interface Capabilities {
  /** CDP protocol capabilities */
  cdp: {
    /** Number of CDP domains */
    domains: number;
    /** Number of CDP methods (approximate) */
    methods: string;
  };
  /** High-level command capabilities */
  highLevel: {
    /** Number of high-level commands */
    commands: number;
    /** Domain coverage areas */
    coverage: string[];
  };
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
  /** Task-to-command mappings with CDP alternatives */
  taskMappings: Record<string, TaskMapping>;
  /** Current runtime state */
  runtimeState: RuntimeState;
  /** Intent-based decision trees */
  decisionTrees: Record<string, DecisionTree>;
  /** Tool capabilities summary */
  capabilities: Capabilities;
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
 * Checks if a session is currently active.
 *
 * @returns True if session is active, false otherwise
 */
function isSessionActive(): boolean {
  const sessionPid = readPid();
  if (sessionPid === null) {
    return false;
  }
  return isProcessAlive(sessionPid);
}

/**
 * Generates runtime state information.
 *
 * Checks current daemon and session status to provide state-aware
 * command availability information.
 *
 * @returns Runtime state object
 */
function generateRuntimeState(): RuntimeState {
  const daemonRunning = isDaemonRunning();
  const sessionActive = isSessionActive();

  const availableCommands: string[] = [];

  if (!daemonRunning && !sessionActive) {
    availableCommands.push('bdg <url>', 'cleanup', '--help', '--version');
  } else if (daemonRunning && sessionActive) {
    availableCommands.push(
      'peek',
      'tail',
      'details',
      'dom',
      'network',
      'console',
      'cdp',
      'status',
      'stop'
    );
  } else if (daemonRunning && !sessionActive) {
    availableCommands.push('bdg <url>', 'cleanup', 'status');
  }

  return {
    sessionActive,
    daemonRunning,
    availableCommands,
  };
}

/**
 * Generates capabilities summary.
 *
 * Dynamically calculates CDP and high-level command capabilities
 * from protocol schema and task mappings.
 *
 * @returns Capabilities object
 */
function generateCapabilities(): Capabilities {
  const domainSummaries = getAllDomainSummaries();
  const taskMappings = getAllTaskMappings();

  const totalMethods = domainSummaries.reduce((sum, domain) => sum + domain.commandCount, 0);

  return {
    cdp: {
      domains: domainSummaries.length,
      methods: totalMethods.toString(),
    },
    highLevel: {
      commands: Object.keys(taskMappings).length,
      coverage: ['dom', 'network', 'console', 'session', 'monitoring'],
    },
  };
}

/**
 * Generates machine-readable help from a Commander program.
 *
 * Includes comprehensive metadata for agent discovery:
 * - Command structure and options
 * - Exit codes with semantic meanings
 * - Task-to-command mappings with CDP alternatives
 * - Runtime state and command availability
 * - Intent-based decision trees
 * - Capabilities summary
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
    taskMappings: getAllTaskMappings(),
    runtimeState: generateRuntimeState(),
    decisionTrees: getAllDecisionTrees(),
    capabilities: generateCapabilities(),
  };
}
