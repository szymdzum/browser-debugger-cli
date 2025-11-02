/**
 * cdpMessages - Sample CDP protocol messages for tests
 *
 * Provides realistic CDP message fixtures to keep tests concise and readable.
 */

import type { CDPMessage } from '../types.js';

/**
 * Sample CDP request message
 */
export const CDP_REQUEST: CDPMessage = {
  id: 1,
  method: 'Target.getTargets',
  params: {},
};

/**
 * Sample CDP response message (success)
 */
export const CDP_RESPONSE_SUCCESS: CDPMessage = {
  id: 1,
  result: {
    targetInfos: [
      {
        targetId: 't1',
        type: 'page',
        title: 'Test Page',
        url: 'http://localhost:3000',
        attached: false,
        canAccessOpener: false,
      },
    ],
  },
};

/**
 * Sample CDP error response
 */
export const CDP_RESPONSE_ERROR: CDPMessage = {
  id: 1,
  error: {
    code: -32601,
    message: 'Method not found',
  },
};

/**
 * Sample CDP event notification (no id)
 */
export const CDP_EVENT_NOTIFICATION: CDPMessage = {
  method: 'Target.targetCreated',
  params: {
    targetInfo: {
      targetId: 't2',
      type: 'page',
      title: 'New Page',
      url: 'http://localhost:4000',
      attached: false,
      canAccessOpener: false,
    },
  },
};

/**
 * Sample CDP event with session ID
 */
export const CDP_EVENT_WITH_SESSION: CDPMessage = {
  method: 'Page.frameNavigated',
  params: {
    frame: {
      id: 'frame-1',
      loaderId: 'loader-1',
      url: 'http://localhost:3000/page',
      securityOrigin: 'http://localhost:3000',
      mimeType: 'text/html',
    },
  },
  sessionId: 'session-abc123',
};

/**
 * Factory: Create a request message with custom ID
 */
export function createRequest(id: number, method: string, params?: unknown): CDPMessage {
  return {
    id,
    method,
    params: (params as Record<string, unknown>) ?? {},
  };
}

/**
 * Factory: Create a success response
 */
export function createResponse(id: number, result: unknown): CDPMessage {
  return {
    id,
    result,
  };
}

/**
 * Factory: Create an error response
 */
export function createErrorResponse(id: number, message: string, code = -32603): CDPMessage {
  return {
    id,
    error: {
      code,
      message,
    },
  };
}

/**
 * Factory: Create an event notification
 */
export function createEvent(method: string, params: unknown, sessionId?: string): CDPMessage {
  const event: CDPMessage = {
    method,
    params: (params as Record<string, unknown>) ?? {},
  };
  if (sessionId) {
    event.sessionId = sessionId;
  }
  return event;
}
