import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  matchesWildcard,
  shouldFetchBody,
  shouldExcludeUrl,
  shouldExcludeDomain,
  shouldExcludeConsoleMessage,
  DEFAULT_SKIP_BODY_PATTERNS,
  DEFAULT_EXCLUDED_DOMAINS,
  DEFAULT_EXCLUDED_CONSOLE_PATTERNS,
} from '@/utils/filters.js';

void describe('filters - matchesWildcard', () => {
  void it('should match exact strings', () => {
    // codeql[js/incomplete-hostname-regexp] - These are test data strings for wildcard matching, not regex patterns
    assert.equal(matchesWildcard('api.example.com', 'api.example.com'), true);
    assert.equal(matchesWildcard('api.example.com/users', 'api.example.com/users'), true);
    assert.equal(matchesWildcard('api.example.com', 'cdn.example.com'), false);
  });

  void it('should match wildcards at start', () => {
    assert.equal(matchesWildcard('logo.png', '*.png'), true);
    assert.equal(matchesWildcard('images/logo.png', '*.png'), true);
    assert.equal(matchesWildcard('logo.jpg', '*.png'), false);
  });

  void it('should match wildcards at end', () => {
    assert.equal(matchesWildcard('api.example.com', 'api.*'), true);
    assert.equal(matchesWildcard('api.test.com', 'api.*'), true);
    assert.equal(matchesWildcard('cdn.example.com', 'api.*'), false);
  });

  void it('should match wildcards in middle', () => {
    assert.equal(matchesWildcard('analytics.google.com', '*analytics*'), true);
    assert.equal(matchesWildcard('google-analytics.com', '*analytics*'), true);
    assert.equal(matchesWildcard('example.com/api/users', '*/api/*'), true);
    assert.equal(matchesWildcard('example.com/v1/data', '*/api/*'), false);
  });

  void it('should be case-insensitive', () => {
    // codeql[js/incomplete-hostname-regexp] - These are test data strings for wildcard matching, not regex patterns
    assert.equal(matchesWildcard('API.EXAMPLE.COM', 'api.example.com'), true);
    assert.equal(matchesWildcard('api.example.com', 'API.EXAMPLE.COM'), true);
    assert.equal(matchesWildcard('Logo.PNG', '*.png'), true);
  });

  void it('should match multiple wildcards', () => {
    assert.equal(matchesWildcard('api.example.com/users', '*api*/*'), true);
    assert.equal(matchesWildcard('example.com/api/users', '*/api/*'), true);
    assert.equal(matchesWildcard('example.com/v1/data', '*example*/v1/*'), true);
  });

  void it('should match empty pattern', () => {
    assert.equal(matchesWildcard('anything', ''), false);
    assert.equal(matchesWildcard('', ''), true);
  });

  void it('should match just wildcard', () => {
    assert.equal(matchesWildcard('anything', '*'), true);
    assert.equal(matchesWildcard('', '*'), true);
  });
});

void describe('filters - shouldFetchBody', () => {
  void it('should fetch bodies by default', () => {
    assert.equal(shouldFetchBody('https://api.example.com/users', 'application/json'), true);
    assert.equal(shouldFetchBody('https://example.com/app.js', 'application/javascript'), true);
  });

  void it('should skip bodies matching DEFAULT_SKIP_BODY_PATTERNS', () => {
    // Images
    assert.equal(shouldFetchBody('https://example.com/logo.png', 'image/png'), false);
    assert.equal(shouldFetchBody('https://example.com/photo.jpg', 'image/jpeg'), false);
    assert.equal(shouldFetchBody('https://example.com/icon.svg', 'image/svg+xml'), false);

    // Fonts
    assert.equal(shouldFetchBody('https://example.com/font.woff2', 'font/woff2'), false);
    assert.equal(shouldFetchBody('https://example.com/font.ttf', 'font/ttf'), false);

    // CSS
    assert.equal(shouldFetchBody('https://example.com/styles.css', 'text/css'), false);

    // Source maps
    assert.equal(shouldFetchBody('https://example.com/app.js.map', 'application/json'), false);
    assert.equal(shouldFetchBody('https://example.com/styles.css.map', 'application/json'), false);
  });

  void it('should respect includePatterns (trumps exclude and defaults)', () => {
    const options = {
      includePatterns: ['*/api/*'],
      excludePatterns: ['*example.com*'],
    };

    // Include pattern matches, so fetch despite exclude pattern
    assert.equal(
      shouldFetchBody('https://example.com/api/users', 'application/json', options),
      true
    );

    // Include pattern matches, so fetch despite default skip pattern
    const optionsWithImage = {
      includePatterns: ['*.png'],
    };
    assert.equal(
      shouldFetchBody('https://example.com/logo.png', 'image/png', optionsWithImage),
      true
    );
  });

  void it('should treat includePatterns as whitelist (skip non-matching URLs)', () => {
    const options = {
      includePatterns: ['*/api/*', '*/graphql'],
    };

    // Matches include pattern → fetch
    assert.equal(
      shouldFetchBody('https://example.com/api/users', 'application/json', options),
      true
    );
    assert.equal(shouldFetchBody('https://example.com/graphql', 'application/json', options), true);

    // Doesn't match include pattern → skip (whitelist mode)
    assert.equal(
      shouldFetchBody('https://example.com/app.js', 'application/javascript', options),
      false
    );
    assert.equal(shouldFetchBody('https://example.com/index.html', 'text/html', options), false);
    assert.equal(
      shouldFetchBody('https://example.com/data.json', 'application/json', options),
      false
    );
  });

  void it('should respect excludePatterns', () => {
    const options = {
      excludePatterns: ['*tracking*', '*analytics*'],
    };

    assert.equal(
      shouldFetchBody('https://tracking.example.com/collect', 'application/json', options),
      false
    );
    assert.equal(
      shouldFetchBody('https://analytics.example.com/event', 'application/json', options),
      false
    );
    assert.equal(
      shouldFetchBody('https://api.example.com/users', 'application/json', options),
      true
    );
  });

  void it('should respect fetchAllBodies flag', () => {
    const options = {
      fetchAllBodies: true,
    };

    // Fetch even images when fetchAllBodies is true
    assert.equal(shouldFetchBody('https://example.com/logo.png', 'image/png', options), true);
    assert.equal(shouldFetchBody('https://example.com/styles.css', 'text/css', options), true);
    assert.equal(
      shouldFetchBody('https://example.com/app.js.map', 'application/json', options),
      true
    );
  });

  void it('should combine patterns with correct precedence: include > exclude > fetchAllBodies > defaults', () => {
    // Include trumps everything
    assert.equal(
      shouldFetchBody('https://example.com/logo.png', 'image/png', {
        includePatterns: ['*.png'],
        excludePatterns: ['*example.com*'],
        fetchAllBodies: false,
      }),
      true
    );

    // Exclude trumps fetchAllBodies and defaults
    assert.equal(
      shouldFetchBody('https://tracking.com/pixel.png', 'image/png', {
        excludePatterns: ['*tracking*'],
        fetchAllBodies: true,
      }),
      false
    );

    // fetchAllBodies trumps defaults
    assert.equal(
      shouldFetchBody('https://example.com/logo.png', 'image/png', {
        fetchAllBodies: true,
      }),
      true
    );

    // Defaults apply when no options
    assert.equal(shouldFetchBody('https://example.com/logo.png', 'image/png'), false);
  });
});

void describe('filters - shouldExcludeUrl', () => {
  void it('should not exclude by default', () => {
    assert.equal(shouldExcludeUrl('https://api.example.com/users'), false);
    assert.equal(shouldExcludeUrl('https://example.com/logo.png'), false);
  });

  void it('should respect includePatterns (trumps exclude)', () => {
    const options = {
      includePatterns: ['api.example.com'],
      excludePatterns: ['*example.com*'],
    };

    // Include pattern matches, so don't exclude despite exclude pattern
    assert.equal(shouldExcludeUrl('https://api.example.com/users', options), false);

    // Exclude pattern matches but no include match (includePatterns act as whitelist)
    assert.equal(shouldExcludeUrl('https://cdn.example.com/logo.png', options), true);

    // Neither pattern matches (includePatterns act as whitelist, so exclude)
    assert.equal(shouldExcludeUrl('https://other.com/data', options), true);
  });

  void it('should respect excludePatterns', () => {
    const options = {
      excludePatterns: ['*analytics*', '*tracking*', '*ads*'],
    };

    assert.equal(shouldExcludeUrl('https://analytics.google.com/collect', options), true);
    assert.equal(shouldExcludeUrl('https://tracking.example.com/pixel', options), true);
    assert.equal(shouldExcludeUrl('https://ads.example.com/banner', options), true);
    assert.equal(shouldExcludeUrl('https://api.example.com/users', options), false);
  });

  void it('should match bare hostname patterns without requiring wildcards', () => {
    const options = {
      includePatterns: ['api.example.com'],
    };

    // Should match all URLs on api.example.com regardless of path
    assert.equal(shouldExcludeUrl('https://api.example.com/users', options), false);
    assert.equal(shouldExcludeUrl('https://api.example.com/posts', options), false);
    assert.equal(shouldExcludeUrl('https://api.example.com/', options), false);

    // Should not match other hosts
    assert.equal(shouldExcludeUrl('https://cdn.example.com/users', options), true);
  });
});

void describe('filters - shouldExcludeDomain', () => {
  void it('should not exclude by default when includeAll is true', () => {
    assert.equal(shouldExcludeDomain('https://analytics.google.com/collect', true), false);
    assert.equal(shouldExcludeDomain('https://facebook.com/tracking', true), false);
  });

  void it('should exclude DEFAULT_EXCLUDED_DOMAINS', () => {
    // Sample from DEFAULT_EXCLUDED_DOMAINS
    assert.equal(shouldExcludeDomain('https://analytics.google.com/collect'), true);
    assert.equal(shouldExcludeDomain('https://googletagmanager.com/gtm.js'), true);
    assert.equal(shouldExcludeDomain('https://facebook.com/tracking'), true);
    assert.equal(shouldExcludeDomain('https://doubleclick.net/ads'), true);
    assert.equal(shouldExcludeDomain('https://fullstory.com/rec'), true);
  });

  void it('should not exclude non-tracking domains', () => {
    assert.equal(shouldExcludeDomain('https://api.example.com/users'), false);
    assert.equal(shouldExcludeDomain('https://cdn.example.com/app.js'), false);
    assert.equal(shouldExcludeDomain('https://example.com/'), false);
  });

  void it('should handle subdomains correctly', () => {
    // Should match if domain is contained in hostname
    assert.equal(shouldExcludeDomain('https://www.analytics.google.com/collect'), true);
    assert.equal(shouldExcludeDomain('https://subdomain.facebook.com/pixel'), true);
  });
});

void describe('filters - shouldExcludeConsoleMessage', () => {
  void it('should not exclude by default when includeAll is true', () => {
    assert.equal(
      shouldExcludeConsoleMessage('webpack-dev-server: Hot Module Replacement', true),
      false
    );
    assert.equal(shouldExcludeConsoleMessage('[HMR] Waiting for update signal', true), false);
  });

  void it('should exclude DEFAULT_EXCLUDED_CONSOLE_PATTERNS', () => {
    assert.equal(shouldExcludeConsoleMessage('webpack-dev-server: Hot Module Replacement'), true);
    assert.equal(shouldExcludeConsoleMessage('[HMR] Waiting for update signal from WDS...'), true);
    assert.equal(shouldExcludeConsoleMessage('[WDS] Live Reloading enabled.'), true);
    assert.equal(
      shouldExcludeConsoleMessage(
        'Download the React DevTools for a better development experience'
      ),
      true
    );
  });

  void it('should not exclude non-dev-server messages', () => {
    assert.equal(shouldExcludeConsoleMessage('User clicked button'), false);
    assert.equal(shouldExcludeConsoleMessage('API request failed'), false);
    assert.equal(shouldExcludeConsoleMessage('Error: Invalid input'), false);
  });

  void it('should be case-insensitive', () => {
    assert.equal(shouldExcludeConsoleMessage('WEBPACK-DEV-SERVER: Hot Module Replacement'), true);
    assert.equal(shouldExcludeConsoleMessage('[hmr] waiting for update signal'), true);
  });
});

void describe('filters - constants', () => {
  void it('DEFAULT_SKIP_BODY_PATTERNS should include common asset patterns', () => {
    // Verify key patterns exist
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.png'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.jpg'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.woff2'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.css'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.map'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.js.map'));
    assert.ok(DEFAULT_SKIP_BODY_PATTERNS.includes('*.css.map'));
  });

  void it('DEFAULT_EXCLUDED_DOMAINS should include common tracking domains', () => {
    // Verify key domains exist
    // codeql[js/incomplete-url-substring-sanitization] - These are literal string lookups in a constant array, not URL validation
    assert.ok(DEFAULT_EXCLUDED_DOMAINS.includes('analytics.google.com'));
    assert.ok(DEFAULT_EXCLUDED_DOMAINS.includes('googletagmanager.com'));
    assert.ok(DEFAULT_EXCLUDED_DOMAINS.includes('facebook.com'));
    assert.ok(DEFAULT_EXCLUDED_DOMAINS.includes('doubleclick.net'));
  });

  void it('DEFAULT_EXCLUDED_CONSOLE_PATTERNS should include dev server noise', () => {
    // Verify key patterns exist
    assert.ok(DEFAULT_EXCLUDED_CONSOLE_PATTERNS.includes('webpack-dev-server'));
    assert.ok(DEFAULT_EXCLUDED_CONSOLE_PATTERNS.includes('[HMR]'));
    assert.ok(DEFAULT_EXCLUDED_CONSOLE_PATTERNS.includes('[WDS]'));
  });
});
