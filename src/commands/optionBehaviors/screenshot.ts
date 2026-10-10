/**
 * Option behaviors of `bdg dom screenshot`.
 */

import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';
import {
  MAX_EDGE_PX,
  PIXELS_PER_TOKEN,
  TALL_PAGE_THRESHOLD,
} from '@/runtime/page/screenshotResize.js';

/** Behaviors by registry key */
export const SCREENSHOT_BEHAVIORS: BehaviorTable = {
  'screenshot:--selector': {
    default: 'Captures the page (full page unless --no-full-page)',
    whenEnabled:
      'Captures one element; the selector (or a query index) can also be given as the second argument: bdg dom screenshot out.png "#sel". With --index it picks that match of the selector (--selector ".item" --index 2). A positional and an option naming different elements exits 81',
    automaticBehavior:
      "The capture covers the border box plus what overflows it: uncleared floats, positioned children, text past a tight line height, and the element's own box shadows and outline (a focus ring); not what an overflow: hidden ancestor cuts off, nor fixed descendants. JSON element.bounds is the border box and element.captured the larger area when it grew, which human output notes. An element smaller than the viewport is scrolled into view for the capture and the page scroll put back afterwards; a larger one is captured with the page laid out at its width without scrollbars, so it does not shift",
  },
  'screenshot:--padding': {
    default:
      'The element capture is its painted area (border box, overflowing content, shadows, outline)',
    whenEnabled:
      'Adds that many CSS px of the page around the element capture on every side (0-500); without an element it exits 81',
  },
  'screenshot:--no-resize': {
    default: `Images auto-resized to max ${MAX_EDGE_PX}px longest edge for Claude Vision optimization (~1,600 tokens)`,
    whenDisabled: `Full resolution capture preserved (may use 10,000+ tokens for large pages)`,
    automaticBehavior: `Pages taller than ${TALL_PAGE_THRESHOLD}:1 aspect ratio automatically use viewport-only capture to prevent unreadable scaled text`,
    tokenImpact: `Formula: tokens = (width × height) / ${PIXELS_PER_TOKEN}. Default resize targets ~1,600 tokens.`,
  },
  'screenshot:--no-full-page': {
    default: 'Captures full scrollable page content',
    whenEnabled: 'Captures only visible viewport area',
    automaticBehavior: `Pages taller than ${TALL_PAGE_THRESHOLD}:1 aspect ratio automatically fallback to viewport capture even without this flag`,
  },
  'screenshot:--scroll': {
    whenEnabled:
      'Scrolls specified element into view, then captures viewport only (implies --no-full-page)',
    automaticBehavior:
      'When used with tall pages, prevents the automatic viewport fallback message since scroll is an explicit user choice',
  },
  'screenshot:--format': {
    default: 'Taken from the file extension: .jpg/.jpeg is JPEG, anything else PNG',
    whenEnabled: 'png or jpeg (jpg, any case); JPEG gives smaller files with a quality trade-off',
    automaticBehavior:
      'A --format that contradicts the extension, or an extension Chrome cannot write (.gif, .webp, ...), is refused with exit 81',
  },
  'screenshot:--quality': {
    default: 'JPEG quality 90 (good balance of quality and size)',
    whenEnabled: 'Lower values reduce file size but increase compression artifacts',
  },
};
