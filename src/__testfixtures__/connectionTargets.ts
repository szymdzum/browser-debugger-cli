import type { CDPTarget } from '@/types';

/**
 * Create a mock CDPTarget with default values and optional overrides.
 *
 * Provides consistent test data across connection module tests while allowing
 * customization for specific test scenarios.
 *
 * @param overrides - Partial CDPTarget properties to override defaults
 * @returns Complete CDPTarget object for testing
 */
export const createMockTarget = (overrides: Partial<CDPTarget> = {}): CDPTarget => ({
  id: 'target-123',
  type: 'page',
  url: 'http://localhost:3000',
  title: 'Test Page',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-123',
  ...overrides,
});

/**
 * Standard list of mock targets for testing target discovery and matching.
 *
 * Includes common test scenarios:
 * - Different URLs on same host (localhost:3000, localhost:3000/about)
 * - Different hosts (example.com)
 * - Different target types (page, background_page, service_worker)
 */
export const mockTargetList: CDPTarget[] = [
  createMockTarget({
    id: 'target-1',
    url: 'http://localhost:3000',
    title: 'Home Page',
  }),
  createMockTarget({
    id: 'target-2',
    url: 'http://localhost:3000/about',
    title: 'About Page',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-2',
  }),
  createMockTarget({
    id: 'target-3',
    url: 'http://example.com',
    title: 'Example Site',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-3',
  }),
  createMockTarget({
    id: 'target-4',
    type: 'background_page',
    url: 'chrome-extension://abcdef/background.html',
    title: 'Extension Background',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-4',
  }),
  createMockTarget({
    id: 'target-5',
    type: 'service_worker',
    url: 'https://app.example.com/sw.js',
    title: 'Service Worker',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target-5',
  }),
];
