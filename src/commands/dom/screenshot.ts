/**
 * `bdg dom screenshot` — capture page, element, or frame-sequence screenshots.
 */

import { extname } from 'path';

import type * as FsModule from 'fs';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import {
  capturePageScreenshot,
  captureElementScreenshot,
  resolveSelector,
  selectMatch,
} from '@/commands/dom/helpers/index.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { DomScreenshotCommandOptions } from '@/commands/shared/optionTypes.js';
import { assertFilePath, outputPathError } from '@/commands/shared/outputFile.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { CommandError } from '@/errors/index.js';
import { conflictingTargetError, genericError } from '@/errors/messages.js';
import { missingArgumentError } from '@/errors/messages.js';
import type { ScreenshotResult, ElementBounds, NodeRef } from '@/types.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { formatDomScreenshot } from '@/ui/formatters/dom.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { makeDirectory } from '@/utils/directories.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('dom');

/** Image format of each file extension Chrome can write */
const EXTENSION_FORMATS: Record<string, 'png' | 'jpeg'> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
};

/** Image extensions Chrome cannot capture (writing PNG bytes to them would mislead) */
const UNSUPPORTED_EXTENSIONS = new Set(['.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.svg']);

/**
 * Pick the image format for a file: `--format` if given, else the extension.
 *
 * @param outputPath - File to write
 * @param requested - `--format` value
 * @returns Format to capture in
 * @throws CommandError (81) when the extension and `--format` disagree or the
 *   extension names a format Chrome cannot capture
 */
export function resolveImageFormat(outputPath: string, requested?: 'png' | 'jpeg'): 'png' | 'jpeg' {
  const extension = extname(outputPath).toLowerCase();
  const fromExtension = EXTENSION_FORMATS[extension];
  if (
    UNSUPPORTED_EXTENSIONS.has(extension) ||
    (requested && fromExtension && requested !== fromExtension)
  ) {
    throw new CommandError(
      `Cannot write ${requested ?? 'a screenshot'} to a ${extension} file`,
      {
        suggestion:
          'Screenshots are png or jpeg: use a .png or .jpg file name (or --format to match it)',
      },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return requested ?? fromExtension ?? 'png';
}

type FilteredScreenshotOptions = {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  noResize?: boolean;
  scroll?: string;
};

type FilteredElementOptions = {
  format?: 'png' | 'jpeg';
  quality?: number;
  noResize?: boolean;
  padding?: number;
};

function buildPageScreenshotOptions(
  options: DomScreenshotCommandOptions
): FilteredScreenshotOptions {
  return filterDefined({
    format: options.format,
    quality: options.quality,
    fullPage: options.fullPage,
    noResize: options.resize === false,
    scroll: options.scroll,
  });
}

function buildElementScreenshotOptions(
  options: DomScreenshotCommandOptions
): FilteredElementOptions {
  return filterDefined({
    format: options.format,
    quality: options.quality,
    noResize: options.resize === false,
    padding: options.padding,
  });
}

function hasElementTarget(options: DomScreenshotCommandOptions): boolean {
  return options.selector !== undefined || options.index !== undefined;
}

async function resolveElementNodeId(options: DomScreenshotCommandOptions): Promise<NodeRef> {
  if (options.selector !== undefined && options.index !== undefined) {
    return { backendNodeId: await selectMatch(options.selector, options.index) };
  }
  if (options.index !== undefined) {
    const resolver = DomElementResolver.getInstance();
    const node = await resolver.getNodeIdForIndex(options.index);
    return { backendNodeId: node.nodeId };
  }

  if (options.selector !== undefined) {
    return resolveSelector(options.selector);
  }

  const err = missingArgumentError('--selector "css-selector" or --index N from a previous query');
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

function addElementInfo(
  result: ScreenshotResult,
  options: DomScreenshotCommandOptions
): ScreenshotResult {
  const bounds: ElementBounds = result.element?.bounds ?? {
    x: 0,
    y: 0,
    width: result.width,
    height: result.height,
  };

  return {
    ...result,
    element: {
      ...(options.selector !== undefined && { selector: options.selector }),
      ...(options.index !== undefined && { index: options.index }),
      bounds,
      ...(result.element?.captured && { captured: result.element.captured }),
    },
  };
}

/**
 * Make sure `--follow` has a directory to write frames to.
 *
 * @param dirPath - Directory the user gave
 * @param fs - File system module
 * @throws CommandError (81) when the path is a file, or naming the problem when it cannot be created
 */
function ensureDirectory(dirPath: string, fs: typeof FsModule): void {
  if (fs.existsSync(dirPath) && !fs.statSync(dirPath).isDirectory()) {
    throw new CommandError(
      `--follow needs a directory, but ${dirPath} is a file`,
      { suggestion: 'Give a directory for the frames, e.g. bdg dom screenshot ./frames --follow' },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  try {
    makeDirectory(dirPath);
  } catch (error) {
    throw outputPathError(dirPath, error);
  }
}

function formatFrameFilename(frameNumber: number, format: string): string {
  return `${String(frameNumber).padStart(3, '0')}.${format}`;
}

async function handlePageScreenshot(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const screenshotOptions = buildPageScreenshotOptions(options);
      const result = await capturePageScreenshot(outputPath, screenshotOptions);
      return { success: true, data: result };
    },
    options,
    formatDomScreenshot
  );
}

async function handleElementScreenshot(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  await runCommand(
    async () => {
      const nodeRef = await resolveElementNodeId(options);
      const screenshotOptions = buildElementScreenshotOptions(options);
      const result = await captureElementScreenshot(outputPath, nodeRef, screenshotOptions);
      const elementResult = addElementInfo(result, options);
      return { success: true, data: elementResult };
    },
    options,
    formatDomScreenshot
  );
}

async function captureSequenceFrame(
  outputPath: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  if (hasElementTarget(options)) {
    const nodeRef = await resolveElementNodeId(options);
    const elementOptions = buildElementScreenshotOptions(options);
    await captureElementScreenshot(outputPath, nodeRef, elementOptions);
  } else {
    const pageOptions = buildPageScreenshotOptions(options);
    await capturePageScreenshot(outputPath, pageOptions);
  }
}

async function handleSequenceCapture(
  outputDir: string,
  options: DomScreenshotCommandOptions
): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const absoluteDir = path.resolve(outputDir);
  ensureDirectory(absoluteDir, fs);

  const intervalRule = positiveIntRule({ name: '--interval', min: 100, max: 60000, default: 1000 });
  const limitRule = positiveIntRule({ name: '--limit', min: 1, max: 10000, required: false });

  const interval = intervalRule.validate(options.interval);
  const limit = options.limit ? limitRule.validate(options.limit) : 0;

  const format = options.format ?? 'png';
  let frameCount = 0;
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
  });

  console.error(`Capturing to ${absoluteDir} every ${interval}ms...`);
  while (!stopping) {
    frameCount++;
    const filename = formatFrameFilename(frameCount, format);
    const outputPath = path.join(absoluteDir, filename);
    try {
      await captureSequenceFrame(outputPath, options);
    } catch (error) {
      reportSequenceError(error, frameCount - 1, options.json ?? false);
    }
    if (options.json) {
      console.log(JSON.stringify(buildSuccessResponse({ frame: frameCount, path: outputPath })));
    } else {
      log.info(`Frame ${frameCount}: ${filename}`);
    }
    if (limit > 0 && frameCount >= limit) break;
    await delay(interval);
  }
  console.error(`Captured ${frameCount} frames`);
  process.exit(EXIT_CODES.SUCCESS);
}

/**
 * End a capture sequence on an error (e.g. the element disappeared): print
 * it (one JSON line with `--json`, like the frames) and exit with its code.
 *
 * @param error - Capture error
 * @param captured - Frames captured before it
 * @param json - JSON output
 */
function reportSequenceError(error: unknown, captured: number, json: boolean): never {
  const exitCode = error instanceof CommandError ? error.exitCode : EXIT_CODES.SOFTWARE_ERROR;
  const suggestion =
    error instanceof CommandError && typeof error.metadata['suggestion'] === 'string'
      ? error.metadata['suggestion']
      : undefined;
  const message = getErrorMessage(error);
  if (json) {
    console.log(
      JSON.stringify(
        OutputBuilder.buildJsonError(message, { exitCode, ...(suggestion && { suggestion }) })
      )
    );
  } else {
    console.error(genericError(message));
    if (suggestion) console.error(suggestion);
  }
  console.error(`Captured ${captured} frames`);
  process.exit(exitCode);
}

/**
 * Reject options that would be ignored: `--quality` for a PNG, and
 * `--padding` without an element.
 *
 * @param outputPath - File to write
 * @param options - Command options
 * @throws CommandError (81) for a conflict
 */
function assertScreenshotOptions(outputPath: string, options: DomScreenshotCommandOptions): void {
  let message: string | undefined;
  if (options.padding !== undefined && !hasElementTarget(options)) {
    message = '--padding applies to element captures; name an element (selector or index)';
  } else if (
    options.quality !== undefined &&
    !options.follow &&
    resolveImageFormat(outputPath, options.format) === 'png'
  ) {
    message = '--quality applies to JPEG only; this screenshot is a PNG';
  }
  if (message) throw new CommandError(message, {}, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Fold the optional positional target (`bdg dom screenshot out.png "#sel"`,
 * or an index from a query) into `--selector` / `--index`.
 *
 * @param target - Positional selector or index, if given
 * @param options - Command options
 * @returns Options with the target as `selector` or `index`
 * @throws CommandError (81) when the option names a different element
 */
export function withPositionalTarget(
  target: string | undefined,
  options: DomScreenshotCommandOptions
): DomScreenshotCommandOptions {
  if (target === undefined) return options;
  const isIndex = /^\d+$/.test(target);
  const key = isIndex ? 'index' : 'selector';
  const value = isIndex ? Number(target) : target;
  const given = options[key];
  if (given !== undefined && given !== value) {
    const err = conflictingTargetError(`--${key} ${String(given)}`, target);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return { ...options, [key]: value };
}

/**
 * Handle `bdg dom screenshot <path> [selector|index]`.
 *
 * Dispatches to page, element, or sequence capture based on flags.
 */
export async function handleDomScreenshot(
  outputPath: string,
  target: string | undefined,
  commandOptions: DomScreenshotCommandOptions
): Promise<void> {
  const options = withPositionalTarget(target, commandOptions);
  assertScreenshotOptions(outputPath, options);
  if (options.follow) {
    await handleSequenceCapture(outputPath, options);
    return;
  }

  assertFilePath(outputPath);
  const captureOptions = { ...options, format: resolveImageFormat(outputPath, options.format) };
  if (hasElementTarget(captureOptions)) {
    await handleElementScreenshot(outputPath, captureOptions);
    return;
  }

  await handlePageScreenshot(outputPath, captureOptions);
}
