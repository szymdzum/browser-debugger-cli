#!/usr/bin/env node

import { Command } from 'commander';

import { commandRegistry } from '@/cli/registry.js';
import { VERSION } from '@/utils/version.js';

// Create Commander program
const program = new Command()
  .name('bdg')
  .description('Browser telemetry via Chrome DevTools Protocol')
  .version(VERSION);

// Register all commands from registry
commandRegistry.forEach((register) => register(program));

// Parse and execute
program.parse();
