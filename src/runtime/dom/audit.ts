/**
 * `bdg dom audit`: page-wide checks in one page walk
 * ({@link AUDIT_PAGE_JS}), turned into findings by {@link buildAudit}.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import type { AuditResult } from '@/ipc/protocol/auditTypes.js';
import type { DomAuditCommand } from '@/ipc/protocol/commands.js';
import { auditA11y } from '@/runtime/dom/auditA11y.js';
import { buildAudit } from '@/runtime/dom/auditModel.js';
import { AUDIT_PAGE_JS, type RawAudit } from '@/runtime/dom/auditScripts.js';
import { readPageLoadingState } from '@/runtime/page/loadingState.js';
import { callFunctionInBdgWorld } from '@/runtime/page/bdgWorld.js';
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
  const response = await callFunctionInBdgWorld(cdp, {
    functionDeclaration: AUDIT_PAGE_JS,
    arguments: [{ value: params.checks }],
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
  const limit = params.limit ?? DEFAULT_AUDIT_LIMIT;
  const audit = buildAudit(raw, { checks: params.checks, level: params.level ?? 'AA', limit });
  const loading = await readPageLoadingState(cdp, []);
  return {
    ...audit,
    ...(loading && { loading }),
    ...(params.checks.includes('a11y') && { a11y: await auditA11y(cdp, limit) }),
  };
}
