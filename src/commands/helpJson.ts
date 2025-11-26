/**
 * Machine-readable help generation using Commander.js introspection API.
 */

import type { Command, Option, Argument } from 'commander';

import { getAllDomainSummaries } from '@/cdp/schema.js';
import { isDaemonRunning } from '@/daemon/launcher.js';
import { readPid } from '@/session/pid.js';
import { getAllDecisionTrees, type DecisionTree } from '@/utils/decisionTrees.js';
import { EXIT_CODE_REGISTRY } from '@/utils/exitCodes.js';
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
    /** List of high-level commands available */
    commands: string[];
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
 * Builds the metadata object directly with proper types,
 * only including optional fields when they have values.
 *
 * @param option - Commander option instance
 * @returns Option metadata
 */
function convertOption(option: Option): OptionMetadata {
  const metadata: OptionMetadata = {
    flags: option.flags,
    description: option.description,
    required: option.required,
    optional: option.optional,
  };

  if (option.defaultValue !== undefined) {
    metadata.defaultValue = option.defaultValue;
  }
  if (option.defaultValueDescription) {
    metadata.defaultValueDescription = option.defaultValueDescription;
  }
  if (option.argChoices) {
    metadata.choices = option.argChoices;
  }

  return metadata;
}

/**
 * Converts a Commander Argument to ArgumentMetadata.
 *
 * Builds the metadata object directly with proper types,
 * only including optional fields when they have values.
 *
 * @param argument - Commander argument instance
 * @returns Argument metadata
 */
function convertArgument(argument: Argument): ArgumentMetadata {
  const metadata: ArgumentMetadata = {
    name: argument.name(),
    description: argument.description,
    required: argument.required,
    variadic: argument.variadic,
  };

  if (argument.defaultValue !== undefined) {
    metadata.defaultValue = argument.defaultValue;
  }
  if (argument.argChoices) {
    metadata.choices = argument.argChoices;
  }

  return metadata;
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
 * Extracts unique command strings from task mappings.
 *
 * Flattens all command arrays from task mappings and deduplicates them.
 *
 * @param taskMappings - Task mapping registry
 * @returns Sorted array of unique command strings
 */
function extractCommandList(taskMappings: Record<string, TaskMapping>): string[] {
  const allCommands = Object.values(taskMappings).flatMap((mapping) => mapping.commands);
  const uniqueCommands = [...new Set(allCommands)];
  return uniqueCommands.sort();
}

/**
 * Exit code documentation derived from the central registry.
 *
 * Uses EXIT_CODE_REGISTRY as the single source of truth to prevent
 * documentation drift from actual exit code values.
 */
const EXIT_CODE_DOCS = EXIT_CODE_REGISTRY;

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
  const commandList = extractCommandList(taskMappings);

  return {
    cdp: {
      domains: domainSummaries.length,
      methods: totalMethods.toString(),
    },
    highLevel: {
      commands: commandList,
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
    exitCodes: [...EXIT_CODE_DOCS],
    taskMappings: getAllTaskMappings(),
    runtimeState: generateRuntimeState(),
    decisionTrees: getAllDecisionTrees(),
    capabilities: generateCapabilities(),
  };
}

/**
 * Finds a subcommand by traversing the command path.
 *
 * @param program - Root Commander program instance
 * @param commandPath - Array of command names to traverse (e.g., ['dom', 'query'])
 * @returns The target Command if found, null otherwise
 */
function findSubcommand(program: Command, commandPath: string[]): Command | null {
  let current: Command = program;

  for (const name of commandPath) {
    const found = current.commands.find(
      (cmd) => cmd.name() === name || cmd.aliases().includes(name)
    );
    if (!found) {
      return null;
    }
    current = found;
  }

  return current;
}

/**
 * Generates machine-readable help for a specific subcommand.
 *
 * Returns the same structure as generateMachineReadableHelp but with
 * the command field focused on the requested subcommand. If the subcommand
 * is not found, falls back to full root help.
 *
 * @param program - Root Commander program instance
 * @param commandPath - Array of command names (e.g., ['dom', 'query'])
 * @returns Machine-readable help structure for the subcommand
 *
 * @example
 * ```typescript
 * // Get help for 'bdg dom query'
 * const help = generateSubcommandHelp(program, ['dom', 'query']);
 * console.log(help.command.name); // 'query'
 * ```
 */
export function generateSubcommandHelp(
  program: Command,
  commandPath: string[]
): MachineReadableHelp {
  const targetCommand = findSubcommand(program, commandPath);

  if (!targetCommand) {
    return generateMachineReadableHelp(program);
  }

  return {
    name: program.name(),
    version: program.version() ?? 'unknown',
    description: program.description(),
    command: convertCommand(targetCommand),
    exitCodes: [...EXIT_CODE_DOCS],
    taskMappings: getAllTaskMappings(),
    runtimeState: generateRuntimeState(),
    decisionTrees: getAllDecisionTrees(),
    capabilities: generateCapabilities(),
  };
}
