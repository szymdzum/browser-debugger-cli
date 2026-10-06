/**
 * Human output of `bdg dom inspect`: a header line, then one line per group
 * in Figma's order with DevTools' names (box, layout, parent, text, fill,
 * border, fx, state, pseudo), then the child tree. Fields within a line are
 * separated by ` · `; lengths are CSS px without the unit.
 *
 * ```
 * button#buy.btn "Buy now" 120x41 @20,20 [flex] [prefers light]
 * box    p 12 24 · b 1
 * layout inline-flex row · gap 8
 * parent div.card flex column · gap 16 · in-parent l0 t0 r180 b0 · sib b16
 * text   Inter (webfont) 600 16/24 · color #fff · contrast 5.17 AA
 * fill   bg #1c69e3
 * border 1 solid #32447f · radius 8
 * ```
 */

import type {
  InspectBox,
  InspectContainer,
  InspectFill,
  InspectLayout,
  InspectParent,
  InspectPseudo,
  InspectResult,
  InspectText,
  InspectTreeNode,
} from '@/ipc/protocol/inspectTypes.js';
import { containerKind } from '@/runtime/dom/inspectLayoutModel.js';
import type { IndexSource } from '@/types.js';
import { joinLines } from '@/ui/formatting.js';
import {
  inspectedMatchAction,
  inspectVisibilityBadges,
  multipleMatchesWarning,
} from '@/ui/messages/commands.js';
import { shadowText, sidesShorthand, type CssLength } from '@/utils/cssValues.js';
import { truncateByLength } from '@/utils/strings.js';

/** Longest parent label on the parent line (CSS-module class names run long) */
const PARENT_LABEL_MAX = 40;

/** `bdg dom inspect` data (the `success` flag is implied by the envelope), with the list an index refers to */
export type InspectOutput = Omit<InspectResult, 'success'> & {
  indexSource?: IndexSource | undefined;
};

/** Width of the group label column */
const LABEL_WIDTH = 7;

/** Width a `--all` line wraps at */
const ALL_LINE_WIDTH = 100;

/**
 * One group line: the label, then its fields joined with ` · `.
 *
 * @param label - Group name
 * @param parts - Fields (empty ones left out)
 * @returns The line, or undefined when there are no fields
 */
function groupLine(label: string, parts: Array<string | false | undefined>): string | undefined {
  const shown = parts.filter((part): part is string => Boolean(part));
  return shown.length > 0 ? `${label.padEnd(LABEL_WIDTH)}${shown.join(' · ')}` : undefined;
}

/**
 * The header: label, text, size and position, layout badge, what keeps it
 * from being seen, where it lives and the color scheme.
 *
 * @param data - Inspect result
 * @returns Header line
 */
export function inspectHeader(data: InspectOutput): string {
  const display = data.layout?.display ?? data.all?.['display'];
  const kind = containerKind(display);
  return [
    data.element,
    data.content !== undefined && `"${data.content}"`,
    data.placeholder !== undefined && `placeholder "${data.placeholder}"`,
    data.rect && `${data.rect.w}x${data.rect.h} @${data.rect.x},${data.rect.y}`,
    kind && `[${kind}]`,
    ...inspectVisibilityBadges(data.visibility),
    data.context && `in ${data.context}`,
    data.colorScheme && `[prefers ${data.colorScheme}]`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Whether all four sides are 0.
 *
 * @param sides - Sides
 * @returns True when nothing is set
 */
function zero(sides: readonly CssLength[]): boolean {
  return sides.every((side) => side === 0);
}

/**
 * Min/max size limits, e.g. `min-w 100`.
 *
 * @param kind - `min` or `max`
 * @param limits - Width and height limits
 * @returns Fields
 */
function limitParts(kind: string, limits: InspectBox['min']): string[] {
  if (!limits) return [];
  return [
    limits.w !== undefined ? `${kind}-w ${limits.w}` : '',
    limits.h !== undefined ? `${kind}-h ${limits.h}` : '',
  ].filter(Boolean);
}

/**
 * The box line: margin, padding, border widths (when not all 0), content-box
 * sizing (when padding or border make the box larger than its CSS size),
 * size limits, overflow and the scroll size.
 *
 * @param box - Box group
 * @returns Line
 */
function boxLine(box: InspectBox): string | undefined {
  const padded = !zero(box.padding) || !zero(box.border);
  return groupLine('box', [
    !zero(box.margin) && `m ${sidesShorthand(box.margin)}`,
    !zero(box.padding) && `p ${sidesShorthand(box.padding)}`,
    !zero(box.border) && `b ${sidesShorthand(box.border)}`,
    padded && box.sizing === 'content-box' && 'sizing content-box',
    ...limitParts('min', box.min),
    ...limitParts('max', box.max),
    box.overflow && `overflow ${box.overflow}`,
    box.scroll && `scroll ${box.scroll.w}x${box.scroll.h}`,
  ]);
}

/**
 * Container fields as words, e.g. `wrap wrap`, `cols repeat(3,100)`, `gap 16`.
 *
 * @param container - Container fields
 * @returns Fields
 */
function containerParts(container: InspectContainer): string[] {
  const gap = Array.isArray(container.gap) ? container.gap.join(' ') : container.gap;
  return [
    container.wrap && `wrap ${container.wrap}`,
    container.columns && `cols ${container.columns}`,
    container.rows && `rows ${container.rows}`,
    container.justify && `justify ${container.justify}`,
    container.align && `align ${container.align}`,
    gap !== undefined && `gap ${gap}`,
  ].filter((part): part is string => Boolean(part));
}

/**
 * Display with the flex direction, e.g. `flex column`.
 *
 * @param display - Display
 * @param direction - Flex direction
 * @returns Words
 */
function displayWords(display: string, direction: string | undefined): string {
  return direction ? `${display} ${direction}` : display;
}

/**
 * The layout line: display, position, container and item fields.
 *
 * @param layout - Layout group
 * @returns Line
 */
function layoutLine(layout: InspectLayout): string | undefined {
  return groupLine('layout', [
    displayWords(layout.display, layout.direction),
    layout.position && `position ${layout.position}`,
    layout.inset && `inset ${sidesShorthand(layout.inset)}`,
    layout.z !== undefined && `z ${layout.z}`,
    ...containerParts(layout),
    layout.flex && `flex ${layout.flex}`,
    layout.self && `self ${layout.self}`,
    layout.order !== undefined && `order ${layout.order}`,
    layout.area && `area ${layout.area}`,
    layout.valign && `valign ${layout.valign}`,
    layout.float && `float ${layout.float}`,
  ]);
}

/**
 * The parent line: the parent's label, display and layout, then the
 * element's offsets from its content edges and the gaps to its siblings.
 *
 * @param layout - Layout group
 * @returns Line
 */
function parentLine(layout: InspectLayout): string | undefined {
  const parent: InspectParent | undefined = layout.parent;
  const offsets = layout.inParent;
  const gaps = Object.entries(layout.siblings ?? {}).map(([side, gap]) => `${side[0]}${gap}`);
  const parentWords = parent && [
    truncateByLength(parent.element, PARENT_LABEL_MAX),
    displayWords(parent.display, parent.direction),
    ...containerParts(parent),
    parent.textAlign && `text-align ${parent.textAlign}`,
  ];
  return groupLine('parent', [
    parentWords?.filter(Boolean).join(' '),
    offsets && `in-parent l${offsets.left} t${offsets.top} r${offsets.right} b${offsets.bottom}`,
    gaps.length > 0 && `sib ${gaps.join(' ')}`,
  ]);
}

/**
 * Font, weight and size as one phrase, e.g. `Inter (webfont) 600 italic 16/24`
 * or `Inter → Helvetica 400 14/normal`; for a container only the fields it has.
 *
 * @param text - Text group
 * @returns Fields
 */
function fontParts(text: InspectText): string[] {
  const family = text.family && [
    text.family,
    text.rendered && `→ ${text.rendered}`,
    text.webfont && '(webfont)',
  ];
  const size =
    text.size !== undefined &&
    (text.lineHeight !== undefined ? `${text.size}/${text.lineHeight}` : `${text.size}`);
  if (family && text.weight !== undefined && size) {
    return [
      [...family, text.weight, text.style, size]
        .filter((part) => part !== undefined && part !== false && part !== '')
        .join(' '),
    ];
  }
  return [
    family && `font ${family.filter(Boolean).join(' ')}`,
    text.weight !== undefined && `weight ${text.weight}`,
    text.style && `style ${text.style}`,
    size && `size ${size}`,
    !size && text.lineHeight !== undefined && `line-height ${text.lineHeight}`,
  ].filter((part): part is string => Boolean(part));
}

/**
 * The text line: font, color, contrast and the non-default extras.
 *
 * @param text - Text group
 * @returns Line
 */
function textLine(text: InspectText): string | undefined {
  const contrast = text.contrast;
  const contrastText =
    contrast &&
    [
      `contrast ${contrast.ratio} ${contrast.level}`,
      contrast.inherited && `on ${contrast.background}`,
      contrast.overImage && '(over image)',
    ]
      .filter(Boolean)
      .join(' ');
  return groupLine('text', [
    ...fontParts(text),
    text.color && `color ${text.color}`,
    contrastText,
    text.align && `align ${text.align}`,
    text.transform && `transform ${text.transform}`,
    text.tracking !== undefined && `tracking ${text.tracking}`,
    text.decoration && `decoration ${text.decoration}`,
    text.whiteSpace && `ws ${text.whiteSpace}`,
    text.overflow && `text-overflow ${text.overflow}`,
    text.clamp && `clamp ${text.clamp}`,
    text.shadow && `shadow ${text.shadow}`,
    text.features && `features ${text.features}`,
  ]);
}

/**
 * A fill as words.
 *
 * @param fill - Fill
 * @returns e.g. `bg #fff`, `bg-image url(hero.png) size cover`
 */
function fillText(fill: InspectFill): string {
  if (fill.type === 'solid') return `bg ${fill.color}`;
  if (fill.type === 'gradient') return `bg-image ${fill.value}`;
  return `bg-image ${fill.value}${fill.size ? ` size ${fill.size}` : ''}`;
}

/**
 * The fill line: backgrounds, opacity and blend mode.
 *
 * @param data - Inspect result
 * @returns Line
 */
function fillLine(data: InspectOutput): string | undefined {
  return groupLine('fill', [
    ...(data.fills ?? []).map(fillText),
    data.opacity !== undefined && `opacity ${data.opacity}`,
    data.blend && `blend ${data.blend}`,
  ]);
}

/**
 * The border line: strokes, radius and outline.
 *
 * @param data - Inspect result
 * @returns Line
 */
function borderLine(data: InspectOutput): string | undefined {
  const outline = data.outline;
  return groupLine('border', [
    ...(data.strokes ?? []).map(
      (s) => `${s.side === 'all' ? '' : `${s.side} `}${s.width} ${s.style} ${s.color}`
    ),
    data.radius && `radius ${sidesShorthand(data.radius)}`,
    outline &&
      `outline ${outline.width} ${outline.style} ${outline.color}${outline.offset ? ` offset ${outline.offset}` : ''}`,
  ]);
}

/**
 * The fx line: shadows, transform, filters, clip, mask and animation.
 *
 * @param data - Inspect result
 * @returns Line
 */
function fxLine(data: InspectOutput): string | undefined {
  const shadows = (data.effects ?? []).map((e) =>
    shadowText({ ...e, inset: e.type === 'inner-shadow' })
  );
  const fx = data.fx ?? {};
  return groupLine('fx', [
    shadows.length > 0 && `shadow ${shadows.join(', ')}`,
    fx.transform && `transform ${fx.transform}`,
    fx.filter && `filter ${fx.filter}`,
    fx.backdrop && `backdrop ${fx.backdrop}`,
    fx.clip && `clip ${fx.clip}`,
    fx.mask && `mask ${fx.mask}`,
    fx.animation && `animation ${fx.animation}`,
  ]);
}

/**
 * The state line.
 *
 * @param data - Inspect result
 * @returns Line
 */
function stateLine(data: InspectOutput): string | undefined {
  const state = data.state ?? {};
  return groupLine('state', [
    state.cursor && `cursor ${state.cursor}`,
    state.pointerEvents && `pointer-events ${state.pointerEvents}`,
    state.visibility && `visibility ${state.visibility}`,
    state.userSelect && `select ${state.userSelect}`,
    state.appearance && `appearance ${state.appearance}`,
  ]);
}

/**
 * One pseudo-element as words.
 *
 * @param pseudo - Pseudo-element
 * @returns e.g. `::before content "★" absolute 25x15 color #f00`
 */
function pseudoText(pseudo: InspectPseudo): string {
  const shadows = (pseudo.effects ?? []).map((e) =>
    shadowText({ ...e, inset: e.type === 'inner-shadow' })
  );
  return [
    pseudo.type,
    pseudo.content !== undefined && `content ${pseudo.content}`,
    pseudo.display,
    pseudo.position,
    pseudo.size && `${pseudo.size.w}x${pseudo.size.h}`,
    pseudo.color && `color ${pseudo.color}`,
    ...(pseudo.fills ?? []).map(fillText),
    pseudo.radius && `radius ${pseudo.radius}`,
    shadows.length > 0 && `shadow ${shadows.join(', ')}`,
    pseudo.transform && `transform ${pseudo.transform}`,
    pseudo.opacity !== undefined && `opacity ${pseudo.opacity}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Pseudo-element lines (the label on the first only).
 *
 * @param pseudo - Pseudo-elements
 * @returns Lines
 */
function pseudoLines(pseudo: readonly InspectPseudo[] | undefined): string[] {
  return (pseudo ?? []).map(
    (entry, i) => `${(i === 0 ? 'pseudo' : '').padEnd(LABEL_WIDTH)}${pseudoText(entry)}`
  );
}

/**
 * One tree row.
 *
 * @param node - Row
 * @returns e.g. `li.card ×33 266x107`, `div.card-body 286x190 [flex] (3)`
 */
function treeRow(node: InspectTreeNode): string {
  return [
    node.element,
    node.count !== undefined && `×${node.count}`,
    `${node.w}x${node.h}`,
    node.layout && `[${node.layout}]`,
    node.text && `"${node.text}"`,
    node.childCount !== undefined && `(${node.childCount})`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Tree rows, indented by depth, with the hidden children of each level.
 *
 * @param nodes - Rows
 * @param hidden - Hidden children at this level
 * @param depth - Indentation level
 * @returns Lines
 */
function treeLines(
  nodes: readonly InspectTreeNode[],
  hidden: number | undefined,
  depth: number
): string[] {
  const indent = '  '.repeat(depth);
  const lines = nodes.flatMap((node) => [
    `${indent}${treeRow(node)}`,
    ...treeLines(node.children ?? [], node.hiddenChildren, depth + 1),
  ]);
  return hidden ? [...lines, `${indent}(+${hidden} hidden)`] : lines;
}

/**
 * The tree block.
 *
 * @param data - Inspect result
 * @returns Lines (none without children)
 */
function treeBlock(data: InspectOutput): string[] {
  if (!data.children && !data.hiddenChildren) return [];
  return [
    'tree',
    ...treeLines(data.children ?? [], data.hiddenChildren, 1),
    ...(data.moreRows ? [`  … +${data.moreRows} more`] : []),
  ];
}

/**
 * `--all` properties packed into lines of about {@link ALL_LINE_WIDTH} characters.
 *
 * @param all - Properties and values
 * @returns Lines
 */
function allLines(all: Record<string, string>): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  for (const [name, value] of Object.entries(all)) {
    current.push(`${name} ${value}`);
    if (current.join(' · ').length > ALL_LINE_WIDTH) {
      lines.push(current.join(' · '));
      current = [];
    }
  }
  if (current.length > 0) lines.push(current.join(' · '));
  return lines.map((line, i) => `${(i === 0 ? 'all' : '').padEnd(LABEL_WIDTH)}${line}`);
}

/**
 * `--props` lines: the computed value, and the normalized one when it differs.
 *
 * @param props - Properties asked for
 * @returns Lines
 */
function propLines(props: NonNullable<InspectResult['props']>): string[] {
  return Object.entries(props).map(
    ([name, prop]) =>
      `${name}: ${prop.computed || '(empty)'}${prop.value !== prop.computed ? ` = ${prop.value}` : ''}`
  );
}

/**
 * The style group lines.
 *
 * @param data - Inspect result
 * @returns Lines
 */
function groupLines(data: InspectOutput): Array<string | undefined> {
  return [
    data.box && boxLine(data.box),
    data.layout && layoutLine(data.layout),
    data.layout && parentLine(data.layout),
    data.text && textLine(data.text),
    fillLine(data),
    borderLine(data),
    fxLine(data),
    stateLine(data),
    ...pseudoLines(data.pseudo),
  ];
}

/**
 * Format `bdg dom inspect` output.
 *
 * @param data - Inspect result
 * @returns Formatted output
 */
export function formatInspect(data: InspectOutput): string {
  const body = data.props
    ? propLines(data.props)
    : data.all
      ? allLines(data.all)
      : groupLines(data);
  const note = data.picked
    ? multipleMatchesWarning(data.count, inspectedMatchAction(data.picked, data.index))
    : undefined;
  return joinLines(inspectHeader(data), ...body, ...treeBlock(data), note);
}
