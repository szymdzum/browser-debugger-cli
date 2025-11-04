import type { Command } from 'commander';

import { registerCdpCommand } from '@/cli/commands/cdp.js';
import { registerCleanupCommand } from '@/cli/commands/cleanup.js';
import { registerConsoleCommand } from '@/cli/commands/console.js';
import { registerDetailsCommand } from '@/cli/commands/details.js';
import { registerDomCommands } from '@/cli/commands/dom/index.js';
import { registerNetworkCommands } from '@/cli/commands/network.js';
import { registerPeekCommand } from '@/cli/commands/peek.js';
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
  registerDomCommands,

  // CDP Commands
  addCommandGroup('CDP Commands:'),
  registerCdpCommand,

  // Network Commands
  addCommandGroup('Network Commands:'),
  registerNetworkCommands,

  // Console Commands
  addCommandGroup('Console Commands:'),
  registerConsoleCommand,
];
