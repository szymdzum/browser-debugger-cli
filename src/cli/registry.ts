import { Command } from 'commander';

import { registerStartCommands } from '@/cli/commands/start.js';
import { registerStopCommand } from '@/cli/commands/stop.js';
import { registerStatusCommand } from '@/cli/commands/status.js';
import { registerQueryCommand } from '@/cli/commands/query.js';
import { registerPeekCommand } from '@/cli/commands/peek.js';
import { registerDetailsCommand } from '@/cli/commands/details.js';
import { registerCleanupCommand } from '@/cli/commands/cleanup.js';

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
