/**
 * The session's user agent in headless Chrome: regular Chrome's string and
 * client hints, so sites serve the page a user sees.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';

import type { CDPConnection } from '@/connection/cdp.js';
import { createLogger, type Logger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** A brand in the client hints (`Sec-CH-UA`, `navigator.userAgentData.brands`) */
export interface BrandVersion {
  brand: string;
  version: string;
}

/** CDP `Emulation.UserAgentMetadata`: the client hints Chrome sends and reports */
export interface UserAgentMetadata {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  wow64: boolean;
  formFactors: string[];
}

/** The machine the daemon runs on, as client hints name it */
export interface HostPlatform {
  /** Client-hint platform (`macOS`, `Windows`, `Linux`) */
  platform: string;
  /** OS version as Chrome reports it */
  platformVersion: string;
  /** `arm` or `x86` */
  architecture: string;
  /** `64` or `32` */
  bitness: string;
}

/** `Browser.getVersion` fields the metadata is built from */
export interface BrowserVersion {
  product: string;
  userAgent: string;
}

/** Characters Chrome picks from for its made-up ("GREASE") brand name */
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];

/** Versions Chrome picks from for its made-up brand */
const GREASE_VERSIONS = ['8', '99', '24'];

/** Positions of the made-up brand, Chromium and the browser brand, by major version */
const BRAND_ORDERS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** Client-hint platform for each `process.platform` Chrome runs on */
const HOST_PLATFORMS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** Client-hint platform for each platform token of the user agent string */
const USER_AGENT_PLATFORMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/CrOS/, 'Chrome OS'],
  [/Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux|X11/, 'Linux'],
];

/**
 * Chrome's brand list for a version, built the way Chrome builds it
 * (`GenerateBrandVersionList` in Chromium's `user_agent_utils.cc`): a
 * made-up brand, Chromium and the browser's brand, in an order and with a
 * made-up name and version that depend on the major version.
 *
 * @param major - Major version (the seed)
 * @param chromium - Chromium version to list
 * @param browser - Browser brand and version
 * @param greaseSuffix - Appended to the made-up version (`.0.0.0` in full versions)
 * @returns Brand list
 */
export function chromeBrandList(
  major: number,
  chromium: string,
  browser: BrandVersion,
  greaseSuffix = ''
): BrandVersion[] {
  const grease = {
    brand: `Not${GREASE_CHARS[major % GREASE_CHARS.length]}A${GREASE_CHARS[(major + 1) % GREASE_CHARS.length]}Brand`,
    version: `${GREASE_VERSIONS[major % GREASE_VERSIONS.length]}${greaseSuffix}`,
  };
  const [greaseAt, chromiumAt, browserAt] = BRAND_ORDERS[major % BRAND_ORDERS.length] ?? [0, 1, 2];
  const list: BrandVersion[] = [];
  list[greaseAt] = grease;
  list[chromiumAt] = { brand: 'Chromium', version: chromium };
  list[browserAt] = browser;
  return list;
}

/**
 * The client hints regular Chrome sends, for the browser `Browser.getVersion`
 * describes. The browser brand is Microsoft Edge when the user agent says
 * `Edg/`, Google Chrome otherwise (Chromium and Chrome for Testing look the
 * same over CDP). Edge's Chromium version is only known to the major
 * version. The OS version, architecture and bitness are the host's when it
 * runs the platform the user agent names, empty otherwise (a remote Chrome).
 *
 * @param version - `Browser.getVersion` product and user agent
 * @param host - The daemon's machine
 * @returns Metadata for `Emulation.setUserAgentOverride`
 */
export function regularChromeMetadata(
  version: BrowserVersion,
  host: HostPlatform
): UserAgentMetadata {
  const fullVersion = /\/([\d.]+)/.exec(version.product)?.[1] ?? '';
  const major = Number.parseInt(fullVersion, 10) || 0;
  const isEdge = / Edg\//.test(version.userAgent);
  const chromiumVersion = isEdge ? `${major}.0.0.0` : fullVersion;
  const brand = isEdge ? 'Microsoft Edge' : 'Google Chrome';
  const platform =
    USER_AGENT_PLATFORMS.find(([token]) => token.test(version.userAgent))?.[1] ?? host.platform;
  const isHost = platform === host.platform;
  return {
    brands: chromeBrandList(major, String(major), { brand, version: String(major) }),
    fullVersionList: chromeBrandList(
      major,
      chromiumVersion,
      { brand, version: fullVersion },
      '.0.0.0'
    ),
    fullVersion,
    platform,
    platformVersion: isHost ? host.platformVersion : '',
    architecture: isHost ? host.architecture : '',
    bitness: isHost ? host.bitness : '',
    model: '',
    mobile: false,
    wow64: false,
    formFactors: ['Desktop'],
  };
}

/** First Windows build of Windows 11, which client hints report as version 13 */
const WINDOWS_11_BUILD = 22000;

/**
 * The OS version Chrome reports on Linux or Windows, from `os.release()`:
 * the kernel version's first three numbers on Linux, and on Windows `13.0.0`
 * for Windows 11 and `10.0.0` before it (Chrome reports a Windows API
 * version there, not the OS build).
 *
 * @param platform - `process.platform`
 * @param release - `os.release()`
 * @returns OS version, or empty when unknown
 */
export function releasePlatformVersion(platform: string, release: string): string {
  if (platform === 'win32') {
    const build = Number(release.split('.')[2]);
    if (!build) return '';
    return build >= WINDOWS_11_BUILD ? '13.0.0' : '10.0.0';
  }
  return /^\d+(\.\d+){0,2}/.exec(release)?.[0] ?? '';
}

/**
 * The OS version as Chrome reports it: the macOS product version (from
 * `SystemVersion.plist`, as `sw_vers` prints it), or
 * {@link releasePlatformVersion} elsewhere.
 *
 * @returns OS version, or empty when unknown
 */
function hostPlatformVersion(): string {
  if (process.platform !== 'darwin') return releasePlatformVersion(process.platform, os.release());
  try {
    const plist = readFileSync('/System/Library/CoreServices/SystemVersion.plist', 'utf8');
    return /<key>ProductVersion<\/key>\s*<string>([\d.]+)<\/string>/.exec(plist)?.[1] ?? '';
  } catch (error) {
    log.debug(`macOS version unknown: ${getErrorMessage(error)}`);
    return '';
  }
}

/**
 * The daemon's machine as client hints describe it.
 *
 * @returns Platform, OS version, architecture and bitness
 */
export function hostPlatform(): HostPlatform {
  const arch = process.arch;
  return {
    platform: HOST_PLATFORMS[process.platform] ?? '',
    platformVersion: hostPlatformVersion(),
    architecture: arch.startsWith('arm') ? 'arm' : 'x86',
    bitness: arch === 'arm64' || arch === 'x64' ? '64' : '32',
  };
}

/**
 * Send the user agent and client hints of regular Chrome from headless
 * Chrome: sites serve "HeadlessChrome" a different page (or a bot
 * challenge), so the page would not be the one a user sees. Not for a
 * session emulating a phone, whose emulation sets a mobile user agent.
 *
 * The client hints are built from `Browser.getVersion` and the host
 * ({@link regularChromeMetadata}) rather than read from the page: the page is
 * still `about:blank`, which has no `navigator.userAgentData`, and an
 * override without metadata empties the client hints.
 *
 * @param cdp - CDP connection
 * @param logger - Logger for failures (the session works without it)
 * @param known - `Browser.getVersion` result, when the caller has it
 */
export async function hideHeadlessUserAgent(
  cdp: CDPConnection,
  logger: Logger,
  known?: BrowserVersion
): Promise<void> {
  try {
    const version = known ?? ((await cdp.send('Browser.getVersion')) as BrowserVersion);
    if (!version.userAgent.includes('HeadlessChrome')) return;
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: version.userAgent.replace('HeadlessChrome', 'Chrome'),
      userAgentMetadata: regularChromeMetadata(version, hostPlatform()),
    });
  } catch (error) {
    logger.debug(`User agent left as is: ${getErrorMessage(error)}`);
  }
}
