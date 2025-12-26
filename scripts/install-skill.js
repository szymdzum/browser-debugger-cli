#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

const sourceSkillDir = resolve(packageRoot, '.claude', 'skills', 'bdg');
const targetDir = resolve(homedir(), '.claude', 'skills');
const targetSkillDir = resolve(targetDir, 'bdg');

function main() {
  if (!existsSync(sourceSkillDir)) {
    console.error('Source skill directory not found:', sourceSkillDir);
    process.exit(1);
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  try {
    execSync(`ln -sfn "${sourceSkillDir}" "${targetSkillDir}"`);
    console.log('Installed bdg skill to', targetSkillDir);
  } catch (err) {
    console.error('Failed to create symlink:', err.message);
    process.exit(1);
  }
}

main();
