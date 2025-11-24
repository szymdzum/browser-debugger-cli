/**
 * Network command group registration.
 *
 * Provides commands for inspecting and exporting network data:
 * - list: List requests with DevTools-compatible filtering
 * - har: Export to HAR 1.2 format
 * - getCookies: List cookies
 * - headers: Show HTTP headers
 * - document: Show main document headers
 */

import type { Command } from 'commander';

import { registerHarCommand } from './har.js';
import { registerListCommand } from './list.js';
import {
  registerGetCookiesCommand,
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
  registerHarCommand(networkCmd);
  registerGetCookiesCommand(networkCmd);
  registerHeadersCommand(networkCmd);
  registerDocumentCommand(networkCmd);
}
