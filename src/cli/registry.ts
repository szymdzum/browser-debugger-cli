import type { Command } from 'commander';

import { registerCleanupCommand } from '@/cli/commands/cleanup.js';
import { registerDetailsCommand } from '@/cli/commands/details.js';
import { registerPeekCommand } from '@/cli/commands/peek.js';
import { registerQueryCommand } from '@/cli/commands/query.js';
import { registerStartCommands } from '@/cli/commands/start.js';
import { registerStatusCommand } from '@/cli/commands/status.js';
import { registerStopCommand } from '@/cli/commands/stop.js';

/**
 * Command registration function type
 */
export type CommandRegistrar = (program: Command) => void;

/**
 * Helper to add a command group
 */
const addCommandGroup = (groupName: string): CommandRegistrar => {
  return (program: Command) => {
    program.commandsGroup(groupName);
  };
};

/**
 * Registry of all CLI commands with grouping
 * Order matters: groups organize commands in help output
 */
export const commandRegistry: CommandRegistrar[] = [
  // Default command (no group)
  registerStartCommands, // Default + dom/network/console

  // Session Management Commands
  addCommandGroup('Session Management:'),
  registerStatusCommand,
  registerStopCommand,
  registerCleanupCommand,

  // Data Inspection Commands
  addCommandGroup('Data Inspection:'),
  registerPeekCommand,
  registerDetailsCommand,
  registerQueryCommand,
];
