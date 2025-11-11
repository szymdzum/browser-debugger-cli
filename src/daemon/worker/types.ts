import type { TelemetryType } from '@/types';

export interface WorkerConfig {
  url: string;
  port: number;
  timeout?: number;
  telemetry?: TelemetryType[];
  includeAll?: boolean;
  userDataDir?: string;
  maxBodySize?: number;
  headless?: boolean;
  chromeWsUrl?: string;
}
