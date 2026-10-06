/**
 * Machine-readable help generation using Commander.js introspection API.
 */

import type { EventEmitter } from 'node:events';

import type { Command, Option, Argument } from 'commander';

import { getAllDomainSummaries } from '@/cdp/schema.js';
import { getOptionBehavior } from '@/commands/optionBehaviors.js';
import { readLiveDaemonPid } from '@/session/cleanup/staleSession.js';
import { helpJsonDetailsNote } from '@/ui/messages/commands.js';
import { getAllDecisionTrees, type DecisionTree } from '@/utils/decisionTrees.js';
import { EXIT_CODE_REGISTRY } from '@/utils/exitCodes.js';
import { getAllTaskMappings, type TaskMapping } from '@/utils/taskMappings.js';

/**
 * Behavioral metadata for self-documenting options.
 *
 * Provides rich context for agents to understand option effects
 * without trial-and-error or source code inspection.
 */
export interface OptionBehavior {
  /** What happens by default when option is not specified */
  default?: string;
  /** What happens when option is enabled/specified */
  whenEnabled?: string;
  /** What happens when option is disabled (for --no-* flags) */
  whenDisabled?: string;
  /** Automatic behaviors that may override user intent */
  automaticBehavior?: string;
  /** Token cost implications for AI agents */
  tokenImpact?: string;
}

/**
 * Option metadata for machine-readable help.
 */
export interface OptionMetadata {
  /** Option flags (e.g., "-j, --json") */
  flags: string;
  /** Option description */
  description: string;
  /** Whether the option must be given (rare; most options are optional) */
  required: boolean;
  /** Whether the option takes a value (`--port <number>`) */
  takesValue: boolean;
  /** Whether the option's value may be omitted (`--flag [value]`) */
  optional: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** Description of default value */
  defaultValueDescription?: string;
  /** Allowed choices if restricted */
  choices?: readonly string[];
  /** Rich behavioral metadata for agent discovery */
  behavior?: OptionBehavior;
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
  /** Text shown after the options in `--help` (examples, output legend) */
  helpText?: string;
  /** Subcommands */
  subcommands: CommandMetadata[];
}

/**
 * Command summary for the compact root help: one-line description, arguments
 * and flags with their descriptions (behaviors, defaults and choices are in
 * `bdg <command> --help --json`).
 */
export interface CompactCommand {
  /** Command name */
  name: string;
  /** Command aliases (only when it has some) */
  aliases?: readonly string[];
  /** First line of the description */
  description: string;
  /** Arguments as in usage, e.g. "<selector> [index]" (only when it takes some) */
  arguments?: string;
  /** Visible options: flags to description */
  options?: Record<string, string>;
  /** Subcommands (only for command groups) */
  subcommands?: CompactCommand[];
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
 * Root machine-readable help structure (`bdg --help --json --full`).
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
 * Compact root help (`bdg --help --json`): the full help with a command tree
 * of names, one-line descriptions and flags.
 */
export interface CompactHelp extends Omit<MachineReadableHelp, 'command'> {
  /** Where the details are */
  details: string;
  /** Root command summary */
  command: CompactCommand;
}

/**
 * Help for one command (`bdg <command> --help --json`): its full metadata
 * (option behaviors, defaults, choices, help text), its subcommands in compact
 * form, and the exit codes.
 */
export interface CommandHelp extends Pick<
  MachineReadableHelp,
  'name' | 'version' | 'description' | 'exitCodes'
> {
  /** Full command path, e.g. "bdg dom query" */
  path: string;
  /** Command metadata; subcommands summarized (ask each for its details) */
  command: Omit<CommandMetadata, 'subcommands'> & { subcommands: CompactCommand[] };
}

/**
 * Converts a Commander Option to OptionMetadata.
 *
 * Builds the metadata object directly with proper types,
 * only including optional fields when they have values.
 * Enriches with behavioral metadata when available.
 *
 * @param option - Commander option instance
 * @param commandName - Name of the command containing this option
 * @returns Option metadata with behavioral context
 */
function convertOption(option: Option, commandName: string): OptionMetadata {
  const metadata: OptionMetadata = {
    flags: option.flags,
    description: option.description,
    required: option.mandatory,
    takesValue: option.required || option.optional,
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

  const behavior = getOptionBehavior(commandName, option.flags);
  if (behavior) {
    metadata.behavior = behavior;
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
 * The text a command adds after its options in `--help` (examples, output
 * legend), collected from its `afterHelp` listeners. Commander's Command is an
 * EventEmitter at runtime; its typings leave that out.
 *
 * @param command - Commander command instance
 * @returns The text, or undefined when the command adds none
 */
function afterHelpText(command: Command): string | undefined {
  const chunks: string[] = [];
  const emitter = command as unknown as EventEmitter;
  emitter.emit('afterHelp', { error: false, command, write: (text: string) => chunks.push(text) });
  const text = chunks.join('').trim();
  return text || undefined;
}

/**
 * Recursively converts a Commander Command to CommandMetadata.
 *
 * Passes command name to option converter for behavioral metadata lookup.
 *
 * @param command - Commander command instance
 * @returns Command metadata with enriched options
 */
function convertCommand(command: Command): CommandMetadata {
  const commandName = command.name();
  const helpText = afterHelpText(command);
  return {
    name: commandName,
    aliases: command.aliases(),
    description: command.description(),
    usage: command.usage(),
    arguments: command.registeredArguments.map(convertArgument),
    options: command.options.map((opt) => convertOption(opt, commandName)),
    ...(helpText && { helpText }),
    subcommands: command.commands.map(convertCommand),
  };
}

/**
 * An argument as written in usage: `<name>`, `[name]`, `<name...>`.
 *
 * @param argument - Commander argument instance
 * @returns Usage term
 */
function argumentTerm(argument: Argument): string {
  const name = `${argument.name()}${argument.variadic ? '...' : ''}`;
  return argument.required ? `<${name}>` : `[${name}]`;
}

/**
 * Recursively converts a Commander Command to its compact summary: first
 * description line, arguments, and visible options with their descriptions.
 * Empty fields are left out.
 *
 * @param command - Commander command instance
 * @returns Compact command summary
 */
function convertCompactCommand(command: Command): CompactCommand {
  const aliases = command.aliases();
  const args = command.registeredArguments.map(argumentTerm).join(' ');
  const options = command.options.filter((option) => !option.hidden);
  return {
    name: command.name(),
    ...(aliases.length > 0 && { aliases }),
    description: command.description().split('\n')[0] ?? '',
    ...(args && { arguments: args }),
    ...(options.length > 0 && {
      options: Object.fromEntries(options.map((option) => [option.flags, option.description])),
    }),
    ...(command.commands.length > 0 && {
      subcommands: command.commands.map(convertCompactCommand),
    }),
  };
}

/**
 * Generates runtime state information.
 *
 * The daemon hosts exactly one session, so a live daemon means an active
 * session. Uses daemon.pid verified by command line to keep help generation
 * synchronous; nothing is signalled based on this.
 *
 * @returns Runtime state object
 */
function generateRuntimeState(): RuntimeState {
  const sessionActive = readLiveDaemonPid() !== null;
  const availableCommands = sessionActive
    ? ['peek', 'details', 'dom', 'network', 'console', 'cdp', 'status', 'sessions', 'stop']
    : ['bdg <url>', 'sessions', 'cleanup', '--help', '--version'];

  return {
    sessionActive,
    daemonRunning: sessionActive,
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
 * Generates the full machine-readable help from a Commander program
 * (`bdg --help --json --full`).
 *
 * Includes comprehensive metadata for agent discovery:
 * - Command structure and options with behaviors
 * - Exit codes with semantic meanings
 * - Task-to-command mappings with CDP alternatives
 * - Runtime state and command availability
 * - Intent-based decision trees
 * - Capabilities summary
 *
 * @param program - Commander program instance
 * @returns Machine-readable help structure
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
 * Generates the compact root help (`bdg --help --json`): the full help with
 * the command tree reduced to names, one-line descriptions and flags.
 *
 * @param program - Commander program instance
 * @returns Compact help structure
 */
export function generateCompactHelp(program: Command): CompactHelp {
  return {
    ...generateMachineReadableHelp(program),
    details: helpJsonDetailsNote(),
    command: convertCompactCommand(program),
  };
}

/**
 * The command a command line addresses: follows the words that name
 * subcommands and skips the others (option values, arguments), stopping at a
 * command without subcommands.
 *
 * @param program - Root Commander program instance
 * @param words - Command-line words, e.g. ['dom', 'query', '.item']
 * @returns The addressed command (the program when no word names one)
 *
 * @example
 * ```typescript
 * resolveCommand(program, ['--session', 'a', 'dom', 'query', '.item']).name(); // 'query'
 * ```
 */
export function resolveCommand(program: Command, words: string[]): Command {
  let current = program;
  for (const word of words) {
    if (current.commands.length === 0) break;
    const found = current.commands.find(
      (cmd) => cmd.name() === word || cmd.aliases().includes(word)
    );
    if (found) current = found;
  }
  return current;
}

/**
 * Full command path, e.g. "bdg dom query".
 *
 * @param command - Commander command instance
 * @returns Names from the program down to the command
 */
export function commandPath(command: Command): string {
  const names: string[] = [];
  for (let level: Command | null = command; level; level = level.parent)
    names.unshift(level.name());
  return names.join(' ');
}

/**
 * Generates machine-readable help for one command: its full metadata,
 * compact subcommands (a group lists them like the root help does) and the
 * exit codes.
 *
 * @param program - Root Commander program instance
 * @param command - The command (from {@link resolveCommand})
 * @returns Help for the command
 *
 * @example
 * ```typescript
 * const help = generateCommandHelp(program, resolveCommand(program, ['dom', 'query']));
 * console.log(help.path); // 'bdg dom query'
 * ```
 */
export function generateCommandHelp(program: Command, command: Command): CommandHelp {
  return {
    name: program.name(),
    version: program.version() ?? 'unknown',
    description: program.description(),
    path: commandPath(command),
    command: {
      ...convertCommand(command),
      subcommands: command.commands.map(convertCompactCommand),
    },
    exitCodes: [...EXIT_CODE_DOCS],
  };
}
