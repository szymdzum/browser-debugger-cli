import * as chromeLauncher from 'chrome-launcher';

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
  } catch {
    // getChromePath() may throw if no Chrome found
  }

  let installations: string[] = [];
  try {
    installations = chromeLauncher.Launcher.getInstallations();
  } catch {
    // getInstallations() may throw on detection failure
  }

  cachedDiagnostics = {
    defaultPath,
    installations,
    installationCount: installations.length,
  };

  return cachedDiagnostics;
}

/**
 * Format diagnostics for error reporting when Chrome launch fails.
 * @param diagnostics - Chrome diagnostics information
 * @returns Formatted error message with troubleshooting steps
 */
export function formatDiagnosticsForError(diagnostics: ChromeDiagnostics): string[] {
  const lines: string[] = [];

  if (diagnostics.installationCount === 0) {
    lines.push('Error: No Chrome installations detected\n');
    lines.push('Install Chrome from:');
    lines.push('   https://www.google.com/chrome/\n');
  } else {
    lines.push(
      `Found ${diagnostics.installationCount} Chrome installation${diagnostics.installationCount > 1 ? 's' : ''}:\n`
    );
    diagnostics.installations.forEach((path, index) => {
      lines.push(`  ${index + 1}. ${path}`);
    });
    lines.push('');

    if (diagnostics.defaultPath) {
      lines.push(`Default binary: ${diagnostics.defaultPath}\n`);
    } else {
      lines.push('Default binary: Could not determine\n');
    }
  }

  return lines;
}

/**
 * Format diagnostics for verbose status output (bdg status --verbose).
 * @param diagnostics - Chrome diagnostics information
 * @returns Array of formatted status lines
 */
export function formatDiagnosticsForStatus(diagnostics: ChromeDiagnostics): string[] {
  const lines: string[] = [];

  if (diagnostics.defaultPath) {
    lines.push(`Binary:           ${diagnostics.defaultPath}`);
  } else {
    lines.push('Binary:           Could not determine');
  }

  lines.push(`Installations:    ${diagnostics.installationCount} found`);
  if (diagnostics.installationCount > 0 && diagnostics.installationCount <= 3) {
    diagnostics.installations.forEach((path, index) => {
      lines.push(`  ${index + 1}. ${path}`);
    });
  } else if (diagnostics.installationCount > 3) {
    lines.push(`  (Use 'bdg cleanup --aggressive' to see all)`);
  }

  return lines;
}
