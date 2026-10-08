/**
 * Download tracking: where a session's downloads go, and what became of them.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { CDPConnection } from '@/connection/cdp.js';
import type { DownloadInfo, DownloadState } from '@/ipc/protocol/domTypes.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('downloads');

/** Name given to a download whose suggested name is not a usable file name */
const FALLBACK_FILE_NAME = 'download';

/** A download the session saw begin, with Chrome's id for it */
export interface TrackedDownload extends DownloadInfo {
  guid: string;
}

/**
 * Where a session's downloads go: a directory bdg chose (a Chrome bdg
 * launched), wherever the browser puts them (an attached Chrome), or nowhere
 * (bdg's directory could not be created: refusing beats saving them to
 * `~/Downloads`), with why
 */
export type DownloadDestination =
  { kind: 'directory'; dir: string } | { kind: 'browser' } | { kind: 'refused'; reason: string };

/** `Browser.downloadWillBegin` parameters bdg reads */
interface DownloadWillBegin {
  guid: string;
  url: string;
  suggestedFilename: string;
}

/** `Browser.downloadProgress` parameters bdg reads */
interface DownloadProgress {
  guid: string;
  receivedBytes: number;
  state: DownloadState;
  filePath?: string;
}

/** Paths chosen for downloads still running, by {@link reservationKey} */
type Reservations = Set<string>;

/**
 * Track the session's downloads.
 *
 * In a directory, Chrome saves each download under its id (`allowAndName`),
 * and the file is renamed to the suggested name once complete; the name is
 * chosen when the download begins (`report (1).txt` when `report.txt` exists
 * or was chosen for another), so a download still running already reports
 * where it will be. In the browser's place, its own download settings stay
 * and only its events are enabled. Refused downloads are canceled by Chrome
 * and recorded with the reason.
 *
 * Send this on a browser-level connection: download events of other tabs
 * (`target=_blank` links, `window.open()`) do not reach a page's session,
 * though the download behavior applies to them.
 *
 * @param cdp - CDP connection (browser-level when possible)
 * @param downloads - Session list receiving each download, updated as it progresses
 * @param destination - Where downloads go
 * @returns Cleanup function removing the event handlers
 */
export async function startDownloadTracking(
  cdp: CDPConnection,
  downloads: TrackedDownload[],
  destination: DownloadDestination
): Promise<CleanupFunction> {
  await setDownloadBehavior(cdp, destination);
  const reserved: Reservations = new Set();
  const dir = destination.kind === 'directory' ? destination.dir : undefined;
  const cleanups = [
    cdp.on<DownloadWillBegin>('Browser.downloadWillBegin', ({ guid, url, suggestedFilename }) => {
      const target = dir && reserveDownloadPath(dir, suggestedFilename, reserved);
      downloads.push({
        guid,
        url,
        suggestedFilename,
        state: 'inProgress',
        ...(target && { path: target }),
      });
    }),
    cdp.on<DownloadProgress>('Browser.downloadProgress', (progress) => {
      const download = downloads.findLast((entry) => entry.guid === progress.guid);
      if (download?.state !== 'inProgress') return;
      updateDownload(download, progress, destination, reserved);
    }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * A tracked download as commands report it, as it is now.
 *
 * @param download - Tracked download
 * @returns Copy without Chrome's id
 */
export function toDownloadInfo(download: TrackedDownload): DownloadInfo {
  const { url, suggestedFilename, path: file, state, bytes, reason } = download;
  return {
    url,
    suggestedFilename,
    ...(file !== undefined && { path: file }),
    state,
    ...(bytes !== undefined && { bytes }),
    ...(reason !== undefined && { reason }),
  };
}

/**
 * Set the browser's download behavior for the destination and enable
 * download events. A failure is logged: the session works without it, but
 * downloads then go where the browser puts them.
 *
 * @param cdp - CDP connection
 * @param destination - Where downloads go
 */
async function setDownloadBehavior(
  cdp: CDPConnection,
  destination: DownloadDestination
): Promise<void> {
  const behavior =
    destination.kind === 'directory'
      ? { behavior: 'allowAndName', downloadPath: destination.dir }
      : { behavior: destination.kind === 'refused' ? 'deny' : 'default' };
  try {
    await cdp.send('Browser.setDownloadBehavior', { ...behavior, eventsEnabled: true });
  } catch (error) {
    log.info(`Downloads are not tracked: ${getErrorMessage(error)}`);
  }
}

/**
 * Apply a progress event: bytes so far, then the final state; a completed
 * download in bdg's directory is renamed from its id to its chosen name.
 *
 * @param download - Download being updated
 * @param progress - Progress event
 * @param destination - Where downloads go
 * @param reserved - Paths chosen for downloads still running
 */
function updateDownload(
  download: TrackedDownload,
  progress: DownloadProgress,
  destination: DownloadDestination,
  reserved: Reservations
): void {
  download.bytes = progress.receivedBytes;
  if (progress.state === 'inProgress') return;
  if (download.path) reserved.delete(reservationKey(download.path));
  if (progress.state === 'canceled') {
    delete download.path;
    if (destination.kind === 'refused') download.reason = destination.reason;
  } else if (destination.kind === 'directory') {
    download.path = saveUnderChosenName(destination.dir, download, reserved);
  } else if (progress.filePath) {
    download.path = progress.filePath;
  }
  download.state = progress.state;
}

/**
 * Rename a completed download from its id to the name chosen for it (another
 * one when a file took that name meanwhile).
 *
 * @param downloadDir - Directory downloads are saved into
 * @param download - Completed download
 * @param reserved - Paths chosen for downloads still running
 * @returns Path of the file: the chosen one, or its id's when renaming failed
 */
function saveUnderChosenName(
  downloadDir: string,
  download: TrackedDownload,
  reserved: Reservations
): string {
  const saved = path.join(downloadDir, download.guid);
  const chosen =
    download.path && !fs.existsSync(download.path)
      ? download.path
      : reserveDownloadPath(downloadDir, download.suggestedFilename, reserved);
  reserved.delete(reservationKey(chosen));
  try {
    fs.renameSync(saved, chosen);
    return chosen;
  } catch (error) {
    log.debug(`Download ${download.guid} kept under its id: ${getErrorMessage(error)}`);
    return saved;
  }
}

/**
 * Key of a reserved path: lowercased, so `Report.txt` and `report.txt` do not
 * both get chosen on a case-insensitive file system (macOS, Windows).
 *
 * @param file - Path
 * @returns Key
 */
function reservationKey(file: string): string {
  return file.toLowerCase();
}

/**
 * Choose a free path for a download: its suggested name, or with ` (1)`,
 * ` (2)`… before the extension when a file or another running download has
 * that name.
 *
 * @param downloadDir - Directory downloads are saved into
 * @param suggestedFilename - Name the page or server suggested
 * @param reserved - Paths chosen for downloads still running (the result is added)
 * @returns Absolute path
 */
export function reserveDownloadPath(
  downloadDir: string,
  suggestedFilename: string,
  reserved: Reservations
): string {
  const name = safeFileName(suggestedFilename);
  const { name: stem, ext } = path.parse(name);
  for (let copy = 0; ; copy++) {
    const candidate = path.join(downloadDir, copy === 0 ? name : `${stem} (${copy})${ext}`);
    if (reserved.has(reservationKey(candidate)) || fs.existsSync(candidate)) continue;
    reserved.add(reservationKey(candidate));
    return candidate;
  }
}

/**
 * A suggested file name reduced to a name in the download directory.
 *
 * @param suggestedFilename - Name the page or server suggested
 * @returns Its last path segment, or {@link FALLBACK_FILE_NAME} when that is empty, `.` or `..`
 */
function safeFileName(suggestedFilename: string): string {
  const name = path.basename(suggestedFilename.replaceAll('\\', '/'));
  return name === '' || name === '.' || name === '..' ? FALLBACK_FILE_NAME : name;
}
