/**
 * Network command group registration.
 *
 * Provides commands for inspecting and exporting network data:
 * - list: List requests with DevTools-compatible filtering
 * - details: One request's details
 * - har: Export to HAR 1.2 format
 * - cookies: List cookies
 * - headers: Show HTTP headers
 * - document: Show main document headers
 */

import type { Command } from 'commander';

import { registerDetailsSubcommand } from '@/commands/details.js';
import { registerHarCommand } from './har.js';
import { registerListCommand } from './list.js';
import {
  registerCookiesCommands,
  registerHeadersCommand,
  registerDocumentCommand,
} from './shared.js';

/**
 * Register all network subcommands.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerNetworkCommands(program: Command): void {
  const networkCmd = program.command('network').description('Inspect network state and resources');

  registerListCommand(networkCmd);
  registerDetailsSubcommand(networkCmd, 'network');
  registerHarCommand(networkCmd);
  registerCookiesCommands(networkCmd);
  registerHeadersCommand(networkCmd);
  registerDocumentCommand(networkCmd);
}
