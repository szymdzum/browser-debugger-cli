/**
 * Which iframe a `bdg dom eval --frame` value names.
 */

import { CommandError } from '@/errors/index.js';
import {
  ambiguousFrameError,
  emptyFrameError,
  frameNotFoundError,
  staleFrameIndexError,
} from '@/errors/messages.js';
import type { DomFrame } from '@/ipc/protocol/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Pick the frame a `--frame` value names: a 0-based index, an exact `name`
 * or `id` attribute, or else a case-insensitive part of the name, id or URL.
 *
 * @param frames - Frames of the page
 * @param query - Requested frame
 * @returns The matching frame
 * @throws CommandError (81) when empty or ambiguous, (83) when nothing matches
 */
export function selectFrame(frames: DomFrame[], query: string): DomFrame {
  const wanted = query.trim();
  if (!wanted) throw frameError(emptyFrameError(), EXIT_CODES.INVALID_ARGUMENTS);
  return single(frames, wanted, candidatesFor(frames, wanted));
}

/**
 * Check that a `--frame` index still names the frame the last
 * `bdg dom frames` listed at that index (frames added, removed or
 * reordered since shift the indices; a navigation replaces every frame).
 *
 * @param query - Requested frame
 * @param currentIds - Frame id of each frame now, by index
 * @param listedIds - Frame id of each frame when last listed, undefined when never listed
 * @throws CommandError (87) when the index names another frame (or none) now
 */
export function assertFrameIndexCurrent(
  query: string,
  currentIds: string[],
  listedIds: string[] | undefined
): void {
  const wanted = query.trim();
  if (!listedIds || !/^\d+$/.test(wanted)) return;
  const index = Number(wanted);
  if (currentIds[index] === listedIds[index]) return;
  throw frameError(staleFrameIndexError(index), EXIT_CODES.STALE_CACHE);
}

/**
 * Frames a non-empty `--frame` value matches, by the first rule that applies.
 *
 * @param frames - Frames of the page
 * @param wanted - Requested frame, trimmed
 * @returns Matching frames
 */
function candidatesFor(frames: DomFrame[], wanted: string): DomFrame[] {
  if (/^\d+$/.test(wanted)) return frames.filter((frame) => frame.index === Number(wanted));
  const named = frames.filter((frame) => frame.name === wanted || frame.id === wanted);
  if (named.length > 0) return named;
  const needle = wanted.toLowerCase();
  return frames.filter((frame) =>
    [frame.name, frame.id, frame.url].some((text) => text?.toLowerCase().includes(needle))
  );
}

/**
 * The only candidate, or an error listing the frames.
 *
 * @param frames - All frames (listed when nothing matches)
 * @param query - Requested frame
 * @param candidates - Matching frames
 * @returns The candidate
 * @throws CommandError (81) for several candidates, (83) for none
 */
function single(frames: DomFrame[], query: string, candidates: DomFrame[]): DomFrame {
  const [first] = candidates;
  if (candidates.length > 1) {
    throw frameError(ambiguousFrameError(query, candidates), EXIT_CODES.INVALID_ARGUMENTS);
  }
  if (!first) throw frameError(frameNotFoundError(query, frames), EXIT_CODES.RESOURCE_NOT_FOUND);
  return first;
}

/**
 * Build a CommandError from a message and suggestion.
 *
 * @param err - Message and suggestion
 * @param exitCode - Exit code
 * @returns The error
 */
export function frameError(
  err: { message: string; suggestion: string },
  exitCode: number
): CommandError {
  return new CommandError(err.message, { suggestion: err.suggestion }, exitCode);
}
