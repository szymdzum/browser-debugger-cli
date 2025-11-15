/**
 * Worker Config Parser
 *
 * Parses and validates worker configuration from command-line arguments.
 */

import { getErrorMessage } from '@/connection/errors.js';
import type { WorkerConfig } from '@/daemon/worker/types.js';

/**
 * Type guard to validate parsed JSON is a valid WorkerConfig.
 */
function isValidWorkerConfig(obj: unknown): obj is WorkerConfig {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  return (
    'url' in obj && typeof obj.url === 'string' && 'port' in obj && typeof obj.port === 'number'
  );
}

/**
 * Parse worker configuration from process arguments.
 *
 * @returns Normalized worker configuration
 * @throws Error if configuration is invalid or missing
 */
export function parseWorkerConfig(): WorkerConfig {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    throw new Error('Worker requires configuration arguments');
  }

  try {
    const configArg = args[0];
    if (!configArg) {
      throw new Error('Missing configuration argument');
    }
    const parsed: unknown = JSON.parse(configArg);
    if (!isValidWorkerConfig(parsed)) {
      throw new Error('Invalid worker config structure - missing required fields (url, port)');
    }
    const config = parsed;
    const normalized: WorkerConfig = {
      url: config.url,
      port: config.port ?? 9222,
      telemetry: config.telemetry ?? ['network', 'console', 'dom'],
      includeAll: config.includeAll ?? false,
      headless: config.headless ?? false,
    };

    if (config.timeout !== undefined) {
      normalized.timeout = config.timeout;
    }
    if (config.userDataDir !== undefined) {
      normalized.userDataDir = config.userDataDir;
    }
    if (config.maxBodySize !== undefined) {
      normalized.maxBodySize = config.maxBodySize;
    }
    if (config.chromeWsUrl !== undefined) {
      normalized.chromeWsUrl = config.chromeWsUrl;
    }

    return normalized;
  } catch (error) {
    throw new Error(`Failed to parse worker config: ${getErrorMessage(error)}`);
  }
}
