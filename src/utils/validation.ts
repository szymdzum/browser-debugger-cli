import type { CollectorType } from '@/types';

const VALID_COLLECTORS: CollectorType[] = ['dom', 'network', 'console'];

/**
 * Validate that a collector type is valid
 * @throws Error if collector type is invalid
 */
export function validateCollectorType(type: string): asserts type is CollectorType {
  if (!VALID_COLLECTORS.includes(type as CollectorType)) {
    throw new Error(
      `Invalid collector type: "${type}". Valid types are: ${VALID_COLLECTORS.join(', ')}`
    );
  }
}

/**
 * Validate an array of collector types
 * @throws Error if any collector type is invalid
 */
export function validateCollectorTypes(types: string[]): asserts types is CollectorType[] {
  for (const type of types) {
    validateCollectorType(type);
  }
}
