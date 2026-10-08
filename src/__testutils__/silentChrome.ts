/**
 * A stand-in for Chrome that is very slow to start: it opens its debugging
 * port and announces it like Chrome (`DevTools listening on ...` on stderr),
 * but never answers HTTP requests on it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Write the stand-in Chrome as an executable script.
 *
 * @param dir - Directory for the script
 * @param readyFile - File the stand-in writes its PID to once it listens
 * @returns Path of the script, usable as `CHROME_PATH` or `chromePath`
 */
export function writeSilentChrome(dir: string, readyFile: string): string {
  const script = path.join(dir, 'silent-chrome');
  const source = [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const net = require('node:net');",
    "const flag = process.argv.find((arg) => arg.startsWith('--remote-debugging-port='));",
    "const port = Number(flag.split('=')[1]);",
    'net.createServer(() => {}).listen(port, "127.0.0.1", () => {',
    '  process.stderr.write(`DevTools listening on ws://127.0.0.1:${port}/devtools/browser/silent\\n`);',
    `  fs.writeFileSync(${JSON.stringify(readyFile)}, String(process.pid));`,
    '});',
  ].join('\n');
  fs.writeFileSync(script, source, { mode: 0o755 });
  return script;
}
