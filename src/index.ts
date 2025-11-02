#!/usr/bin/env node

import { Command } from 'commander';

import { commandRegistry } from '@/cli/registry.js';

// Create Commander program
const program = new Command()
  .name('bdg')
  .description('Browser telemetry via Chrome DevTools Protocol')
  .version('0.1.0');

// Register all commands from registry
commandRegistry.forEach((register) => register(program));

// Parse and execute
program.parse();
