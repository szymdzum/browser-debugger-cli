/**
 * Reusable test fixtures for benchmarking and integration tests.
 *
 * Provides route handlers and test data that simulate a realistic web application
 * with various content types for testing bdg's collection and optimization behavior.
 */

export interface RouteFixture {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  contentType: string;
  body: string | Buffer;
  statusCode?: number;
}

/**
 * Small JSON API response (~1KB)
 */
export const smallApiResponse: RouteFixture = {
  path: '/api/users',
  method: 'GET',
  contentType: 'application/json',
  body: JSON.stringify({
    users: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      role: i % 3 === 0 ? 'admin' : 'user',
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    })),
    total: 20,
    page: 1,
    pageSize: 20,
  }, null, 2),
};

/**
 * Large JSON API response (~500KB)
 */
export const largeApiResponse: RouteFixture = {
  path: '/api/analytics',
  method: 'GET',
  contentType: 'application/json',
  body: JSON.stringify({
    metrics: Array.from({ length: 1000 }, (_, i) => ({
      timestamp: Date.now() - i * 60000,
      pageViews: Math.floor(Math.random() * 1000),
      uniqueVisitors: Math.floor(Math.random() * 500),
      bounceRate: Math.random(),
      avgSessionDuration: Math.floor(Math.random() * 600),
      topPages: Array.from({ length: 10 }, (_, j) => ({
        url: `/page-${j}`,
        views: Math.floor(Math.random() * 100),
      })),
    })),
    summary: {
      totalPageViews: 50000,
      totalVisitors: 25000,
      avgBounceRate: 0.45,
    },
  }, null, 2),
};

/**
 * Simple HTML page
 */
export const htmlPage: RouteFixture = {
  path: '/',
  method: 'GET',
  contentType: 'text/html',
  body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benchmark Test Page</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="icon" href="/favicon.ico">
</head>
<body>
  <div id="app">
    <h1>Benchmark Test Page</h1>
    <p>This page is used for bdg performance benchmarking.</p>
    <div id="data-container"></div>
  </div>
  <script src="/app.js"></script>
  <script>
    console.log('Page loaded');

    // Simulate API call
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        console.log('Users loaded:', data.users.length);
        document.getElementById('data-container').textContent =
          'Loaded ' + data.users.length + ' users';
      })
      .catch(err => console.error('Failed to load users:', err));

    // Simulate analytics call
    fetch('/api/analytics')
      .then(r => r.json())
      .then(data => console.log('Analytics loaded:', data.metrics.length))
      .catch(err => console.error('Failed to load analytics:', err));
  </script>
</body>
</html>`,
};

/**
 * CSS file
 */
export const cssFile: RouteFixture = {
  path: '/styles.css',
  method: 'GET',
  contentType: 'text/css',
  body: `/* Benchmark test styles */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 20px;
  background: #f5f5f5;
}

#app {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 40px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

h1 {
  color: #333;
  margin-bottom: 20px;
}

#data-container {
  margin-top: 20px;
  padding: 15px;
  background: #e8f4f8;
  border-radius: 4px;
}`,
};

/**
 * JavaScript file
 */
export const jsFile: RouteFixture = {
  path: '/app.js',
  method: 'GET',
  contentType: 'application/javascript',
  body: `// Benchmark test application
(function() {
  'use strict';

  console.log('App initialized');

  function loadData() {
    console.log('Loading data...');
  }

  function handleError(error) {
    console.error('Application error:', error);
  }

  window.addEventListener('load', function() {
    console.log('Window loaded');
    loadData();
  });
})();
//# sourceMappingURL=/app.js.map`,
};

/**
 * Source map file
 */
export const sourceMapFile: RouteFixture = {
  path: '/app.js.map',
  method: 'GET',
  contentType: 'application/json',
  body: JSON.stringify({
    version: 3,
    sources: ['app.ts'],
    names: ['loadData', 'handleError'],
    mappings: 'AAAA,CAAC,YAAY,EAAE',
    file: 'app.js',
  }),
};

/**
 * Small PNG image (1x1 transparent pixel)
 */
export const pngImage: RouteFixture = {
  path: '/favicon.ico',
  method: 'GET',
  contentType: 'image/png',
  body: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  ),
};

/**
 * Font file placeholder
 */
export const fontFile: RouteFixture = {
  path: '/fonts/main.woff2',
  method: 'GET',
  contentType: 'font/woff2',
  body: Buffer.from('WOFF2 font data placeholder'),
};

/**
 * All fixtures as an array
 */
export const allFixtures: RouteFixture[] = [
  htmlPage,
  smallApiResponse,
  largeApiResponse,
  cssFile,
  jsFile,
  sourceMapFile,
  pngImage,
  fontFile,
];

/**
 * Expected behavior for each fixture when running with default optimization
 */
export const expectedBehavior = {
  '/': { shouldCapture: true, shouldFetchBody: true, reason: 'HTML page' },
  '/api/users': { shouldCapture: true, shouldFetchBody: true, reason: 'JSON API' },
  '/api/analytics': { shouldCapture: true, shouldFetchBody: true, reason: 'JSON API' },
  '/styles.css': { shouldCapture: true, shouldFetchBody: false, reason: 'CSS file (auto-skipped)' },
  '/app.js': { shouldCapture: true, shouldFetchBody: true, reason: 'JavaScript file' },
  '/app.js.map': { shouldCapture: true, shouldFetchBody: false, reason: 'Source map (auto-skipped)' },
  '/favicon.ico': { shouldCapture: true, shouldFetchBody: false, reason: 'Image (auto-skipped)' },
  '/fonts/main.woff2': { shouldCapture: true, shouldFetchBody: false, reason: 'Font (auto-skipped)' },
};
