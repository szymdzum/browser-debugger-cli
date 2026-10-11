/**
 * Names of fields that hold secrets: one rule for DOM masking and HAR
 * sanitising (#622). Not implemented yet: these delegate to the two rules
 * they replace.
 */

import { SENSITIVE_NAME_SOURCE } from '@/runtime/dom/elementInfo.js';
import { isSensitiveField } from '@/telemetry/har/sanitizeBody.js';

/**
 * Whether a field, parameter or header name looks like it holds a secret.
 *
 * @param name - Name
 * @returns True for secret names
 */
export function isSensitiveName(name: string): boolean {
  return isSensitiveField(name);
}

/** Page-side `(name) => boolean`: {@link isSensitiveName} */
export const SENSITIVE_NAME_JS = `(name) => /${SENSITIVE_NAME_SOURCE}/i.test(String(name))`;
