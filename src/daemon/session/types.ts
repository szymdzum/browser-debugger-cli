import type { TelemetryType } from '@/types.js';

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
}
