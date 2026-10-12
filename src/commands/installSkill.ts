import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { skillSourceMissingError, skillWriteFailedError } from '@/errors/messages.js';
import type { InstalledSkill, SkillTarget } from '@/types.js';
import { formatInstalledSkills, formatSkillTargets } from '@/ui/formatters/installSkill.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { safeRemoveFile } from '@/utils/file.js';
import { PACKAGE_ROOT } from '@/utils/packageRoot.js';

const log = createLogger('bdg');

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

/** What installing the skill did, and why it failed for a target, if it did */
export interface SkillInstallResult {
  /** Targets the skill was installed for (or left unchanged) */
  skills: InstalledSkill[];
  /** Error (82) for the targets that could not be written */
  failure?: CommandError;
}

/** A target the skill could not be written for */
interface SkillWriteFailure {
  target: SkillTarget;
  /** File that could not be written */
  path: string;
  error: unknown;
}

/**
 * Copy the bdg skill into each target's skill directory. A copy that differs
 * (an older version, or one the user edited) is kept as `SKILL.md.bak`
 * before it is overwritten. A target that cannot be written does not stop
 * the others.
 *
 * @param targets - Agents to install for
 * @param home - Home directory the skill roots are relative to
 * @param source - SKILL.md to copy
 * @returns The targets written, in the given order, and the failure if any
 * @throws CommandError when the source is missing (83)
 */
export function installSkill(
  targets: SkillTarget[],
  home: string = homedir(),
  source: string = SKILL_SOURCE_PATH
): SkillInstallResult {
  if (!existsSync(source)) {
    const err = skillSourceMissingError(source);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  const content = readFileSync(source, 'utf-8');
  const skills: InstalledSkill[] = [];
  const failures: SkillWriteFailure[] = [];
  for (const target of targets) {
    const result = writeSkill(target, join(home, SKILL_ROOTS[target], 'bdg', 'SKILL.md'), content);
    if ('error' in result) failures.push(result);
    else skills.push(result);
  }
  if (failures.length === 0) return { skills };
  return { skills, failure: skillFailureError(failures, targets) };
}

/**
 * The error for targets the skill could not be written for. When only one of
 * several targets failed, it suggests installing for the other only. Each
 * distinct suggestion is kept, so every failure cause gets its fix.
 *
 * @param failures - Targets that failed (at least one)
 * @param targets - Targets picked
 * @returns Command error (82)
 */
function skillFailureError(failures: SkillWriteFailure[], targets: SkillTarget[]): CommandError {
  const other = failures.length === 1 ? targets.find((t) => t !== failures[0]?.target) : undefined;
  const errors = failures.map(({ path, error }) => {
    const code = (error as NodeJS.ErrnoException).code;
    return skillWriteFailedError(
      path,
      getErrorMessage(error),
      code === 'ENOTDIR' || code === 'EEXIST',
      other && `--${other}`
    );
  });
  return new CommandError(
    errors.map((err) => err.message).join('\n'),
    { suggestion: [...new Set(errors.map((err) => err.suggestion))].join('\n') },
    EXIT_CODES.PERMISSION_DENIED
  );
}

/**
 * Write the skill to one path unless it already holds the same content; a
 * different copy is first kept next to it as `SKILL.md.bak` (replacing an
 * earlier backup), so edits to it are not lost. The new text is written to a
 * temporary file first, so a failed write leaves both the copy and the
 * backup as they were; the backup gets the default file mode, whatever the
 * copy's was.
 *
 * @param target - Agent the path belongs to
 * @param path - Destination SKILL.md
 * @param content - Skill text
 * @returns What happened to the file, with the backup path when one was made,
 *   or the file that could not be written and why
 */
function writeSkill(
  target: SkillTarget,
  path: string,
  content: string
): InstalledSkill | SkillWriteFailure {
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  if (existing === content) {
    return { target, path, status: 'unchanged' };
  }
  const backup = existing === undefined ? undefined : `${path}.bak`;
  const temporary = `${path}.tmp`;
  let writing = path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, content);
    if (backup !== undefined) {
      writing = backup;
      rmSync(backup, { force: true });
      writeFileSync(backup, existing ?? '');
    }
    writing = path;
    renameSync(temporary, path);
  } catch (error) {
    safeRemoveFile(temporary, 'temporary skill copy', log);
    return { target, path: writing, error };
  }
  if (backup === undefined) return { target, path, status: 'installed' };
  return { target, path, status: 'updated', backup };
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
 * Install the skill for the picked targets. When a target fails, the error
 * still lists the targets that were written (and their backups): JSON
 * `skills`, or the same lines as a successful install.
 *
 * @param options - Parsed command options
 * @returns Command result
 */
function installSkillResult(
  options: InstallSkillOptions
): CommandResult<{ skills: InstalledSkill[] }> {
  const { skills, failure } = installSkill(selectedTargets(options));
  if (!failure) return { success: true, data: { skills } };
  const written =
    skills.length === 0 ? {} : options.json ? { skills } : { written: formatSkillTargets(skills) };
  return {
    success: false,
    error: failure.message,
    exitCode: failure.exitCode,
    errorContext: { ...written, ...failure.metadata },
  };
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
        (opts) => Promise.resolve(installSkillResult(opts)),
        options,
        formatInstalledSkills
      );
    });
}
