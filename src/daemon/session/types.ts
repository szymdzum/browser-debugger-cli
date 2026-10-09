import type { DialogAnswer } from '@/ipc/protocol/domTypes.js';
import type { ColorScheme, TelemetryType, ViewportSize } from '@/types.js';

export interface SessionConfig {
  url: string;
  port: number;
  timeout?: number;
  telemetry?: TelemetryType[];
  includeAll?: boolean;
  userDataDir?: string;
  maxBodySize?: number;
  headless?: boolean;
  chromeWsUrl?: string;
  /** Custom Chrome flags (e.g., ['--ignore-certificate-errors']) */
  chromeFlags?: string[];
  /** Viewport size to emulate (`--viewport`) */
  viewport?: ViewportSize;
  /** `prefers-color-scheme` to emulate (`--color-scheme`) */
  colorScheme?: ColorScheme;
  /** How dialogs no action chose an answer for are answered (`--dialog`; default accept) */
  dialog?: DialogAnswer;
}
