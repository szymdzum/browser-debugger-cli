import * as chromeLauncher from 'chrome-launcher';

import { getErrorMessage } from '@/connection/errors.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('diagnostics');

/**
 * Chrome installation diagnostics information
 */
export interface ChromeDiagnostics {
  defaultPath: string | null;
  installations: string[];
  installationCount: number;
}

/**
 * Cached diagnostics result to avoid repeated filesystem scans
 */
let cachedDiagnostics: ChromeDiagnostics | null = null;

/**
 * Get Chrome installation diagnostics.
 * Results are cached for the lifetime of the process to avoid expensive filesystem scans.
 *
 * @returns Chrome diagnostics information
 */
export function getChromeDiagnostics(): ChromeDiagnostics {
  if (cachedDiagnostics) {
    return cachedDiagnostics;
  }

  let defaultPath: string | null = null;
  try {
    defaultPath = chromeLauncher.getChromePath();
  } catch (error) {
    log.debug(`Failed to get default Chrome path: ${getErrorMessage(error)}`);
  }

  let installations: string[] = [];
  try {
    installations = chromeLauncher.Launcher.getInstallations();
  } catch (error) {
    log.debug(`Failed to get Chrome installations: ${getErrorMessage(error)}`);
  }

  cachedDiagnostics = {
    defaultPath,
    installations,
    installationCount: installations.length,
  };

  return cachedDiagnostics;
}
