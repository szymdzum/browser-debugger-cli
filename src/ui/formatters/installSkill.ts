import { homedir } from 'os';

import type { InstalledSkill } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Shorten a path under the home directory to `~/...`.
 *
 * @param path - Absolute path
 * @returns Path as the user would type it
 */
function tildePath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Format where the skill was installed, one line per agent.
 *
 * @param data - Install results
 * @returns Human-readable summary
 */
export function formatInstalledSkills(data: { skills: InstalledSkill[] }): string {
  const fmt = new OutputFormatter().text('bdg skill:');
  for (const skill of data.skills) {
    fmt.text(`  ${skill.target.padEnd(6)}  ${skill.status.padEnd(9)}  ${tildePath(skill.path)}`);
  }
  return fmt
    .hints('Next:', [
      'Start a new agent session to load it (running sessions keep the old list)',
      'After upgrading bdg, run bdg install-skill again',
    ])
    .build();
}
