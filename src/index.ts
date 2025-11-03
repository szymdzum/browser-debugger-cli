#!/usr/bin/env node

import { Command } from 'commander';

import { commandRegistry } from '@/cli/registry.js';
import { VERSION } from '@/utils/version.js';

const program = new Command()
  .name('bdg')
  .description('Browser telemetry via Chrome DevTools Protocol')
  .version(VERSION);

commandRegistry.forEach((register) => register(program));

program.parse();
