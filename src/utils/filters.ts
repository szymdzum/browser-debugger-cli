/**
 * Default filters for reducing noise in collected data
 */

/**
 * Domains to exclude by default (common tracking/analytics)
 * These generate high volume but are rarely useful for debugging
 */
export const DEFAULT_EXCLUDED_DOMAINS = [
  // Google Analytics & Ads
  'analytics.google.com',
  'googletagmanager.com',
  'googleadservices.com',
  'doubleclick.net',
  'google-analytics.com',

  // Microsoft/Bing
  'clarity.ms',
  'bat.bing.com',

  // Social Media Tracking
  'facebook.com',
  'connect.facebook.net',
  'tiktok.com',
  'linkedin.com',
  'twitter.com',
  'snapchat.com',

  // Product Analytics
  'mixpanel.com',
  'segment.com',
  'segment.io',
  'amplitude.com',
  'heap.io',

  // Session Recording & Heatmaps
  'fullstory.com',
  'hotjar.com',
  'logrocket.com',
  'smartlook.com',

  // Ad Networks & Attribution
  'exactag.com',
  'criteo.com',
  'adroll.com',
  'outbrain.com',
  'taboola.com',

  // Other Analytics
  'confirmit.com',
  'newrelic.com',
  'datadoghq.com',
  'sentry.io'
];

/**
 * Console message patterns to exclude by default (dev server noise)
 */
export const DEFAULT_EXCLUDED_CONSOLE_PATTERNS = [
  'webpack-dev-server',
  '[HMR]',
  '[WDS]',
  'Download the React DevTools'
];

/**
 * Check if a URL should be excluded based on domain filtering
 */
export function shouldExcludeDomain(url: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false; // Don't filter anything if --include-all flag is set
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    return DEFAULT_EXCLUDED_DOMAINS.some(domain =>
      hostname.includes(domain.toLowerCase())
    );
  } catch {
    // If URL parsing fails, don't filter
    return false;
  }
}

/**
 * Check if a console message should be excluded based on pattern filtering
 */
export function shouldExcludeConsoleMessage(text: string, includeAll: boolean = false): boolean {
  if (includeAll) {
    return false; // Don't filter anything if --include-all flag is set
  }

  const lowerText = text.toLowerCase();

  return DEFAULT_EXCLUDED_CONSOLE_PATTERNS.some(pattern =>
    lowerText.includes(pattern.toLowerCase())
  );
}

/**
 * Get filtering statistics
 */
export interface FilterStats {
  networkFiltered: number;
  consoleFiltered: number;
  totalNetwork: number;
  totalConsole: number;
}

/**
 * Format filter stats for display
 */
export function formatFilterStats(stats: FilterStats): string {
  if (stats.networkFiltered === 0 && stats.consoleFiltered === 0) {
    return '';
  }

  const lines: string[] = [];

  if (stats.networkFiltered > 0) {
    const pct = Math.round((stats.networkFiltered / stats.totalNetwork) * 100);
    lines.push(`Filtered ${stats.networkFiltered} network requests (${pct}% - tracking/analytics)`);
  }

  if (stats.consoleFiltered > 0) {
    const pct = Math.round((stats.consoleFiltered / stats.totalConsole) * 100);
    lines.push(`Filtered ${stats.consoleFiltered} console messages (${pct}% - dev server noise)`);
  }

  if (lines.length > 0) {
    lines.push('Tip: Use --include-all to disable filtering');
  }

  return lines.join('\n');
}
