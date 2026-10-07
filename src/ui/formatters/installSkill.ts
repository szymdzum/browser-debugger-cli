import { homedir } from 'os';

import type { InstalledSkill } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { skillBackupMessage } from '@/ui/messages/commands.js';

/** Indent of the path column, so a backup line sits under the path it belongs to */
const PATH_INDENT = ' '.repeat(2 + 6 + 2 + 9 + 2);

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
 * Add where the skill was installed, one line per agent, plus where a
 * replaced copy was kept.
 *
 * @param fmt - Formatter to add the lines to
 * @param skills - Install results
 * @returns The formatter
 */
function addSkillTargets(fmt: OutputFormatter, skills: InstalledSkill[]): OutputFormatter {
  fmt.text('bdg skill:');
  for (const skill of skills) {
    fmt.text(`  ${skill.target.padEnd(6)}  ${skill.status.padEnd(9)}  ${tildePath(skill.path)}`);
    if (skill.backup) fmt.text(`${PATH_INDENT}${skillBackupMessage(tildePath(skill.backup))}`);
  }
  return fmt;
}

/**
 * Format the targets the skill was written for, as a failed install lists
 * the ones that succeeded.
 *
 * @param skills - Install results
 * @returns Human-readable lines
 */
export function formatSkillTargets(skills: InstalledSkill[]): string {
  return addSkillTargets(new OutputFormatter(), skills).build();
}

/**
 * Format where the skill was installed, plus what to do next.
 *
 * @param data - Install results
 * @returns Human-readable summary
 */
export function formatInstalledSkills(data: { skills: InstalledSkill[] }): string {
  return addSkillTargets(new OutputFormatter(), data.skills)
    .hints('Next:', [
      'Start a new agent session to load it (running sessions keep the old list)',
      'After upgrading bdg, run bdg install-skill again',
    ])
    .build();
}
