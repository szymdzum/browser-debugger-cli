/**
 * Types of `bdg dom audit` (page-wide checks) and `bdg css search`.
 */

/** A check `dom audit` can run */
export type AuditCheck = 'contrast' | 'overflow' | 'layers' | 'animations';

/** Every check, in the order they are shown */
export const AUDIT_CHECKS: readonly AuditCheck[] = ['contrast', 'overflow', 'layers', 'animations'];

/** Text below the contrast level */
export interface AuditContrastItem {
  /** `tag#id` or `tag.firstClass` */
  element: string;
  text: string;
  /** WCAG ratio, rounded down to 2 decimals */
  ratio: number;
  color: string;
  /** Background behind the text, composited */
  background: string;
  /** Font size (px) and weight: large text needs less contrast */
  size: number;
  weight: number;
  inView: boolean;
  /** Why the ratio is approximate (blend modes, filters, an element behind or on top, out of view) */
  approximate?: string[];
}

/** An image drawn larger than its pixels, or with another aspect ratio */
export interface AuditImage {
  element: string;
  natural: { w: number; h: number };
  rendered: { w: number; h: number };
  /** Pixels needed (rendered size × pixel ratio) over the image's pixels, the larger of width and height */
  scale: number;
  /** Identical findings this one stands for (2 or more) */
  count?: number;
  upscaled?: true;
  distorted?: true;
}

/** What `dom audit` found */
export interface AuditResult {
  checks: AuditCheck[];
  /** Elements walked */
  walked: number;
  /** The walk stopped at its cap: the page has more elements */
  capped?: true;
  contrast?: {
    level: 'AA' | 'AAA';
    /** Text holders checked */
    checked: number;
    /** How many are below the level */
    failing: number;
    /** The weakest ones, at most `--limit` */
    items: AuditContrastItem[];
  };
  overflow?: {
    pageWidth: number;
    viewportWidth: number;
    /** The page is wider than its viewport (it scrolls sideways) */
    scrollsSideways: boolean;
    /** Elements reaching past the viewport's right edge (not inside a scroller), farthest first */
    wide: Array<{ element: string; right: number; width: number }>;
    /** Text cut off: `ellipsis`, `clamp` or `clip` */
    truncated: Array<{ element: string; text: string; kind: string; count?: number }>;
    images: AuditImage[];
    /** Device pixel ratio the image scale counts in (an image needs that many pixels per CSS px) */
    pixelRatio: number;
    /** Elements whose content scrolls sideways inside them (carousels, tab strips): fine, but cut off at first sight */
    scrollers: Array<{ element: string; scrollWidth: number; width: number }>;
  };
  layers?: Array<{
    element: string;
    position: string;
    zIndex: string;
    /** Viewport position and size */
    rect: { x: number; y: number; w: number; h: number };
    inView: boolean;
  }>;
  animations?: Array<{
    element: string;
    name: string;
    type: string;
    /** Duration (ms) */
    duration: number | string;
    iterations: number | string;
    /** Driven by scrolling, not time */
    scrollDriven?: true;
    /** Identical animations this one stands for (2 or more) */
    count?: number;
  }>;
  /** Visible `<canvas>` elements: scripts may animate them, which `animations` cannot see */
  canvases?: number;
}

/** A stylesheet line where `css search` found the text */
export interface CssSearchMatch {
  /** `app.css:12`, `bootstrap.min.css:5:52628`, `<style> in index.html:40` */
  source: string;
  /** The rule (or line) around the match, cut to a few hundred characters */
  text: string;
}

/** What `css search` found */
export interface CssSearchResult {
  query: string;
  /** Stylesheets searched */
  sheets: number;
  /** Matches found (the list may be shorter: `--limit`) */
  total: number;
  matches: CssSearchMatch[];
}
