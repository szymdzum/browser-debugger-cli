/**
 * The session's user agent in headless Chrome: regular Chrome's string and
 * client hints, so sites serve the page a user sees.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Logger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

/** Reads the client hints Chrome reports, renaming the HeadlessChrome brand */
const USER_AGENT_METADATA_SCRIPT = `(async () => {
  const data = navigator.userAgentData;
  if (!data) return null;
  const values = await data.getHighEntropyValues(
    ['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64']
  );
  const rename = (list) => (list || []).map((entry) => ({
    brand: entry.brand.replace('HeadlessChrome', 'Google Chrome'),
    version: entry.version,
  }));
  return {
    brands: rename(values.brands),
    fullVersionList: rename(values.fullVersionList),
    platform: values.platform,
    platformVersion: values.platformVersion,
    architecture: values.architecture,
    model: values.model,
    mobile: values.mobile,
    bitness: values.bitness,
    wow64: values.wow64,
  };
})()`;

/**
 * Send the user agent and client hints of regular Chrome from headless
 * Chrome: sites serve "HeadlessChrome" a different page (or a bot
 * challenge), so the page would not be the one a user sees. Not for a
 * session emulating a phone, whose emulation sets a mobile user agent.
 *
 * @param cdp - CDP connection
 * @param logger - Logger for failures (the session works without it)
 */
export async function hideHeadlessUserAgent(cdp: CDPConnection, logger: Logger): Promise<void> {
  try {
    const { userAgent } = (await cdp.send('Browser.getVersion')) as { userAgent: string };
    if (!userAgent.includes('HeadlessChrome')) return;
    const metadata = (await cdp.send('Runtime.evaluate', {
      expression: USER_AGENT_METADATA_SCRIPT,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: userAgent.replace('HeadlessChrome', 'Chrome'),
      ...(metadata.result?.value ? { userAgentMetadata: metadata.result.value } : {}),
    });
  } catch (error) {
    logger.debug(`User agent left as is: ${getErrorMessage(error)}`);
  }
}
