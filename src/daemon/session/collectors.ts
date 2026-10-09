import type { TelemetryStore } from './TelemetryStore.js';
import type { TelemetryPlugin, TelemetryPluginContext } from './plugins.js';
import type { SessionConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { sessionActivatingCollector, sessionCollectorsActivated } from '@/daemon/messages.js';
import type { CleanupFunction, TelemetryType } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { getRegisteredTelemetryPlugins, shouldActivatePlugin } from './plugins.js';

const DEFAULT_TELEMETRY: TelemetryType[] = ['network', 'console', 'dom'];

/**
 * Start the session's collectors (telemetry plugins) in order.
 *
 * When one fails to start, the ones already started are cleaned up (their
 * failures logged) before the error is rethrown, so nothing they opened (a
 * browser-level connection, event handlers) outlives the failed start.
 *
 * @param cdp - Page connection
 * @param config - Session configuration
 * @param store - Telemetry store
 * @param logger - Logger
 * @param options - `plugins` to start (default: the registered ones), and
 *   the plugin context's `onPageSwitch` and `switchedTab`
 * @returns Cleanup functions of the started collectors
 * @throws The error of the collector that failed to start
 */
export async function startTelemetryCollectors(
  cdp: CDPConnection,
  config: SessionConfig,
  store: TelemetryStore,
  logger: Logger,
  options: { plugins?: TelemetryPlugin[] } & Pick<
    TelemetryPluginContext,
    'onPageSwitch' | 'switchedTab'
  > = {}
): Promise<CleanupFunction[]> {
  const { plugins, ...extra } = options;
  const cleanupFunctions: CleanupFunction[] = [];
  store.activeTelemetry = config.telemetry ?? DEFAULT_TELEMETRY;
  const effectivePlugins = plugins ?? getRegisteredTelemetryPlugins();

  for (const plugin of effectivePlugins) {
    if (!shouldActivatePlugin(plugin, store)) {
      continue;
    }
    logger.debug(sessionActivatingCollector(plugin.name));
    try {
      cleanupFunctions.push(await plugin.start({ cdp, config, store, logger, ...extra }));
    } catch (error) {
      await runCleanups(cleanupFunctions, logger);
      throw error;
    }
  }

  logger.debug(sessionCollectorsActivated(store.activeTelemetry));
  return cleanupFunctions;
}

/**
 * Run cleanup functions, logging (not throwing) their failures.
 *
 * @param cleanups - Cleanup functions
 * @param logger - Logger
 */
export async function runCleanups(cleanups: CleanupFunction[], logger: Logger): Promise<void> {
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      logger.debug(`Collector cleanup error: ${getErrorMessage(error)}`);
    }
  }
}
