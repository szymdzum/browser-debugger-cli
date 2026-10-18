/**
 * Accessibility audit messages.
 */

import type { A11yRuleId } from '@/ipc/protocol/auditTypes.js';
import type { A11yReason } from '@/runtime/dom/auditA11yModel.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/** Why an out-of-view text's contrast in `dom audit` is approximate: none of its ancestors paints a background */
export const AUDIT_OUT_OF_VIEW_RISK = 'only its ancestors were checked';

/**
 * `dom audit contrast` note for text that looks below the level but cannot
 * be measured exactly (over an image, blended, under or over another layer).
 *
 * @param count - How many such texts
 * @returns e.g. `(+12 more may be below it but cannot be measured: text over images or blended layers; check them with bdg dom inspect)`
 */
export function auditUncertainContrastNote(count: number): string {
  return `(+${count} more may be below it but cannot be measured: text over images or blended layers; check them with ${sessionCommand('bdg dom inspect <element>')})`;
}

/**
 * `dom audit animations` note for canvas elements, whose script-drawn
 * animations it cannot see.
 *
 * @param count - Visible canvas elements
 * @returns e.g. `(+ 2 canvas elements: animations drawn by scripts on them are not listed)`
 */
export function auditCanvasNote(count: number): string {
  return `(+ ${count} canvas ${count === 1 ? 'element' : 'elements'}: animations drawn by scripts on ${count === 1 ? 'it are' : 'them are'} not listed)`;
}

/** Fix hint per `dom audit a11y` rule */
export const A11Y_RULE_HINTS: Readonly<Record<A11yRuleId, string>> = {
  'img-alt': 'give the image alt text, or alt="" when it only decorates',
  'control-name': 'label it: a <label for>, aria-label, aria-labelledby, title or visible text',
  'heading-order': 'one h1, then levels without gaps (h1, h2, h3)',
  landmarks: 'put the content in <main>, <header>, <nav> and <footer>',
  'duplicate-id': 'make ids unique',
  'aria-reference': 'point aria-labelledby/describedby at ids that exist',
};

/** Examples line of `dom audit a11y --help`: what it checks and does not */
export const A11Y_AUDIT_RULES_HELP = `Rules of the a11y check (not a full WCAG engine; it reads the computed accessibility tree):
  img-alt        <img> and role=img without an accessible name (alt="", aria-hidden, a plain
                 <svg> and an image inside a named button or link are fine)
  control-name   inputs, selects, buttons and links without a name (icon-only buttons);
                 a placeholder counts as a name, as Chrome computes it
  heading-order  no h1, more than one h1, skipped levels
  landmarks      no main landmark; text outside any landmark
  duplicate-id   elements sharing an id
  aria-reference aria-labelledby/describedby naming no element`;

/**
 * What an `a11y` finding says about its element.
 *
 * @param reason - Why the rule flagged it
 * @returns Detail text
 */
export function a11yDetail(reason: A11yReason): string {
  switch (reason.kind) {
    case 'unnamed':
      return 'no accessible name';
    case 'no-h1':
      return 'the page has no h1';
    case 'extra-h1':
      return `one of ${reason.total} h1 (note: a page usually has one)`;
    case 'skipped-level':
      return `h${reason.level} follows h${reason.previous}, skipping ${skippedLevels(reason.previous, reason.level)}`;
    case 'no-main':
      return 'no main landmark';
    case 'outside-landmark':
      return `${reason.holders} ${reason.holders === 1 ? 'element holds' : 'elements hold'} text outside any landmark`;
    case 'duplicate-id':
      return `id "${reason.id}" is used by ${reason.total} elements`;
    case 'missing-reference':
      return `${reason.attribute} names no element with id "${reason.id}"`;
  }
}

/**
 * The heading levels a jump skips.
 *
 * @param previous - Level before
 * @param level - Level after
 * @returns e.g. `h2, h3`
 */
function skippedLevels(previous: number, level: number): string {
  return Array.from({ length: level - previous - 1 }, (_, i) => `h${previous + 1 + i}`).join(', ');
}

/**
 * Note on an a11y finding no selector finds alone.
 *
 * @returns Note
 */
export function a11yNoSelectorNote(): string {
  return '(no unique selector: find it with bdg dom a11y query)';
}

/** Pointer under `bdg dom a11y --help` to the page-wide a11y rules */
export const A11Y_AUDIT_POINTER =
  '\nTo find a11y problems (missing alt text and names, heading order, landmarks, ids) run: bdg dom audit a11y';

/**
 * Note on an open modal dialog: it hides the rest of the page from screen readers.
 *
 * @param element - The dialog's selector
 * @returns Note
 */
export function a11yModalNote(element: string): string {
  return `${element} is a modal dialog: it hides the rest of the page from screen readers, so only the dialog was checked (headings and landmarks are not reported). Close it and run the audit again`;
}

/**
 * Note of an a11y check that did not cover the whole page.
 *
 * @returns Note
 */
export function a11yTruncatedNote(): string {
  return '(the id scan or the frame list hit its cap: the page has more)';
}

/** Examples under `bdg dom audit --help` */
export const AUDIT_HELP_EXAMPLES = `
Examples:
  bdg dom audit                       All checks
  bdg dom audit contrast --wcag AAA   Text below WCAG AAA, weakest first
  bdg dom audit overflow              What scrolls sideways, cut-off text, scaled images
  bdg dom audit layers animations     Fixed/sticky elements and running animations
  bdg dom audit a11y                  Missing alt text and names, heading order, landmarks, duplicate ids

Follow up on a finding with bdg dom inspect <element> (e.g. --why color), or
bdg dom a11y describe <element> for an a11y finding.

Findings do not change the exit code (0): gate on data.a11y.rules[].count in --json.
Each listed a11y element costs one selector lookup, so a high --limit on a page with
thousands of findings takes seconds.

${A11Y_AUDIT_RULES_HELP}`;
