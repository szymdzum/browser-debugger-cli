/**
 * Screenshot resize utilities for Claude Vision optimization.
 *
 * Provides pure functions for calculating image dimensions, token costs,
 * and resize parameters based on Anthropic's Claude Vision recommendations.
 *
 * @see docs/CLAUDE_VISION_IMAGE_SIZING.md
 */

/**
 * Maximum edge length in pixels for auto-resize.
 * Based on Anthropic's Claude Vision recommendation of 1568px max edge.
 */
export const MAX_EDGE_PX = 1568;

/**
 * Pixels per token for Claude Vision token calculation.
 * Formula: tokens = (width × height) / PIXELS_PER_TOKEN
 */
export const PIXELS_PER_TOKEN = 750;

/**
 * Aspect ratio threshold for tall page detection.
 * Pages taller than this ratio will fallback to viewport capture.
 */
export const TALL_PAGE_THRESHOLD = 3;

/**
 * Calculate estimated token cost for image dimensions.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Estimated token count
 */
export function calculateImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / PIXELS_PER_TOKEN);
}

/**
 * Calculate scale factor to fit image within max edge constraint.
 *
 * @param width - Original width in pixels
 * @param height - Original height in pixels
 * @returns Scale factor (1.0 if no resize needed, <1.0 to shrink)
 */
export function calculateResizeScale(width: number, height: number): number {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= MAX_EDGE_PX) {
    return 1;
  }
  return MAX_EDGE_PX / longestEdge;
}

/**
 * Check if page is too tall for readable full-page capture.
 *
 * @param width - Page width in pixels
 * @param height - Page height in pixels
 * @returns True if aspect ratio exceeds threshold
 */
export function isTallPage(width: number, height: number): boolean {
  if (width === 0) return false;
  return height / width > TALL_PAGE_THRESHOLD;
}

/**
 * Determine if image dimensions require resizing.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param noResize - User override to disable resizing
 * @returns True if resize should be applied
 */
export function shouldResize(width: number, height: number, noResize: boolean): boolean {
  if (noResize) {
    return false;
  }
  const longestEdge = Math.max(width, height);
  return longestEdge > MAX_EDGE_PX;
}

/**
 * Calculate final dimensions after applying resize scale.
 *
 * @param width - Original width in pixels
 * @param height - Original height in pixels
 * @param scale - Scale factor to apply
 * @returns Final dimensions after scaling
 */
export function calculateFinalDimensions(
  width: number,
  height: number,
  scale: number
): { width: number; height: number } {
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Calculate actual file dimensions accounting for device pixel ratio.
 *
 * @param cssWidth - CSS pixel width
 * @param cssHeight - CSS pixel height
 * @param devicePixelRatio - Device pixel ratio (e.g., 2 for Retina)
 * @returns Actual file dimensions
 */
export function calculateActualDimensions(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number
): { width: number; height: number } {
  return {
    width: Math.round(cssWidth * devicePixelRatio),
    height: Math.round(cssHeight * devicePixelRatio),
  };
}
