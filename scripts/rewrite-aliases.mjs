#!/usr/bin/env node
/**
 * Rewrites `@/` path aliases in compiled output to relative specifiers.
 *
 * Replaces tsc-alias (whose chokidar/globby dependency chain pulls in a
 * vulnerable, unpatched `braces`). `@/a/b.js` becomes `../a/b.js`; specifiers
 * already carry extensions because tsconfig uses `nodenext` resolution.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const ALIAS_PATTERN = /((?:from|import)\s*\(?\s*)(['"])@\/([^'"]+)\2/g;

/**
 * Rewrites all alias specifiers in a single file, writing only when changed.
 *
 * @param file - Absolute path to a compiled file
 */
function rewriteFile(file) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(ALIAS_PATTERN, (_match, prefix, quote, target) => {
    let specifier = relative(dirname(file), join(DIST, target));
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    return `${prefix}${quote}${specifier}${quote}`;
  });
  if (rewritten !== source) writeFileSync(file, rewritten);
}

for (const entry of readdirSync(DIST, { recursive: true })) {
  if (/\.(?:js|d\.ts)$/.test(entry)) rewriteFile(join(DIST, entry));
}
