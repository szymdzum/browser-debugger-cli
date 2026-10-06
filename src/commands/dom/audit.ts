/**
 * `bdg dom audit [check...]` - page-wide checks without a screenshot or
 * `dom eval`: text below a WCAG contrast level, what makes the page scroll
 * sideways and cut-off text and scaled images, fixed and sticky layers, and
 * running animations.
 */

import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { unknownAuditCheckMessage } from '@/errors/messages.js';
import { domAudit } from '@/ipc/client.js';
import { AUDIT_CHECKS, type AuditCheck, type AuditResult } from '@/ipc/protocol/auditTypes.js';
import { formatAudit } from '@/ui/formatters/audit.js';
import { AUDIT_HELP_EXAMPLES } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

/** Options of `bdg dom audit` */
interface AuditCommandOptions extends BaseOptions {
  level?: 'AA' | 'AAA';
  limit?: number;
}

/**
 * Register `bdg dom audit`.
 *
 * @param dom - The `dom` command group
 */
export function registerAuditCommand(dom: Command): void {
  dom
    .command('audit')
    .description(
      'Page-wide checks: text below WCAG contrast, sideways scroll and cut-off text, scaled images, fixed/sticky layers, animations'
    )
    .argument('[checks...]', `Checks to run: ${AUDIT_CHECKS.join(', ')} (default: all)`, checkList)
    .option('--level <level>', 'WCAG level text must reach: AA or AAA (default: AA)', levelOption)
    .option('--limit <n>', 'Findings listed per check (default: 20)', integerOption(1, 500))
    .addOption(jsonOption())
    .addHelpText('after', AUDIT_HELP_EXAMPLES)
    .action(async (checks: AuditCheck[] | undefined, options: AuditCommandOptions) => {
      await runCommand(() => audit(checks, options), options, formatAudit);
    });
}

/**
 * Parse the checks, rejecting unknown names with the closest one.
 *
 * @param value - One check name
 * @param previous - Checks so far
 * @returns Checks
 * @throws InvalidArgumentError for an unknown name
 */
function checkList(value: string, previous: AuditCheck[] = []): AuditCheck[] {
  const check = AUDIT_CHECKS.find((name) => name === value.trim().toLowerCase());
  if (!check) {
    throw new InvalidArgumentError(
      unknownAuditCheckMessage(value, findSimilar(value, [...AUDIT_CHECKS]), AUDIT_CHECKS)
    );
  }
  return previous.includes(check) ? previous : [...previous, check];
}

/**
 * Parse `--level`.
 *
 * @param value - Level
 * @returns AA or AAA
 * @throws InvalidArgumentError for another value
 */
function levelOption(value: string): 'AA' | 'AAA' {
  const level = value.trim().toUpperCase();
  if (level === 'AA' || level === 'AAA') return level;
  throw new InvalidArgumentError('Use AA or AAA');
}

/**
 * Ask the daemon to audit the page.
 *
 * @param checks - Checks given (all when none)
 * @param options - Level and limit
 * @returns Command result
 */
async function audit(
  checks: AuditCheck[] | undefined,
  options: AuditCommandOptions
): Promise<{
  success: boolean;
  data?: AuditResult;
  error?: string;
  exitCode?: number;
  errorContext?: { suggestion: string };
}> {
  const response = await domAudit({
    checks: checks && checks.length > 0 ? checks : [...AUDIT_CHECKS],
    ...(options.level && { level: options.level }),
    ...(options.limit !== undefined && { limit: options.limit }),
  });
  if (response.status === 'error' || !response.data) {
    return {
      success: false,
      error: response.error ?? 'Failed to audit the page',
      exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
      ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
    };
  }
  return { success: true, data: response.data };
}
