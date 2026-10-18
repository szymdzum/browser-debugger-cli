/**
 * Screenshot messages.
 */

/**
 * Note on a screenshot scaled down to keep its image token cost bounded.
 *
 * @param originalWidth - Captured width (CSS px)
 * @param originalHeight - Captured height
 * @param width - Image width
 * @param height - Image height
 * @param withHint - Add the way to full size (left out when the line already names `--no-resize`)
 * @returns e.g. `scaled from 1920×993 to 1568×811; --no-resize for full size`
 */
export function screenshotScaledNote(
  originalWidth: number,
  originalHeight: number,
  width: number,
  height: number,
  withHint = true
): string {
  const note = `scaled from ${originalWidth}×${originalHeight} to ${width}×${height}`;
  return withHint ? `${note}; --no-resize for full size` : note;
}

/**
 * Note on an element screenshot that captured more than the element's border
 * box, because content (floats, positioned children, text, shadows) overflows it.
 *
 * @param box - Border box
 * @param captured - Area captured
 * @param padding - `--padding` (px), which is not the element's own
 * @returns e.g. `grown from 940×37 to 940×285 to include what it paints outside its box (…)`
 */
export function screenshotGrownNote(
  box: { width: number; height: number },
  captured: { width: number; height: number },
  padding = 0
): string {
  const painted = { width: captured.width - 2 * padding, height: captured.height - 2 * padding };
  const grew = painted.width > box.width + 0.5 || painted.height > box.height + 0.5;
  const ink = `grown from ${box.width}×${box.height} to ${painted.width}×${painted.height} to include what it paints outside its box (overflowing content, shadows, outline)`;
  const pad = `${padding}px of page around it (--padding)`;
  if (!padding) return ink;
  return grew ? `${ink}, plus ${pad}` : `with ${pad}: ${captured.width}×${captured.height}`;
}

/**
 * Stop line of `dom screenshot --follow`, with the frame count pluralised.
 *
 * @param count - Frames captured
 * @returns The line printed on stderr when the sequence ends
 */
export function capturedFramesMessage(count: number): string {
  return `Captured ${count} ${count === 1 ? 'frame' : 'frames'}`;
}

/** What to run to capture the full page of a page too tall for a full-page capture */
export const FULL_PAGE_SKIPPED_HINT = '--no-resize captures the full page';
