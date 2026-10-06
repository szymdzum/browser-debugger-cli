/**
 * `dom inspect`'s cascade fields from the matched rules: hints (declarations
 * that have no effect), `--rules` (which declaration sets each shown
 * property, sides set by one declaration merged into the shorthand) and
 * `--why` (every declaration of one property).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type { InspectHint, InspectResult, InspectRule } from '@/ipc/protocol/inspectTypes.js';
import { normalizeProperty } from '@/runtime/dom/inspectAllStyles.js';
import {
  physicalName,
  ownProperties,
  ruleField,
  resolveCascade,
  shorthandLonghands,
  type Declaration,
  type Resolution,
} from '@/runtime/dom/inspectCascade.js';
import {
  formControlFontHints,
  inactiveHints,
  undefinedVariableHints,
} from '@/runtime/dom/inspectHints.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import { buildWhy } from '@/runtime/dom/inspectWhyModel.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const sides = (pattern: string): string[] => SIDES.map((side) => pattern.replace('{side}', side));

/** Longhands reported together, so a shorthand can stand for its sides */
export interface PropertyGroup {
  shorthand?: string;
  longhands: string[];
}

/** Properties `--rules` reports */
const RULE_GROUPS: readonly PropertyGroup[] = [
  { longhands: ['display'] },
  { longhands: ['position'] },
  { shorthand: 'inset', longhands: sides('{side}') },
  { longhands: ['z-index'] },
  { longhands: ['width'] },
  { longhands: ['height'] },
  { longhands: ['min-width'] },
  { longhands: ['max-width'] },
  { longhands: ['min-height'] },
  { longhands: ['max-height'] },
  { shorthand: 'margin', longhands: sides('margin-{side}') },
  { shorthand: 'padding', longhands: sides('padding-{side}') },
  { shorthand: 'border-width', longhands: sides('border-{side}-width') },
  { shorthand: 'border-style', longhands: sides('border-{side}-style') },
  { shorthand: 'border-color', longhands: sides('border-{side}-color') },
  {
    shorthand: 'border-radius',
    longhands: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
      (c) => `border-${c}-radius`
    ),
  },
  { longhands: ['background-color'] },
  { longhands: ['background-image'] },
  { longhands: ['color'] },
  { longhands: ['font-family'] },
  { longhands: ['font-size'] },
  { longhands: ['font-weight'] },
  { longhands: ['line-height'] },
  { longhands: ['letter-spacing'] },
  { longhands: ['text-align'] },
  { longhands: ['text-transform'] },
  { longhands: ['opacity'] },
  { longhands: ['box-shadow'] },
  { longhands: ['transform'] },
  { longhands: ['flex-direction'] },
  { longhands: ['flex-wrap'] },
  { longhands: ['justify-content'] },
  { longhands: ['align-items'] },
  { shorthand: 'gap', longhands: ['row-gap', 'column-gap'] },
  { longhands: ['grid-template-columns'] },
  { longhands: ['grid-template-rows'] },
  { shorthand: 'flex', longhands: ['flex-grow', 'flex-shrink', 'flex-basis'] },
  { longhands: ['align-self'] },
  { shorthand: 'overflow', longhands: ['overflow-x', 'overflow-y'] },
  { longhands: ['cursor'] },
];

/** What the cascade fields are built from */
export interface CascadeInput {
  matched: Protocol.CSS.GetMatchedStylesForNodeResponse;
  style: StyleMap;
  parentStyle: StyleMap | undefined;
  replaced: boolean;
  /** Where a declaration comes from, for people */
  label: (declaration: Declaration) => string;
  rules?: boolean;
  why?: string;
  /** `--props` names: `--rules` then covers only these */
  props?: string[];
  /** Check for declarations that have no effect (default true) */
  hints?: boolean;
  formControl?: boolean;
}

/**
 * The cascade fields of the result.
 *
 * @param input - Matched rules, computed styles, options
 * @returns `hints` (empty when checked and nothing found), `rules` and `why`
 */
export function buildCascadeFields(input: CascadeInput): Partial<InspectResult> {
  const ruleGroups = input.rules ? (input.props?.map(propertyGroup) ?? RULE_GROUPS) : [];
  const whyGroup = input.why ? propertyGroup(input.why) : undefined;
  const wanted = [
    ...new Set([
      ...ownProperties(input.matched),
      ...ruleGroups.flatMap((group) => group.longhands),
      ...(whyGroup?.longhands ?? []),
    ]),
  ];
  const cascade = resolveCascade(input.matched, wanted);
  const hints = input.hints === false ? undefined : buildHints(cascade, input);
  const rules = buildRules(ruleGroups, cascade, input);
  return {
    ...(hints && { hints }),
    ...(rules.length > 0 && { rules }),
    ...(whyGroup && { why: buildWhy(whyGroup, cascade, input) }),
  };
}

/**
 * The longhands a property name stands for.
 *
 * @param name - Shorthand, longhand, logical or custom property
 * @returns Group (a shorthand with its longhands, or one physical longhand)
 */
function propertyGroup(name: string): PropertyGroup {
  const longhands = shorthandLonghands(name);
  return longhands
    ? { shorthand: name, longhands: [...longhands] }
    : { longhands: [physicalName(name)] };
}

/**
 * Hints: declarations with no effect, and var() of unset custom properties;
 * none without the computed style to check them against.
 *
 * @param cascade - Resolved properties
 * @param input - Styles and the label function
 * @returns Hints
 */
function buildHints(cascade: Map<string, Resolution>, input: CascadeInput): InspectHint[] {
  if (input.style['display'] === undefined) return [];
  const ctx = {
    style: input.style,
    parentStyle: input.parentStyle,
    replaced: input.replaced,
    formControl: input.formControl === true,
  };
  return [
    ...inactiveHints(cascade, ctx),
    ...undefinedVariableHints(cascade, input.style),
    ...formControlFontHints(cascade, ctx),
  ].map((hint) => ({
    kind: hint.kind,
    property: hint.property,
    value: hint.value,
    reason: hint.reason,
    fix: hint.fix,
    source: input.label(hint.declaration),
  }));
}

/**
 * `--rules`: one row per property set by an author declaration; one row for
 * a group (`padding`, `border-width`) when a single declaration sets all of
 * it, and one for a shorthand Chrome could not expand (`var()`, such as
 * `border: 2px solid var(--c)` or `background: var(--bg)`) however many
 * properties it sets.
 *
 * @param groups - Properties to report
 * @param cascade - Resolved properties
 * @param input - Computed style and the label function
 * @returns Rules
 */
function buildRules(
  groups: readonly PropertyGroup[],
  cascade: Map<string, Resolution>,
  input: CascadeInput
): InspectRule[] {
  const rows = groups.flatMap((group) => {
    const resolutions = group.longhands.map((longhand) => cascade.get(longhand));
    const winners = resolutions.map((resolution) => resolution?.winner);
    const grouped =
      group.shorthand !== undefined ? groupedRow(group.shorthand, winners) : undefined;
    if (grouped) return [toRule(grouped.property, grouped, resolutions[0], input)];
    return group.longhands.flatMap((longhand, i) => {
      const winner = winners[i];
      if (!winner || winner.source.origin === 'user-agent') return [];
      const unexpanded = winner.via !== undefined && winner.value === winner.written;
      return unexpanded && winner.via
        ? [toRule(winner.via, winner, resolutions[i], input)]
        : [toRule(longhand, winner, resolutions[i], input)];
    });
  });
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.property}|${row.value}|${row.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One row for a group of longhands that a single author declaration sets:
 * the shorthand as written, or (set by a wider shorthand, like `border`
 * for `border-width`) the values it gives the sides; a wider shorthand
 * Chrome could not expand (`var()`) as written.
 *
 * @param shorthand - The group's shorthand
 * @param winners - Winning declaration of each longhand
 * @returns The row's declaration, or undefined when the sides differ in source
 */
function groupedRow(
  shorthand: string,
  winners: Array<Declaration | undefined>
): Declaration | undefined {
  const [first] = winners;
  if (!first?.via || first.source.origin === 'user-agent') return undefined;
  const same = winners.every((w) => w && w.via === first.via && sameSource(w, first));
  if (!same) return undefined;
  const written = first.written ?? first.value;
  if (first.via === shorthand || first.value === written) {
    return { ...first, property: first.via, value: written };
  }
  const values = winners.map((w) => w?.value ?? '');
  const value = values.every((v) => v === first.value) ? first.value : values.join(' ');
  return { ...first, property: shorthand, value };
}

/**
 * Whether two declarations come from the same place.
 *
 * @param a - Declaration
 * @param b - Declaration
 * @returns True for the same declaration (same rule and position)
 */
function sameSource(a: Declaration, b: Declaration): boolean {
  return (
    a.source.kind === b.source.kind &&
    a.source.selector === b.source.selector &&
    a.source.styleSheetId === b.source.styleSheetId &&
    a.source.line === b.source.line &&
    a.source.column === b.source.column
  );
}

/**
 * A `--rules` row.
 *
 * @param property - Property shown
 * @param winner - Winning declaration
 * @param resolution - Its resolution (for what it overrides)
 * @param input - Computed style and the label function
 * @returns Rule
 */
function toRule(
  property: string,
  winner: Declaration,
  resolution: Resolution | undefined,
  input: CascadeInput
): InspectRule {
  const computed = input.style[property];
  const overrides = [
    ...new Set(
      (resolution?.overridden ?? [])
        .filter((d) => d.source.origin !== 'user-agent')
        .map((d) => d.source.selector ?? d.source.kind)
    ),
  ];
  return {
    property,
    value: winner.value,
    ...(winner.value.includes('var(') &&
      computed !== undefined && { computed: normalizeProperty(property, computed) }),
    source: input.label(winner),
    ...ruleField(winner),
    ...(overrides.length > 0 && { overrides }),
    ...(winner.ancestor !== undefined && { inherited: winner.ancestor }),
    ...(winner.important && { important: true as const }),
    ...(winner.source.layer && { layer: winner.source.layer }),
    ...(winner.source.condition && { condition: winner.source.condition }),
  };
}
