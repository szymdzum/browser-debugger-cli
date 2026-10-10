/**
 * HTML pages the fixture server serves by path, collected from every module
 * in `fixturePages/`.
 *
 * Each module there exports `ROUTES: FixtureRoutes` (path → HTML, answered
 * 200 `text/html`) and documents its pages. Adding a module is enough for the
 * server to serve it: nothing in `fixtureServer.ts` lists them, so PRs that
 * add fixture pages don't touch a shared file. A module without `ROUTES`, a
 * non-string page or a path two modules claim fails the server start.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/** Pages of one module by path */
export type FixtureRoutes = Readonly<Record<string, string>>;

const PAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixturePages');

/** Source modules under tsx, compiled ones in `dist` (not their `.d.ts`) */
const PAGE_MODULE = /^(?!.*\.d\.ts$).*\.(ts|js)$/;

let loaded: Promise<ReadonlyMap<string, string>> | undefined;

/**
 * Check that a module's export is a path → HTML table.
 *
 * @param file - Module file name, for the error
 * @param routes - Its `ROUTES` export
 * @returns The table
 */
function checkRoutes(file: string, routes: unknown): FixtureRoutes {
  if (typeof routes !== 'object' || routes === null) {
    throw new Error(`fixturePages/${file} must export ROUTES: FixtureRoutes`);
  }
  for (const [route, html] of Object.entries(routes)) {
    if (!route.startsWith('/') || typeof html !== 'string') {
      throw new Error(`fixturePages/${file}: ${route} must be a path with an HTML string`);
    }
  }
  return routes as FixtureRoutes;
}

/**
 * Import every page module, in file name order, and merge their tables.
 *
 * @returns HTML by path
 */
async function importRoutes(): Promise<ReadonlyMap<string, string>> {
  const files = fs
    .readdirSync(PAGES_DIR)
    .filter((file) => PAGE_MODULE.test(file))
    .sort();
  const routes = new Map<string, string>();
  for (const file of files) {
    const module = (await import(pathToFileURL(path.join(PAGES_DIR, file)).href)) as {
      ROUTES?: unknown;
    };
    for (const [route, html] of Object.entries(checkRoutes(file, module.ROUTES))) {
      if (routes.has(route)) throw new Error(`fixturePages/${file}: ${route} is served twice`);
      routes.set(route, html);
    }
  }
  return routes;
}

/**
 * Pages of every module in `fixturePages/`, loaded once per process.
 *
 * @returns HTML by path
 */
export function loadFixtureRoutes(): Promise<ReadonlyMap<string, string>> {
  loaded ??= importRoutes();
  return loaded;
}
