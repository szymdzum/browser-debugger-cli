import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { skillSourceMissingError, skillWriteFailedError } from '@/errors/messages.js';
import type { InstalledSkill, SkillTarget } from '@/types.js';
import { formatInstalledSkills } from '@/ui/formatters/installSkill.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { PACKAGE_ROOT } from '@/utils/packageRoot.js';

/** The skill shipped with the package (also used by agents working in this repo). */
const SKILL_SOURCE_PATH = join(PACKAGE_ROOT, '.claude', 'skills', 'bdg', 'SKILL.md');

/** Skill roots, relative to the home directory, of the agents the skill is installed for. */
const SKILL_ROOTS = {
  claude: join('.claude', 'skills'),
  agents: join('.agents', 'skills'),
} satisfies Record<SkillTarget, string>;

interface InstallSkillOptions extends BaseOptions {
  claude?: boolean;
  agents?: boolean;
}

/**
 * Copy the bdg skill into each target's skill directory, overwriting an
 * older copy.
 *
 * @param targets - Agents to install for
 * @param home - Home directory the skill roots are relative to
 * @param source - SKILL.md to copy
 * @returns One entry per target, in the given order
 * @throws CommandError when the source is missing (83) or a write fails (82)
 */
export function installSkill(
  targets: SkillTarget[],
  home: string = homedir(),
  source: string = SKILL_SOURCE_PATH
): InstalledSkill[] {
  if (!existsSync(source)) {
    const err = skillSourceMissingError(source);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const content = readFileSync(source, 'utf-8');
  return targets.map((target) =>
    writeSkill(target, join(home, SKILL_ROOTS[target], 'bdg', 'SKILL.md'), content)
  );
}

/**
 * Write the skill to one path unless it already holds the same content.
 *
 * @param target - Agent the path belongs to
 * @param path - Destination SKILL.md
 * @param content - Skill text
 * @returns What happened to the file
 * @throws CommandError (82) when the directory or file cannot be written
 */
function writeSkill(target: SkillTarget, path: string, content: string): InstalledSkill {
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  if (existing === content) {
    return { target, path, status: 'unchanged' };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  } catch (caught) {
    const err = skillWriteFailedError(path, getErrorMessage(caught));
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.PERMISSION_DENIED
    );
  }
  return { target, path, status: existing === undefined ? 'installed' : 'updated' };
}

/**
 * Targets picked by the flags; no flag means every agent.
 *
 * @param options - Parsed command options
 * @returns Targets to install for
 */
function selectedTargets(options: InstallSkillOptions): SkillTarget[] {
  const picked = (Object.keys(SKILL_ROOTS) as SkillTarget[]).filter((target) => options[target]);
  return picked.length > 0 ? picked : (Object.keys(SKILL_ROOTS) as SkillTarget[]);
}

/**
 * Register the install-skill command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerInstallSkillCommand(program: Command): void {
  program
    .command('install-skill')
    .description(
      'Install the bdg agent skill for Claude Code (~/.claude/skills) and agents reading ~/.agents/skills (Codex, Gemini CLI, ...); re-run after upgrading bdg'
    )
    .option('--claude', 'Only ~/.claude/skills (Claude Code)')
    .option('--agents', 'Only ~/.agents/skills (Codex, Gemini CLI and other agents)')
    .addOption(jsonOption())
    .action(async (options: InstallSkillOptions) => {
      await runCommand<InstallSkillOptions, { skills: InstalledSkill[] }>(
        (opts) =>
          Promise.resolve({ success: true, data: { skills: installSkill(selectedTargets(opts)) } }),
        options,
        formatInstalledSkills
      );
    });
}
