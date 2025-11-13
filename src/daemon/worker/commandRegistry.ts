import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { queryBySelector, getNodeInfo, createNodePreview } from '@/connection/domOperations.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { CommandName, CommandSchemas, WorkerStatusData } from '@/ipc/commands.js';
import { writeQueryCache, getNodeIdByIndex } from '@/session/queryCache.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { filterDefined } from '@/utils/objects.js';
import { VERSION } from '@/utils/version.js';

type Handler<K extends CommandName> = (
  cdp: CDPConnection,
  params: CommandSchemas[K]['requestSchema']
) => Promise<CommandSchemas[K]['responseSchema']>;

export type CommandRegistry = {
  [K in CommandName]: Handler<K>;
};

const HIGHLIGHT_COLORS = {
  red: { r: 255, g: 0, b: 0, a: 0.5 },
  blue: { r: 0, g: 0, b: 255, a: 0.5 },
  green: { r: 0, g: 255, b: 0, a: 0.5 },
  yellow: { r: 255, g: 255, b: 0, a: 0.5 },
  orange: { r: 255, g: 165, b: 0, a: 0.5 },
  purple: { r: 128, g: 0, b: 128, a: 0.5 },
} as const;

export function createCommandRegistry(store: TelemetryStore): CommandRegistry {
  return {
    dom_query: async (cdp, params) => {
      await cdp.send('DOM.enable');

      const nodeIds = await queryBySelector(cdp, params.selector);

      const nodes: Array<{
        index: number;
        nodeId: number;
        tag?: string;
        classes?: string[];
        preview?: string;
      }> = [];

      for (let i = 0; i < nodeIds.length; i++) {
        const nodeId = nodeIds[i];
        if (nodeId === undefined) continue;

        const nodeInfo = await getNodeInfo(cdp, nodeId);
        nodes.push({
          index: i + 1,
          nodeId: nodeInfo.nodeId,
          ...filterDefined({
            tag: nodeInfo.tag,
            classes: nodeInfo.classes,
          }),
          preview: createNodePreview(nodeInfo),
        });
      }

      writeQueryCache({
        selector: params.selector,
        timestamp: new Date().toISOString(),
        nodes,
      });

      return {
        selector: params.selector,
        count: nodes.length,
        nodes,
      };
    },

    dom_highlight: async (cdp, params) => {
      await cdp.send('DOM.enable');
      await cdp.send('Overlay.enable');

      let nodeIds: number[] = [];

      if (params.nodeId !== undefined) {
        nodeIds = [params.nodeId];
      } else if (params.index !== undefined) {
        const nodeId = getNodeIdByIndex(params.index);
        if (!nodeId) {
          throw new Error(
            `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
          );
        }
        nodeIds = [nodeId];
      } else if (params.selector) {
        nodeIds = await queryBySelector(cdp, params.selector);

        if (nodeIds.length === 0) {
          throw new Error(`No elements found matching "${params.selector}"`);
        }

        if (params.first) {
          const firstNode = nodeIds[0];
          if (firstNode === undefined) {
            throw new Error('No elements found');
          }
          nodeIds = [firstNode];
        } else if (params.nth !== undefined) {
          if (params.nth < 1 || params.nth > nodeIds.length) {
            throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
          }
          const nthNode = nodeIds[params.nth - 1];
          if (nthNode === undefined) {
            throw new Error(`Element at index ${params.nth} not found`);
          }
          nodeIds = [nthNode];
        }
      } else {
        throw new Error('Either selector, index, or nodeId must be provided');
      }

      const colorName = (params.color ?? 'red') as keyof typeof HIGHLIGHT_COLORS;
      const color = HIGHLIGHT_COLORS[colorName] ?? HIGHLIGHT_COLORS.red;
      const opacity = params.opacity ?? color.a;

      for (const nodeId of nodeIds) {
        await cdp.send('Overlay.highlightNode', {
          highlightConfig: {
            contentColor: { ...color, a: opacity },
          },
          nodeId,
        });
      }

      return {
        highlighted: nodeIds.length,
        nodeIds,
      };
    },

    dom_get: async (cdp, params) => {
      await cdp.send('DOM.enable');

      let nodeIds: number[] = [];

      if (params.nodeId !== undefined) {
        nodeIds = [params.nodeId];
      } else if (params.index !== undefined) {
        const nodeId = getNodeIdByIndex(params.index);
        if (!nodeId) {
          throw new Error(
            `No cached element at index ${params.index}. Run 'bdg dom query <selector>' first.`
          );
        }
        nodeIds = [nodeId];
      } else if (params.selector) {
        nodeIds = await queryBySelector(cdp, params.selector);

        if (nodeIds.length === 0) {
          throw new Error(`No elements found matching "${params.selector}"`);
        }

        if (params.nth !== undefined) {
          if (params.nth < 1 || params.nth > nodeIds.length) {
            throw new Error(`--nth ${params.nth} out of range (found ${nodeIds.length} elements)`);
          }
          const nthNode = nodeIds[params.nth - 1];
          if (nthNode === undefined) {
            throw new Error(`Element at index ${params.nth} not found`);
          }
          nodeIds = [nthNode];
        } else if (!params.all) {
          const firstNode = nodeIds[0];
          if (firstNode === undefined) {
            throw new Error('No elements found');
          }
          nodeIds = [firstNode];
        }
      } else {
        throw new Error('Either selector, index, or nodeId must be provided');
      }

      const nodes = [];
      for (const nodeId of nodeIds) {
        const info = await getNodeInfo(cdp, nodeId);
        nodes.push({
          nodeId: info.nodeId,
          ...filterDefined({
            tag: info.tag,
            attributes: info.attributes,
            classes: info.classes,
            outerHTML: info.outerHTML,
          }),
        });
      }

      return {
        nodes,
      };
    },

    dom_screenshot: async (cdp, params) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const absolutePath = path.resolve(params.path);

      const parentDir = path.dirname(absolutePath);
      try {
        await fs.mkdir(parentDir, { recursive: true });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'EEXIST') {
          throw new Error(`Cannot create directory ${parentDir}: ${getErrorMessage(error)}`);
        }
      }

      const format = params.format ?? 'png';
      const quality = params.quality;
      const fullPage = params.fullPage ?? true;

      if (format === 'jpeg' && quality !== undefined && (quality < 0 || quality > 100)) {
        throw new Error('JPEG quality must be between 0 and 100');
      }

      const screenshotParams: Record<string, unknown> = {
        format,
        ...filterDefined({
          quality: format === 'jpeg' ? quality : undefined,
          captureBeyondViewport: fullPage ? true : undefined,
        }),
      };

      const response = (await cdp.send(
        'Page.captureScreenshot',
        screenshotParams
      )) as Protocol.Page.CaptureScreenshotResponse;
      const imageData = Buffer.from(response.data, 'base64');

      await fs.writeFile(absolutePath, imageData);
      const stats = await fs.stat(absolutePath);

      let viewport: { width: number; height: number } | undefined;
      if (!fullPage) {
        const metrics = (await cdp.send(
          'Page.getLayoutMetrics'
        )) as Protocol.Page.GetLayoutMetricsResponse;
        viewport = {
          width: metrics.layoutViewport.clientWidth,
          height: metrics.layoutViewport.clientHeight,
        };
      }

      const layoutMetrics = (await cdp.send(
        'Page.getLayoutMetrics'
      )) as Protocol.Page.GetLayoutMetricsResponse;

      return {
        path: absolutePath,
        format,
        ...(format === 'jpeg' && quality !== undefined && { quality }),
        width: layoutMetrics.contentSize.width,
        height: layoutMetrics.contentSize.height,
        size: stats.size,
        ...(viewport && { viewport }),
        fullPage,
      };
    },

    worker_peek: async (_cdp, params) => {
      const lastN = Math.min(params.lastN ?? 10, 100);
      const duration = Date.now() - store.sessionStartTime;

      const recentNetwork = store.networkRequests.slice(-lastN).map((req) => ({
        requestId: req.requestId,
        timestamp: req.timestamp,
        method: req.method,
        url: req.url,
        ...(req.status !== undefined && { status: req.status }),
        ...(req.mimeType !== undefined && { mimeType: req.mimeType }),
      }));

      const recentConsole = store.consoleMessages.slice(-lastN).map((msg) => ({
        timestamp: msg.timestamp,
        type: msg.type,
        text: msg.text,
      }));

      return Promise.resolve({
        version: VERSION,
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        network: recentNetwork,
        console: recentConsole,
      });
    },

    worker_details: async (_cdp, params) => {
      if (params.itemType === 'network') {
        const request = store.networkRequests.find((r) => r.requestId === params.id);
        if (!request) {
          return Promise.reject(new Error(`Network request not found: ${params.id}`));
        }

        return Promise.resolve({ item: request });
      } else if (params.itemType === 'console') {
        const index = parseInt(params.id, 10);
        if (isNaN(index) || index < 0 || index >= store.consoleMessages.length) {
          return Promise.reject(
            new Error(
              `Console message not found at index: ${params.id} (available: 0-${store.consoleMessages.length - 1})`
            )
          );
        }

        const message = store.consoleMessages[index];
        if (!message) {
          return Promise.reject(new Error(`Console message not found at index: ${params.id}`));
        }

        return Promise.resolve({ item: message });
      }
      return Promise.reject(
        new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
      );
    },

    worker_status: async (_cdp, _params) => {
      const duration = Date.now() - store.sessionStartTime;

      const lastNetworkRequest = store.networkRequests[store.networkRequests.length - 1];
      const lastConsoleMessage = store.consoleMessages[store.consoleMessages.length - 1];

      const result: WorkerStatusData = {
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        activity: {
          networkRequestsCaptured: store.networkRequests.length,
          consoleMessagesCaptured: store.consoleMessages.length,
          ...(lastNetworkRequest?.timestamp !== undefined && {
            lastNetworkRequestAt: lastNetworkRequest.timestamp,
          }),
          ...(lastConsoleMessage?.timestamp !== undefined && {
            lastConsoleMessageAt: lastConsoleMessage.timestamp,
          }),
        },
      };

      return Promise.resolve(result);
    },

    cdp_call: async (cdp, params) => {
      const result = await cdp.send(params.method, params.params ?? {});
      return { result };
    },
  } as CommandRegistry;
}
