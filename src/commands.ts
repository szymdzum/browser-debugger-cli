import type { Command } from 'commander';

import { registerCdpCommand } from '@/commands/cdp.js';
import { registerCleanupCommand } from '@/commands/cleanup.js';
import { registerConsoleCommand } from '@/commands/console.js';
import { registerDetailsCommand } from '@/commands/details.js';
import { registerFormInteractionCommands } from '@/commands/dom/formInteraction.js';
import { registerDomCommands } from '@/commands/dom/index.js';
import { registerNetworkCommands } from '@/commands/network.js';
import { registerPeekCommand } from '@/commands/peek.js';
import { registerStartCommands } from '@/commands/start.js';
import { registerStatusCommand } from '@/commands/status.js';
import { registerStopCommand } from '@/commands/stop.js';
import { registerTailCommand } from '@/commands/tail.js';

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
  registerStartCommands,

  // Session Management Commands
  addCommandGroup('Session Management:'),
  registerStatusCommand,
  registerStopCommand,
  registerCleanupCommand,

  // Data Inspection Commands
  addCommandGroup('Data Inspection:'),
  registerPeekCommand,
  registerTailCommand,
  registerDetailsCommand,
  registerDomCommands,
  registerFormInteractionCommands,

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
