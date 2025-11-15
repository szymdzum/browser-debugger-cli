/**
 * Session Messages
 *
 * Exports all session-related message types: lifecycle, queries, and errors.
 */

export * from './errors.js';
export type * from './lifecycle.js';
export type * from './queries.js';
export type * from './types.js';

import type { LifecycleMessageType } from './lifecycle.js';
import type { QueryMessageType } from './queries.js';

/**
 * Union of all IPC message types (lifecycle + queries).
 */
export type IPCMessageType = LifecycleMessageType | QueryMessageType;
