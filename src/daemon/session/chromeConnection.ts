/**
 * Chrome Connection Setup
 *
 * Handles Chrome launch or connection to existing Chrome instance.
 * Finds the appropriate CDP target for the session.
 */

import { ChromeLaunchError } from '@/connection/errors.js';
import { launchChrome } from '@/connection/launcher.js';
import { ConfigError } from '@/daemon/errors.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import { writeChromePid } from '@/session/chrome.js';
import { getSessionDir } from '@/session/paths.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Setup Chrome connection - either launch new instance or connect to existing.
 *
 * @returns Launched Chrome instance (null if connecting to external Chrome)
 */
export async function setupChromeConnection(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger,
  notify: NoticeSink<ChromeNoticeCode>
): Promise<LaunchedChrome | null> {
  if (config.chromeWsUrl) {
    return setupExternalChrome(config, telemetryStore, notify);
  } else {
    return setupLaunchedChrome(config, log);
  }
}

/**
 * Connect to existing external Chrome instance.
 */
function setupExternalChrome(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  notify: NoticeSink<ChromeNoticeCode>
): null {
  const wsUrl = config.chromeWsUrl;
  if (!wsUrl) {
    throw new ConfigError(
      'chromeWsUrl is required for external Chrome connection',
      'MISSING_WS_URL'
    );
  }

  notify({ code: 'EXTERNAL_CHROME_CONNECTING' });
  notify({ code: 'EXTERNAL_CHROME_WS_URL', context: { wsUrl } });

  const targetId = wsUrl.split('/').pop() ?? 'external';

  telemetryStore.setTargetInfo({
    id: targetId,
    type: 'page',
    title: 'External Chrome',
    url: config.url,
    webSocketDebuggerUrl: wsUrl,
  });

  notify({ code: 'EXTERNAL_CHROME_NO_PID' });

  return null;
}

/**
 * Launch a new Chrome instance and record its PID for crash cleanup.
 */
async function setupLaunchedChrome(config: SessionConfig, log: Logger): Promise<LaunchedChrome> {
  const chrome = await launchChrome({
    port: config.port,
    logger: log,
    sessionDir: getSessionDir(),
    ...filterDefined({
      userDataDir: config.userDataDir,
      headless: config.headless,
      chromeFlags: config.chromeFlags,
    }),
  });

  log.info(`Chrome launched (PID ${chrome.pid})`);

  writeChromePid(chrome.pid);
  log.debug(`Chrome PID ${chrome.pid} cached for emergency cleanup`);

  return chrome;
}

/**
 * Find the page target of a Chrome that bdg launched.
 *
 * Kept separate from the launch so the session owns Chrome before this can
 * fail, and tears it down if it does.
 *
 * @param config - Session configuration
 * @param telemetryStore - Store receiving the target info
 * @param log - Logger
 * @throws ChromeLaunchError if Chrome exposes no page target
 */
export async function findPageTarget(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger
): Promise<void> {
  log.info(`Connecting to Chrome via CDP...`);
  const targets = await fetchCDPTargets(config.port, log);
  const foundTarget = targets.find((t) => t.type === 'page');

  if (!foundTarget) {
    const availableTargets = targets.length
      ? targets
          .map(
            (t, i) =>
              `  ${i + 1}. ${t.title || '(no title)'}\n     URL: ${t.url}\n     Type: ${t.type}`
          )
          .join('\n')
      : null;

    throw new ChromeLaunchError('No page target found after Chrome launch', {
      issue: {
        code: 'NO_PAGE_TARGET_FOUND',
        context: { port: config.port, availableTargets },
      },
    });
  }

  telemetryStore.setTargetInfo(foundTarget);
  log.info(`Found target: ${foundTarget.title} (${foundTarget.url})`);
}
