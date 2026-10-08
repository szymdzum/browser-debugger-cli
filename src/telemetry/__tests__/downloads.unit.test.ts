/**
 * Download tracking: where downloads are saved, the names they get, and how
 * their progress is recorded.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import type { CDPConnection } from '@/connection/cdp.js';
import {
  reserveDownloadPath,
  startDownloadTracking,
  toDownloadInfo,
  type TrackedDownload,
} from '@/telemetry/downloads.js';
import { downloadText } from '@/ui/messages/commands.js';

/** CDP connection mock that records commands and emits events. */
class MockCDP {
  readonly sent: Array<{ method: string; params: unknown }> = [];
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  /**
   * Record a command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns Empty result
   */
  send(method: string, params?: unknown): Promise<unknown> {
    this.sent.push({ method, params });
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event.
   *
   * @param event - CDP event
   * @param handler - Handler
   * @returns Unsubscribe function
   */
  on(event: string, handler: (params: unknown) => void): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => list.splice(list.indexOf(handler), 1);
  }

  /**
   * Emit an event.
   *
   * @param event - CDP event
   * @param params - Event params
   */
  emit(event: string, params: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(params));
  }

  /**
   * Begin a download.
   *
   * @param guid - Download id
   * @param suggestedFilename - Suggested name
   */
  begin(guid: string, suggestedFilename: string): void {
    this.emit('Browser.downloadWillBegin', {
      guid,
      url: `http://example.test/${guid}`,
      suggestedFilename,
    });
  }

  /**
   * Report a download's progress.
   *
   * @param guid - Download id
   * @param state - Its state
   * @param receivedBytes - Bytes so far
   */
  progress(guid: string, state: string, receivedBytes: number): void {
    this.emit('Browser.downloadProgress', { guid, state, receivedBytes, totalBytes: 15 });
  }
}

after(removeTempDirs);

void describe('startDownloadTracking', () => {
  void it('saves into the download directory and renames a completed download', async () => {
    const dir = makeTempDir('bdg-downloads-');
    const cdp = new MockCDP();
    const downloads: TrackedDownload[] = [];
    await startDownloadTracking(cdp as unknown as CDPConnection, downloads, dir);
    assert.deepEqual(cdp.sent, [
      {
        method: 'Browser.setDownloadBehavior',
        params: { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true },
      },
    ]);

    cdp.begin('g1', 'report.txt');
    cdp.progress('g1', 'inProgress', 0);
    const [download] = downloads;
    assert.ok(download);
    assert.deepEqual(toDownloadInfo(download), {
      url: 'http://example.test/g1',
      suggestedFilename: 'report.txt',
      path: path.join(dir, 'report.txt'),
      state: 'inProgress',
      bytes: 0,
    });
    fs.writeFileSync(path.join(dir, 'g1'), 'fifteen bytes!!');
    cdp.progress('g1', 'completed', 15);

    assert.equal(downloads[0]?.state, 'completed');
    assert.equal(fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'), 'fifteen bytes!!');
    assert.equal(fs.existsSync(path.join(dir, 'g1')), false);
  });

  void it('gives downloads running at once different names, and frees a canceled one', async () => {
    const dir = makeTempDir('bdg-downloads-');
    fs.writeFileSync(path.join(dir, 'a.zip'), 'older');
    const cdp = new MockCDP();
    const downloads: TrackedDownload[] = [];
    await startDownloadTracking(cdp as unknown as CDPConnection, downloads, dir);

    cdp.begin('g1', 'a.zip');
    cdp.begin('g2', 'a.zip');
    cdp.progress('g1', 'canceled', 3);
    cdp.begin('g3', 'a.zip');

    assert.deepEqual(
      downloads.map((download) => download.path && path.basename(download.path)),
      [undefined, 'a (2).zip', 'a (1).zip']
    );
    assert.equal(downloads[0]?.state, 'canceled');
  });

  void it('reports the id path when the completed file cannot be renamed', async () => {
    const dir = makeTempDir('bdg-downloads-');
    const cdp = new MockCDP();
    const downloads: TrackedDownload[] = [];
    await startDownloadTracking(cdp as unknown as CDPConnection, downloads, dir);

    cdp.begin('g1', 'gone.txt');
    cdp.progress('g1', 'completed', 4);

    assert.equal(downloads[0]?.path, path.join(dir, 'g1'));
  });

  void it("keeps an attached browser's download settings and reports where it saved", async () => {
    const cdp = new MockCDP();
    const downloads: TrackedDownload[] = [];
    await startDownloadTracking(cdp as unknown as CDPConnection, downloads, undefined);
    assert.deepEqual(cdp.sent[0]?.params, { behavior: 'default', eventsEnabled: true });

    cdp.begin('g1', 'report.txt');
    assert.equal(downloads[0]?.path, undefined);
    cdp.emit('Browser.downloadProgress', {
      guid: 'g1',
      state: 'completed',
      receivedBytes: 15,
      filePath: '/Users/me/Downloads/report.txt',
    });

    assert.equal(downloads[0]?.path, '/Users/me/Downloads/report.txt');
  });

  void it('keeps working when the browser refuses the download behavior', async () => {
    const cdp = new MockCDP();
    cdp.send = () => Promise.reject(new Error('Not allowed'));
    const downloads: TrackedDownload[] = [];
    await startDownloadTracking(cdp as unknown as CDPConnection, downloads, undefined);

    cdp.begin('g1', 'report.txt');
    assert.equal(downloads.length, 1);
  });
});

void describe('reserveDownloadPath', () => {
  void it('keeps a suggested name inside the download directory', () => {
    const dir = makeTempDir('bdg-downloads-');
    assert.equal(reserveDownloadPath(dir, '../../etc/passwd', new Set()), path.join(dir, 'passwd'));
    assert.equal(reserveDownloadPath(dir, 'a\\b.txt', new Set()), path.join(dir, 'b.txt'));
    assert.equal(reserveDownloadPath(dir, '..', new Set()), path.join(dir, 'download'));
    assert.equal(reserveDownloadPath(dir, '', new Set()), path.join(dir, 'download'));
  });
});

void describe('downloadText', () => {
  void it('says the name, path, state and size', () => {
    const download = { url: 'u', suggestedFilename: 'report.txt', path: '/d/report.txt' };
    assert.equal(
      downloadText({ ...download, state: 'completed', bytes: 15 }),
      'Download: report.txt → /d/report.txt (completed, 15 B)'
    );
    assert.equal(
      downloadText({ ...download, state: 'inProgress', bytes: 10000 }),
      'Download: report.txt → /d/report.txt (inProgress, 9.8 KB so far)'
    );
    assert.equal(
      downloadText({ ...download, state: 'inProgress', bytes: 0 }),
      'Download: report.txt → /d/report.txt (inProgress)'
    );
    assert.equal(
      downloadText({ url: 'u', suggestedFilename: 'report.txt', state: 'canceled' }),
      'Download: report.txt (canceled)'
    );
  });
});
