/**
 * Logging utilities for bdg CLI.
 *
 * Provides consistent log formatting with context-based prefixes and debug mode support.
 */

export {
  createLogger,
  enableDebugLogging,
  isDebugEnabled,
  log,
  type LogContext,
  type LogLevel,
  type Logger,
} from './logger.js';
