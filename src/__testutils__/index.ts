/**
 * Test utilities - Re-export all test helpers
 *
 * Single import point for all test utilities:
 * import { FakeClock, FakeWebSocket, useFakeClock, ... } from '@/__testutils__/index.js';
 */

export { FakeClock } from './FakeClock.js';
export { FakeWebSocket, CONNECTING, OPEN, CLOSING, CLOSED } from './FakeWebSocket.js';
export { useFakeClock, type ClockHelper } from './testClock.js';
export { mockProcessAlive, restoreProcessAlive, isProcessMocked } from './testProcess.js';
export { assertEventually, assertCDPMessage, assertThrowsAsync } from './assertions.js';
export { createMockCDPMessage, createMockWebSocketUrl } from './testFixtures.js';
