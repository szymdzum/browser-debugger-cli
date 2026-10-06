/**
 * Page-side part of `bdg dom audit`: one walk over the rendered elements of
 * the page (open shadow roots included, at most {@link AUDIT_ELEMENT_CAP})
 * that collects what each check needs. Colors and contrast are computed in
 * the daemon ({@link buildAudit}), the same way `dom inspect` computes them.
 */

import type { RawBackground } from '@/runtime/dom/inspectScripts.js';

/** Elements the walk looks at, at most */
export const AUDIT_ELEMENT_CAP = 20000;

/** A text holder: an element that draws text of its own */
export interface RawAuditText {
  label: string;
  text: string;
  color: string;
  fontSize: string;
  fontWeight: string;
  /** Backgrounds from the element up to the root, each with its own opacity */
  backgrounds: RawBackground[];
  opacity: number;
  /** Blend modes and filters on it or an ancestor */
  risks: string[];
  /** Inside the viewport */
  inView: boolean;
}

/** An element that reaches past the right edge of the page's viewport */
export interface RawWideElement {
  label: string;
  right: number;
  width: number;
}

/** Text cut off by its box */
export interface RawTruncated {
  label: string;
  text: string;
  /** `ellipsis`, `clamp` or `clip` */
  kind: string;
}

/** An image drawn at another size than its own */
export interface RawImage {
  label: string;
  natural: { w: number; h: number };
  rendered: { w: number; h: number };
  objectFit: string;
}

/** A fixed or sticky element */
export interface RawLayer {
  label: string;
  position: string;
  zIndex: string;
  rect: { x: number; y: number; w: number; h: number };
  inView: boolean;
}

/** A running animation or transition */
export interface RawAnimation {
  label: string;
  /** Animation name, transitioned property, or `animation` for a Web Animation */
  name: string;
  type: string;
  duration: number | string;
  iterations: number | string;
  scrollDriven: boolean;
}

/** What {@link AUDIT_PAGE_JS} returns */
export interface RawAudit {
  viewport: { width: number; height: number };
  /** Device pixel ratio: an image needs that many pixels per CSS px to look sharp */
  pixelRatio: number;
  pageWidth: number;
  canvasDark: boolean;
  /** Elements walked, and whether the walk stopped at the cap */
  walked: number;
  capped: boolean;
  texts?: RawAuditText[];
  wide?: RawWideElement[];
  truncated?: RawTruncated[];
  images?: RawImage[];
  layers?: RawLayer[];
  animations?: RawAnimation[];
}

/**
 * Page-side audit walk. Arguments: the checks to collect for
 * (`contrast`, `overflow`, `layers`, `animations`).
 */
export const AUDIT_PAGE_JS = `function (checks) {
  const want = (name) => checks.includes(name);
  const doc = document;
  const view = window;
  const style = (n) => view.getComputedStyle(n);
  const scroller = doc.scrollingElement || doc.documentElement;
  const viewport = { width: doc.documentElement.clientWidth, height: view.innerHeight };
  const label = (n) => n.localName + (n.id ? '#' + n.id : n.classList && n.classList.length ? '.' + n.classList[0] : '');
  const parentOf = (n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const short = (text) => text.replace(/\\s+/g, ' ').trim().slice(0, 60);
  const ownText = (n) => Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.data).join(' ').replace(/\\s+/g, ' ').trim();
  const inView = (r) => r.bottom > 0 && r.right > 0 && r.top < viewport.height && r.left < viewport.width;
  const meta = doc.querySelector('meta[name="color-scheme"]');
  const rootScheme = style(doc.documentElement).colorScheme;
  const scheme = rootScheme && rootScheme !== 'normal' ? rootScheme : (meta && meta.content) || '';
  const canvasDark = /dark/.test(scheme) && (!/light/.test(scheme) || view.matchMedia('(prefers-color-scheme: dark)').matches);
  const result = { viewport: viewport, pixelRatio: view.devicePixelRatio || 1, pageWidth: scroller.scrollWidth, canvasDark: canvasDark, walked: 0, capped: false };
  const texts = [], wide = [], truncated = [], images = [], layers = [];
  const chainOf = (n) => {
    const backgrounds = [];
    const risks = [];
    let opacity = 1;
    for (let p = n; p && backgrounds.length < 60; p = parentOf(p)) {
      const s = style(p);
      const own = Number(s.opacity) || 0;
      const background = { color: s.backgroundColor, image: s.backgroundImage !== 'none' };
      backgrounds.push(own < 1 ? Object.assign(background, { opacity: own }) : background);
      opacity *= own;
      if (s.mixBlendMode !== 'normal') risks.push('mix-blend-mode ' + s.mixBlendMode + ' on ' + label(p));
      if (s.filter !== 'none') risks.push('filter on ' + label(p));
    }
    return { backgrounds: backgrounds, risks: risks, opacity: opacity };
  };
  const visit = (n) => {
    if (result.walked >= ${AUDIT_ELEMENT_CAP}) { result.capped = true; return; }
    if (/^(script|style|template|noscript|head|meta|link|title)$/.test(n.localName)) return;
    const s = style(n);
    if (s.display === 'none') return;
    result.walked++;
    const r = n.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && s.visibility === 'visible';
    if (shown && want('contrast')) {
      const text = ownText(n);
      if (text && Number(s.opacity) > 0) {
        const chain = chainOf(n);
        if (chain.opacity > 0) texts.push(Object.assign({ label: label(n), text: short(text), color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, inView: inView(r) }, chain));
      }
    }
    if (shown && want('overflow')) {
      if (r.right > viewport.width + 1 && s.position !== 'fixed') wide.push({ label: label(n), right: r.right + view.scrollX, width: r.width });
      const cut = s.overflowX !== 'visible' && n.scrollWidth > n.clientWidth + 1 ? (s.textOverflow === 'ellipsis' ? 'ellipsis' : 'clip')
        : s.webkitLineClamp !== 'none' && n.scrollHeight > n.clientHeight + 1 ? 'clamp' : null;
      const textContent = cut && short(n.innerText || '');
      const visuallyHidden = r.width <= 2 || r.height <= 2;
      if (cut && textContent && n.children.length === 0 && !visuallyHidden) truncated.push({ label: label(n), text: textContent, kind: cut });
      if (n.localName === 'img' && n.naturalWidth > 0 && n.complete) images.push({ label: label(n), natural: { w: n.naturalWidth, h: n.naturalHeight }, rendered: { w: r.width, h: r.height }, objectFit: s.objectFit });
    }
    if (want('layers') && (s.position === 'fixed' || s.position === 'sticky') && r.width > 0 && r.height > 0) {
      layers.push({ label: label(n), position: s.position, zIndex: s.zIndex, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, inView: inView(r) });
    }
    if (s.overflowX !== 'visible' && s.overflowX !== 'clip' && n !== doc.documentElement && n !== doc.body) {
      const wideBefore = wide.length;
      for (const c of Array.from((n.shadowRoot || n).children)) visit(c);
      wide.length = wideBefore;
      return;
    }
    for (const c of Array.from((n.shadowRoot || n).children)) visit(c);
  };
  visit(doc.documentElement);
  if (want('contrast')) result.texts = texts;
  if (want('overflow')) Object.assign(result, { wide: wide, truncated: truncated, images: images });
  if (want('layers')) result.layers = layers;
  if (want('animations')) {
    result.animations = doc.getAnimations().filter((a) => a.playState === 'running').slice(0, 200).map((a) => {
      const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      const target = a.effect && a.effect.target;
      return {
        label: target && target.localName ? label(target) : '(none)',
        name: a.animationName || a.transitionProperty || a.id || 'animation',
        type: a.constructor.name,
        duration: typeof timing.duration === 'number' ? timing.duration : String(timing.duration),
        iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations,
        scrollDriven: Boolean(a.timeline) && a.timeline !== doc.timeline
      };
    });
  }
  return result;
}`;
