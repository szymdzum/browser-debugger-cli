/**
 * `bdg dom audit`: page-wide checks in one page walk
 * ({@link AUDIT_PAGE_JS}), turned into findings by {@link buildAudit}.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import type { AuditResult } from '@/ipc/protocol/auditTypes.js';
import type { DomAuditCommand } from '@/ipc/protocol/commands.js';
import { buildAudit } from '@/runtime/dom/auditModel.js';
import { AUDIT_PAGE_JS, type RawAudit } from '@/runtime/dom/auditScripts.js';
import { evaluateInBdgWorld } from '@/runtime/page/bdgWorld.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Findings listed per check without `--limit` */
export const DEFAULT_AUDIT_LIMIT = 20;

/**
 * Run the page-wide checks.
 *
 * @param cdp - CDP connection
 * @param params - Checks, WCAG level and limit
 * @returns Findings
 * @throws CommandError (91) when the page script fails
 */
export async function auditPage(cdp: CDPConnection, params: DomAuditCommand): Promise<AuditResult> {
  const response = await evaluateInBdgWorld(cdp, {
    expression: `(${AUDIT_PAGE_JS})(${JSON.stringify(params.checks)})`,
    returnByValue: true,
  });
  const raw = response.result.value as RawAudit | undefined;
  if (response.exceptionDetails || !raw) {
    const err = operationFailedError(
      'audit the page',
      response.exceptionDetails?.exception?.description ?? 'the page script failed'
    );
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return buildAudit(raw, {
    checks: params.checks,
    level: params.level ?? 'AA',
    limit: params.limit ?? DEFAULT_AUDIT_LIMIT,
  });
}
