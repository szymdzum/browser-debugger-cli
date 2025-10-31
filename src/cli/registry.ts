import { Command } from 'commander';
import { registerStartCommands } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerStatusCommand } from './commands/status.js';
import { registerQueryCommand } from './commands/query.js';
import { registerPeekCommand } from './commands/peek.js';
import { registerDetailsCommand } from './commands/details.js';
import { registerCleanupCommand } from './commands/cleanup.js';

/**
 * Command registration function type
 */
export type CommandRegistrar = (program: Command) => void;

/**
 * Registry of all CLI commands
 * Order matters: start commands first (includes default), then others
 */
export const commandRegistry: CommandRegistrar[] = [
  registerStartCommands,   // Default + dom/network/console
  registerQueryCommand,
  registerStopCommand,
  registerStatusCommand,
  registerCleanupCommand,
  registerDetailsCommand,
  registerPeekCommand,
];
