/**
 * HAR `response.bodySize` smoke test (#796).
 *
 * `bodySize` is the body as received (content encoding kept), without the
 * headers that `headersSize` counts. A local server answers `/plain` (700
 * bytes) and `/gzip` (a gzip body) with their `Content-Length`; the export
 * must give `bodySize` equal to it within `FRAMING_SLACK` bytes. The slack
 * covers what Chrome counts in `encodedDataLength` besides the body when it
 * sends no `encodedBodyLength` (chunk framing, and the difference between the
 * real header bytes and the HAR's estimate of them).
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  GZIP_BODY,
  GZIP_DECODED_LENGTH,
  PLAIN_LENGTH,
  startEncodedBodyServer,
  type EncodedBodyServer,
} from '@/__testutils__/encodedBodyServer.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Bytes `bodySize` may differ from `Content-Length` */
const FRAMING_SLACK = 64;

interface HarEntry {
  request: { url: string };
  response: { headersSize: number; bodySize: number; content: { size: number } };
}

/**
 * Export the HAR and return the entry of one path.
 *
 * @param route - Path of the request
 * @returns Its HAR entry
 */
async function harEntry(route: string): Promise<HarEntry> {
  const file = path.join(makeTempDir('bdg-har-'), 'out.har');
  const result = await runCommand('network', ['har', file, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, `HAR failed: ${result.stderr}`);
  const har = JSON.parse(fs.readFileSync(file, 'utf8')) as { log: { entries: HarEntry[] } };
  const entry = har.log.entries.find((e) => new URL(e.request.url).pathname === route);
  assert.ok(entry, `no HAR entry for ${route}`);
  return entry;
}

/** Wait until the page has fetched both bodies (its title becomes `done`). */
async function waitForDone(): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const title = await runCommand('eval', ['document.title', '--json'], {
      timeout: 30000,
    });
    if (title.stdout.includes('"done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the page did not finish its requests');
}

after(removeTempDirs);

void describe('HAR response bodySize', () => {
  let server: EncodedBodyServer;

  before(async () => {
    await cleanupAllSessions();
    server = await startEncodedBodyServer();
    const port = await getFreePort();
    const result = await runCommand(server.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await waitForDone();
  });

  after(async () => {
    await cleanupAllSessions();
    await server.close();
  });

  void it('plain body: bodySize is Content-Length, not the bytes with headers', async () => {
    const { response } = await harEntry('/plain');
    console.log('plain', response);
    assert.ok(
      Math.abs(response.bodySize - PLAIN_LENGTH) <= FRAMING_SLACK,
      `bodySize ${response.bodySize} vs Content-Length ${PLAIN_LENGTH}`
    );
    assert.ok(
      response.bodySize < PLAIN_LENGTH + response.headersSize,
      `bodySize ${response.bodySize} includes the ${response.headersSize} header bytes`
    );
  });

  void it('gzip body: bodySize is the compressed Content-Length, content.size the decoded one', async () => {
    const { response } = await harEntry('/gzip');
    console.log('gzip', response);
    assert.ok(
      Math.abs(response.bodySize - GZIP_BODY.length) <= FRAMING_SLACK,
      `${response.bodySize} vs ${GZIP_BODY.length}`
    );
    assert.equal(response.content.size, GZIP_DECODED_LENGTH);
  });
});
