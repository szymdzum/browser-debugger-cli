/**
 * testFixtures - Factory functions for test data
 *
 * Provides convenient factories for creating test objects with sensible defaults.
 */

import type { CDPMessage } from '../types.js';

/**
 * Create a mock CDP message with optional overrides
 */
export function createMockCDPMessage(overrides?: Partial<CDPMessage>): CDPMessage {
  return {
    id: 1,
    method: 'Target.getTargets',
    params: {},
    ...overrides,
  };
}

/**
 * Create a WebSocket URL for testing
 */
export function createMockWebSocketUrl(port = 9222): string {
  return `ws://localhost:${port}/devtools/browser`;
}
