/**
 * Declarations that have no effect, with why and what to change: Chrome
 * DevTools' inactive-CSS rules (CSSRuleValidator) plus some of Firefox's,
 * checked against authored declarations only (never the browser's own
 * styles), and `var()` references to custom properties that are not set.
 */

import type { Declaration, Resolution } from '@/runtime/dom/inspectCascade.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import type { InspectHint } from '@/ipc/protocol/inspectTypes.js';
import { isDefaultValue } from '@/runtime/dom/inspectAllStyles.js';
import type { VariableSetter } from '@/runtime/dom/inspectScripts.js';
import { unsetVariables } from '@/runtime/dom/inspectVariables.js';
import { findSimilarNames } from '@/utils/suggestions.js';

/** A declaration that has no effect */
export interface CssHint {
  kind: 'inactive' | 'unset-variable' | 'not-inherited';
  /** Property as written */
  property: string;
  /** Its value */
  value: string;
  /** Why it has no effect */
  reason: string;
  /** What would make it work */
  fix: string;
  /** The longhands of a shorthand that have no effect, when the others do (`margin-top`, `margin-bottom`) */
  only?: string[];
  /** The custom properties that are not set (`unset-variable`) */
  variables?: string[];
  /** The declaration */
  declaration: Declaration;
}

/** What the checks look at */
interface HintContext {
  style: StyleMap;
  parentStyle: StyleMap | undefined;
  /** `display` as the winning declaration wrote it, when it differs from the computed one (blockified) */
  declaredDisplay?: string | undefined;
  /** The element is replaced (img, input, video…) */
  replaced: boolean;
  /** The element is a form control (input, textarea, select, button) */
  formControl?: boolean;
}

/** A check: when it applies, why the declaration has no effect and the fix */
interface Rule {
  properties: readonly string[];
  inactive: (ctx: HintContext) => { reason: string; fix: string } | undefined;
}

const display = (style: StyleMap | undefined): string => style?.['display'] ?? 'inline';
const isFlex = (value: string): boolean => /(^|-)flex$/.test(value);
const isGrid = (value: string): boolean => /(^|-)grid$/.test(value);
const isFlexOrGrid = (value: string): boolean => isFlex(value) || isGrid(value);
const horizontal = (style: StyleMap): boolean =>
  (style['writing-mode'] ?? 'horizontal-tb') === 'horizontal-tb';
const isMulticol = (style: StyleMap): boolean =>
  (style['column-count'] ?? 'auto') !== 'auto' || (style['column-width'] ?? 'auto') !== 'auto';

/** The checks, in DevTools' wording */
const RULES: readonly Rule[] = [
  {
    properties: ['flex-direction', 'flex-wrap', 'flex-flow'],
    inactive: ({ style }) =>
      isFlex(display(style))
        ? undefined
        : { reason: `display is ${display(style)}`, fix: 'use display: flex or inline-flex' },
  },
  {
    properties: [
      'grid-template-columns',
      'grid-template-rows',
      'grid-template-areas',
      'grid-auto-flow',
      'grid-auto-columns',
      'grid-auto-rows',
    ],
    inactive: ({ style }) =>
      isGrid(display(style))
        ? undefined
        : { reason: `display is ${display(style)}`, fix: 'use display: grid or inline-grid' },
  },
  {
    properties: ['justify-content', 'align-items', 'row-gap'],
    inactive: ({ style }) =>
      isFlexOrGrid(display(style))
        ? undefined
        : {
            reason: `display is ${display(style)}`,
            fix: 'use display: flex or grid on this element',
          },
  },
  {
    properties: ['column-gap'],
    inactive: ({ style }) =>
      isFlexOrGrid(display(style)) || isMulticol(style)
        ? undefined
        : {
            reason: `display is ${display(style)}`,
            fix: 'use display: flex or grid on this element (or columns)',
          },
  },
  {
    properties: ['align-content'],
    inactive: ({ style }) => {
      if (isFlex(display(style)) && (style['flex-wrap'] ?? 'nowrap') === 'nowrap') {
        return { reason: 'flex-wrap is nowrap (one line)', fix: 'use flex-wrap: wrap' };
      }
      return undefined;
    },
  },
  {
    properties: ['flex', 'flex-grow', 'flex-shrink', 'flex-basis'],
    inactive: ({ parentStyle }) =>
      isFlex(display(parentStyle))
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: flex on the parent',
          },
  },
  {
    properties: [
      'grid-area',
      'grid-column',
      'grid-row',
      'grid-column-start',
      'grid-column-end',
      'grid-row-start',
      'grid-row-end',
    ],
    inactive: ({ parentStyle }) =>
      isGrid(display(parentStyle))
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: grid on the parent',
          },
  },
  {
    properties: ['order', 'align-self'],
    inactive: ({ style, parentStyle }) =>
      isFlexOrGrid(display(parentStyle)) || /^(absolute|fixed)$/.test(style['position'] ?? '')
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: flex or grid on the parent',
          },
  },
  {
    properties: ['top', 'right', 'bottom', 'left', 'inset'],
    inactive: ({ style }) =>
      (style['position'] ?? 'static') === 'static'
        ? {
            reason: 'position is static',
            fix: 'use position: absolute (out of the flow) or relative (shifted in place)',
          }
        : undefined,
  },
  {
    properties: ['z-index'],
    inactive: ({ style, parentStyle }) =>
      (style['position'] ?? 'static') === 'static' && !isFlexOrGrid(display(parentStyle))
        ? {
            reason: 'position is static',
            fix: 'use position: relative, or absolute to take it out of the flow',
          }
        : undefined,
  },
  {
    properties: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
    inactive: ({ style, replaced }) =>
      display(style) === 'inline' && !replaced
        ? { reason: 'display is inline', fix: 'use display: inline-block or block' }
        : undefined,
  },
  {
    properties: ['margin-top', 'margin-bottom'],
    inactive: ({ style, replaced }) =>
      display(style) === 'inline' && !replaced && horizontal(style)
        ? {
            reason: 'display is inline (vertical margins do not move it)',
            fix: 'use display: inline-block or block',
          }
        : undefined,
  },
  {
    properties: ['vertical-align'],
    inactive: ({ style, parentStyle, declaredDisplay }) =>
      /^(inline|table-cell|ruby)/.test(display(style))
        ? undefined
        : {
            reason: `display is ${display(style)}${blockified(declaredDisplay, style, parentStyle)}`,
            fix: 'vertical-align works on inline and table-cell boxes; use flex alignment instead',
          },
  },
  {
    properties: ['text-overflow'],
    inactive: ({ style }) =>
      (style['overflow-x'] ?? 'visible') === 'visible'
        ? {
            reason: 'overflow is visible (nothing is cut)',
            fix: 'add overflow: hidden and white-space: nowrap',
          }
        : undefined,
  },
  {
    properties: ['float'],
    inactive: ({ parentStyle }) =>
      isFlexOrGrid(display(parentStyle))
        ? {
            reason: `the parent is a ${display(parentStyle)} container`,
            fix: 'remove float; use flex or grid alignment',
          }
        : undefined,
  },
  {
    properties: ['object-fit', 'object-position'],
    inactive: ({ replaced }) =>
      replaced
        ? undefined
        : {
            reason: 'the element is not an image or video',
            fix: 'use background-size/position for backgrounds',
          },
  },
];

/**
 * Why a declared inline-level display computes to a block-level one: the
 * element is a flex or grid item, floated or positioned (CSS blockification).
 *
 * @param declared - `display` as written, when it differs from the computed one
 * @param style - Computed styles
 * @param parentStyle - Computed styles of the layout parent
 * @returns ` (inline-flex blockified: a flex item)`, or empty
 */
function blockified(
  declared: string | undefined,
  style: StyleMap,
  parentStyle: StyleMap | undefined
): string {
  if (!declared || declared === display(style) || !/^(inline|table-|ruby)/.test(declared))
    return '';
  const parent = display(parentStyle);
  const cause = isFlex(parent)
    ? 'a flex item'
    : isGrid(parent)
      ? 'a grid item'
      : (style['float'] ?? 'none') !== 'none'
        ? 'floated'
        : /^(absolute|fixed)$/.test(style['position'] ?? '')
          ? 'positioned'
          : 'by its context';
  return ` (${declared} blockified: ${cause})`;
}

/**
 * Shorthands whose inactive longhands are worth a hint while the others
 * work: vertical margins of an inline element are a common mistake, while
 * `gap` in a multi-column block or `grid-template-areas: none` are not
 */
const PARTIAL_SHORTHANDS = new Set(['margin', 'margin-block']);

/** Values that change nothing wherever they are written */
const NO_OP_KEYWORDS = new Set(['initial', 'unset', 'revert', 'revert-layer']);

/**
 * Whether a declared longhand value is its default, so writing it has no
 * effect in any case (`vertical-align: baseline`, `margin-top: 0` from a
 * reset): such declarations are not worth a hint.
 *
 * @param declaration - Declaration of a longhand
 * @returns True for a default value
 */
function isNoOp(declaration: Declaration): boolean {
  const value = declaration.value.trim().toLowerCase();
  if (NO_OP_KEYWORDS.has(value)) return true;
  const zero = /^[+-]?0*\.?0+([a-z]+|%)?$/.test(value) ? '0px' : value;
  return isDefaultValue(declaration.property, value) || isDefaultValue(declaration.property, zero);
}

/**
 * Declarations of the element that have no effect: the longhands a
 * declaration wins that are inactive, unless they only restate a default.
 * When only some of a `margin` shorthand's longhands are inactive
 * (`margin: 8px 12px` on an inline element: the sides still move it), the
 * hint names those; other partly inactive shorthands are not hinted.
 *
 * @param cascade - Resolved properties (winning declarations are checked)
 * @param ctx - Computed styles of the element and its parent
 * @returns Hints, in property order
 */
export function inactiveHints(cascade: Map<string, Resolution>, ctx: HintContext): CssHint[] {
  return [...ownWinnersByDeclaration(cascade).values()].flatMap((winners) => {
    const checks = winners.map((declaration) =>
      RULES.find((rule) => rule.properties.includes(declaration.property))?.inactive(ctx)
    );
    const inactive = winners.filter((declaration, i) => checks[i] && !isNoOp(declaration));
    const [first] = winners;
    const reason = checks.find(Boolean);
    const partial = checks.some((check) => !check);
    if (!first || !reason || inactive.length === 0) return [];
    if (partial && !PARTIAL_SHORTHANDS.has(first.via ?? '')) return [];
    return [
      {
        kind: 'inactive' as const,
        property: first.via ?? first.property,
        value: first.written ?? first.value,
        ...reason,
        ...(partial && { only: inactive.map((declaration) => declaration.property) }),
        declaration: first,
      },
    ];
  });
}

/**
 * The element's own authored winning declarations, the longhands each wins
 * grouped by the declaration as written.
 *
 * @param cascade - Resolved properties
 * @returns Winning longhands by declaration
 */
function ownWinnersByDeclaration(cascade: Map<string, Resolution>): Map<string, Declaration[]> {
  const groups = new Map<string, Declaration[]>();
  for (const { winner } of cascade.values()) {
    if (!winner || winner.ancestor !== undefined || winner.source.origin === 'user-agent') continue;
    const { source } = winner;
    const key = [
      winner.via ?? winner.property,
      source.kind,
      source.styleSheetId,
      source.line,
      source.column,
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), winner]);
  }
  return groups;
}

/**
 * Winning declarations that use a custom property that is not set: the
 * declaration is invalid at computed-value time, so the property falls back
 * to inherited or initial.
 *
 * @param cascade - Resolved properties
 * @param style - Computed styles of the element (custom properties included)
 * @returns Hints
 */
export function undefinedVariableHints(
  cascade: Map<string, Resolution>,
  style: StyleMap
): CssHint[] {
  const hints: CssHint[] = [];
  const seen = new Set<string>();
  for (const resolution of cascade.values()) {
    const declaration = resolution.winner;
    if (!declaration || declaration.ancestor !== undefined) continue;
    const value = declaration.written ?? declaration.value;
    const missing = unsetVariables(value, style);
    const written = declaration.via ?? declaration.property;
    if (missing.length === 0 || seen.has(written)) continue;
    seen.add(written);
    hints.push({
      kind: 'unset-variable',
      property: written,
      value,
      reason: `${missing.join(', ')} is not set`,
      fix: variableFix(missing[0] ?? '', style),
      variables: missing,
      declaration,
    });
  }
  return hints;
}

/**
 * Unset-variable hints told where the page does set the variable, when it
 * does: only in a rule that does not match now (`.btn:hover`: expected in
 * the other state), only in `@keyframes` (while the animation runs), or to
 * `inherit`/`initial`/an empty value in a rule that matches (nothing above
 * gives it a value). A set variable is not a typo, so the "did you mean"
 * suggestion goes.
 *
 * @param hints - Hints of the result
 * @param setters - Where each variable is set, by name ({@link VARIABLE_SETTERS_JS})
 * @returns Hints
 */
export function explainUnsetVariables(
  hints: readonly InspectHint[],
  setters: Readonly<Record<string, VariableSetter>>
): InspectHint[] {
  return hints.map((hint) => {
    const variables = hint.variables ?? [];
    const name = variables.find((variable) => setters[variable]);
    const setter = name ? setters[name] : undefined;
    if (!name || !setter) return hint;
    const explained = setterExplanation(name, setter);
    if (variables.every((variable) => setters[variable])) return { ...hint, ...explained };
    return { ...hint, reason: `${hint.reason}; ${explained.reason}` };
  });
}

/**
 * Why a variable that the page sets is unset here, and the fix.
 *
 * @param name - Variable
 * @param setter - Where it is set
 * @returns Reason and fix
 */
function setterExplanation(name: string, setter: VariableSetter): { reason: string; fix: string } {
  const fallback = 'give var() a fallback';
  if (setter.keyframes) {
    return {
      reason: `${name} is set only in @keyframes ${setter.keyframes} (while it runs)`,
      fix: `${fallback} for when the animation is not running`,
    };
  }
  if (setter.condition) {
    return {
      reason: `${name} is set only by ${setter.selector} under ${setter.condition}, which does not apply now`,
      fix: `expected under other conditions; otherwise ${fallback}`,
    };
  }
  if (setter.matches) {
    return {
      reason: `${name} is set to ${setter.value === '' ? 'an empty value' : setter.value} by ${setter.selector}, and nothing above gives it a value`,
      fix: `set ${name} on an ancestor, or ${fallback}`,
    };
  }
  return {
    reason:
      setter.matches === null
        ? `${name} is set only by ${setter.selector} (whether it applies here is not known)`
        : `${name} is set only by ${setter.selector}, which does not match now`,
    fix: `expected in that state; otherwise ${fallback}`,
  };
}

/**
 * How to fix a `var()` of an unset custom property, naming a similar one
 * that is set (a typo or a renamed token).
 *
 * @param name - The unset custom property
 * @param style - Computed styles (custom properties included)
 * @returns Fix
 */
function variableFix(name: string, style: StyleMap): string {
  const defined = Object.keys(style).filter((key) => key.startsWith('--'));
  const [similar] = findSimilarNames(name, defined);
  const fix = `define ${name} or give var() a fallback`;
  return similar ? `${fix} (did you mean ${similar}? it is set)` : fix;
}

/**
 * A form control drawn in the browser's font while its parent uses another:
 * controls do not inherit the font unless told to (a common oversight).
 *
 * @param cascade - Resolved properties
 * @param ctx - Computed styles of the element and its parent
 * @returns The hint, when the browser's own font-family wins
 */
export function formControlFontHints(
  cascade: Map<string, Resolution>,
  ctx: HintContext
): CssHint[] {
  const declaration = cascade.get('font-family')?.winner;
  if (!ctx.formControl || declaration?.source.origin !== 'user-agent') return [];
  const own = firstFamily(ctx.style['font-family']);
  const parent = firstFamily(ctx.parentStyle?.['font-family']);
  if (!own || !parent || own.toLowerCase() === parent.toLowerCase()) return [];
  return [
    {
      kind: 'not-inherited',
      property: 'font-family',
      value: own,
      reason: `form controls do not inherit the font (the parent uses ${parent})`,
      fix: 'add font: inherit (or font-family: inherit) to the control',
      declaration,
    },
  ];
}

/**
 * The first family of a font-family list, unquoted.
 *
 * @param value - font-family value
 * @returns First family, or undefined
 */
function firstFamily(value: string | undefined): string | undefined {
  const family = value
    ?.split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  return family === '' ? undefined : family;
}
