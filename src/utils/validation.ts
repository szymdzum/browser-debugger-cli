/**
 * Shared validation-result shape used across URL, argument, and config validators.
 *
 * Discriminated on `valid` so callers get exhaustive narrowing: `error` and
 * `suggestion` are only accessible after a `!result.valid` check.
 */

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; suggestion?: string };

/**
 * Build a successful validation result.
 */
export function valid(): ValidationResult {
  return { valid: true };
}

/**
 * Build a failed validation result with a required error and optional
 * recovery suggestion.
 */
export function invalid(error: string, suggestion?: string): ValidationResult {
  return suggestion !== undefined ? { valid: false, error, suggestion } : { valid: false, error };
}
