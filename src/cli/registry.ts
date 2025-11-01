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
 * Registry of all CLI commands
 * Order matters: start commands first (includes default), then others
 */
export const commandRegistry: CommandRegistrar[] = [
  registerStartCommands, // Default + dom/network/console
  registerQueryCommand,
  registerStopCommand,
  registerStatusCommand,
  registerCleanupCommand,
  registerDetailsCommand,
  registerPeekCommand,
];
