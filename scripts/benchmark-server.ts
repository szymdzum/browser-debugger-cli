/**
 * Simple HTTP server for benchmarking bdg performance.
 *
 * Uses Node's built-in http module (no external dependencies) to serve test fixtures
 * that simulate a realistic web application with various content types.
 *
 * Can be used programmatically or run directly via tsx.
 */

import http from 'node:http';
import { allFixtures, type RouteFixture } from './benchmark-fixtures.js';

export interface BenchmarkServerOptions {
  port?: number;
  host?: string;
}

export interface BenchmarkServer {
  server: http.Server;
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the benchmark server.
 *
 * @param options - Server options
 * @returns Promise resolving to server instance with close method
 */
export async function startBenchmarkServer(
  options: BenchmarkServerOptions = {}
): Promise<BenchmarkServer> {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 0; // 0 = random available port

  // Build route lookup map for fast access
  const routeMap = new Map<string, RouteFixture>();
  allFixtures.forEach((fixture) => {
    routeMap.set(fixture.path, fixture);
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Log request for debugging
    console.error(`[benchmark-server] ${method} ${url}`);

    // Find matching route
    const route = routeMap.get(url);

    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (route.method !== method) {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // Serve the fixture
    const statusCode = route.statusCode ?? 200;
    res.writeHead(statusCode, {
      'Content-Type': route.contentType,
      'Content-Length': Buffer.byteLength(route.body),
      'Cache-Control': 'no-cache',
    });
    res.end(route.body);
  });

  // Start server and wait for it to be listening
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => {
      resolve();
    });
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get server address');
  }

  const actualPort = address.port;
  const url = `http://${host}:${actualPort}`;

  console.error(`[benchmark-server] Listening on ${url}`);
  console.error(`[benchmark-server] Routes available: ${allFixtures.map((f) => f.path).join(', ')}`);

  return {
    server,
    url,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.error('[benchmark-server] Closed');
            resolve();
          }
        });
      });
    },
  };
}

/**
 * Main entry point when run directly with tsx.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.argv[2] ? parseInt(process.argv[2]) : 3000;

  startBenchmarkServer({ port })
    .then((server) => {
      console.log(`Server running at ${server.url}`);
      console.log('Press Ctrl+C to stop');

      // Graceful shutdown on SIGINT/SIGTERM
      const shutdown = () => {
        console.log('\nShutting down...');
        server.close().then(() => {
          process.exit(0);
        }).catch((err) => {
          console.error('Error during shutdown:', err);
          process.exit(1);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
