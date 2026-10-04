/**
 * How the last session ended, when it did not end by `bdg stop`: kept so
 * `bdg status` can explain why there is no session any more.
 */

import * as fs from 'fs';

import { getSessionFilePath } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** Why a session ended without `bdg stop` */
export type UnexpectedEndReason = 'crash' | 'closed' | 'timeout';

/** Record of the last session's unexpected end */
export interface LastSessionEnd {
  reason: UnexpectedEndReason;
  /** Epoch ms */
  endedAt: number;
}

/**
 * Record how the session ended.
 *
 * @param reason - Why it ended
 */
export function writeLastSessionEnd(reason: UnexpectedEndReason): void {
  try {
    AtomicFileWriter.writeSync(
      getSessionFilePath('LAST_SESSION'),
      JSON.stringify({ reason, endedAt: Date.now() })
    );
  } catch (error) {
    log.debug(`Could not record how the session ended: ${getErrorMessage(error)}`);
  }
}

/**
 * Forget the last session's end (a new session is starting, or `cleanup` ran).
 */
export function clearLastSessionEnd(): void {
  fs.rmSync(getSessionFilePath('LAST_SESSION'), { force: true });
}

/**
 * How the last session ended, if it ended unexpectedly.
 *
 * @returns The record, or null
 */
export function readLastSessionEnd(): LastSessionEnd | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(getSessionFilePath('LAST_SESSION'), 'utf8')
    ) as LastSessionEnd;
    return typeof data.endedAt === 'number' ? data : null;
  } catch (error) {
    log.debug(`No record of the last session's end: ${getErrorMessage(error)}`);
    return null;
  }
}
