/**
 * Logging utilities.
 *
 * @deprecated This file has been moved to `@/ui/logging/index.js`
 * This re-export is provided for backward compatibility only.
 */

export {
  createLogger,
  enableDebugLogging,
  isDebugEnabled,
  log,
  type LogContext,
  type LogLevel,
  type Logger,
} from '@/ui/logging/index.js';
