/**
 * `dom inspect --why <property>`: every declaration of a property on the
 * element, the winner first, with `var()` values substituted and where the
 * winner's custom properties are set. A shorthand gives one answer when one
 * declaration sets all its longhands (listing every declaration it beats on
 * any of them), else one per longhand.
 */

import type { InspectVariable, InspectWhy, InspectWhyEntry } from '@/ipc/protocol/inspectTypes.js';
import { normalizeProperty } from '@/runtime/dom/inspectAllStyles.js';
import { resolveCascade, type Declaration, type Resolution } from '@/runtime/dom/inspectCascade.js';
import type { CascadeInput, PropertyGroup } from '@/runtime/dom/inspectCascadeModel.js';
import { substituteVariables, usedVariables } from '@/runtime/dom/inspectVariables.js';

/**
 * `--why` for a property.
 *
 * @param group - The property and its longhands
 * @param cascade - Resolved properties
 * @param input - Matched rules, computed style and the label function
 * @returns One entry, or one per longhand when they differ
 */
export function buildWhy(
  group: PropertyGroup,
  cascade: Map<string, Resolution>,
  input: CascadeInput
): InspectWhy[] {
  const whys = group.longhands.map((longhand) => whyOf(longhand, cascade.get(longhand), input));
  const [first] = whys;
  if (!first || group.shorthand === undefined) return whys;
  const winner = JSON.stringify(first.chain[0]);
  if (!whys.every((why) => JSON.stringify(why.chain[0]) === winner)) return whys;
  const values = whys.map((why) => why.computed);
  const computed = values.every((value) => value === first.computed)
    ? first.computed
    : values.join(' ');
  const beaten = whys.flatMap((why) => why.chain.slice(1));
  const overridden = [...new Map(beaten.map((entry) => [JSON.stringify(entry), entry])).values()];
  const chain = [...first.chain.slice(0, 1), ...overridden];
  return [{ ...first, property: group.shorthand, computed, chain }];
}

/**
 * `--why` for one longhand.
 *
 * @param property - Longhand
 * @param resolution - Its resolution
 * @param input - Matched rules, computed style and the label function
 * @returns Why
 */
function whyOf(
  property: string,
  resolution: Resolution | undefined,
  input: CascadeInput
): InspectWhy {
  const winner = resolution?.winner;
  const chain = [
    ...(winner
      ? [whyEntry(winner, winner.ancestor !== undefined ? 'inherited' : 'applied', input)]
      : []),
    ...(resolution?.overridden ?? []).map((d) => whyEntry(d, 'overridden', input)),
  ];
  const variables = winner ? variableSources(winner, input) : [];
  return {
    property,
    computed: normalizeProperty(property, input.style[property] ?? ''),
    chain,
    ...(variables.length > 0 && { variables }),
  };
}

/**
 * One declaration in a `--why` chain: a shorthand's as written, `var()`
 * substituted.
 *
 * @param declaration - Declaration
 * @param status - Applied, overridden or inherited
 * @param input - Computed style and the label function
 * @returns Entry
 */
function whyEntry(
  declaration: Declaration,
  status: InspectWhyEntry['status'],
  input: CascadeInput
): InspectWhyEntry {
  const value = declaration.via ? (declaration.written ?? declaration.value) : declaration.value;
  const resolved = value.includes('var(') ? substituteVariables(value, input.style) : value;
  return {
    value,
    ...(declaration.via && { via: declaration.via }),
    ...(resolved !== value && { resolved }),
    source: input.label(declaration),
    status,
    ...(declaration.important && { important: true as const }),
    ...(declaration.source.layer && { layer: declaration.source.layer }),
    ...(declaration.source.condition && { condition: declaration.source.condition }),
  };
}

/**
 * Where the custom properties the winning value uses are set.
 *
 * @param winner - Winning declaration
 * @param input - Matched rules, computed style and the label function
 * @returns The variables with a declaration (on the element or an ancestor)
 */
function variableSources(winner: Declaration, input: CascadeInput): InspectVariable[] {
  const names = usedVariables(winner.written ?? winner.value, input.style);
  if (names.length === 0) return [];
  const cascade = resolveCascade(input.matched, names);
  return names.flatMap((name) => {
    const declaration = cascade.get(name)?.winner;
    if (!declaration) return [];
    return [
      {
        name,
        value: declaration.value,
        source: input.label(declaration),
        ...(declaration.ancestor !== undefined && { inherited: declaration.ancestor }),
      },
    ];
  });
}
