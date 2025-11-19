# Telemetry Plugin Architecture

_Last updated: November 2025_

## Overview

The bdg worker no longer hardcodes CDP collectors inside `worker.ts`. Instead,
a lightweight plugin system coordinates telemetry modules:

- `TelemetryStore` (`src/daemon/worker/TelemetryStore.ts`) holds all mutable
  session state.
- `TelemetryPlugin` (`src/daemon/worker/plugins.ts`) describes a collector with
  a `start()` function returning a cleanup callback.
- `startTelemetryCollectors()` (`src/daemon/worker/collectors.ts`) pulls the
  registered plugin list and runs the ones that apply to the current session.

This keeps the worker lifecycle simple and makes it easy to add or replace
collectors without touching core code.

## TelemetryPlugin Contract

```
export interface TelemetryPlugin {
  name: string;                 // unique identifier
  runAlways?: boolean;          // true for mandatory plugins (dialogs, navigation)
  telemetry?: TelemetryType;    // 'network' | 'console' | 'dom'
  start(ctx: TelemetryPluginContext): Promise<CleanupFunction>;
}
```

`TelemetryPluginContext` provides:

| Field   | Description |
| ------- | ----------- |
| `cdp`   | Live `CDPConnection` already connected to Chrome |
| `config`| Sanitized worker config (port, timeout, includeAll, etc.) |
| `store` | `TelemetryStore` with network/console buffers, DOM data, navigation events |
| `logger`| Worker logger scoped to `worker` |

Plugins push data into the store and must return a cleanup function. The
worker executes all cleanups during normal shutdown and crash handling.

## Default Plugins

`createDefaultTelemetryPlugins()` defines five plugins:

| Plugin    | Type        | Purpose |
|-----------|-------------|---------|
| `dialogs` | `runAlways` | Auto-dismiss JavaScript dialogs |
| `navigation` | `runAlways` | Track navigation events and expose `getCurrentNavigationId` |
| `network` | `telemetry: 'network'` | Subscribe to `Network.*` events and store requests |
| `console` | `telemetry: 'console'` | Subscribe to `Runtime.consoleAPICalled`/`exceptionThrown` |
| `dom`     | `telemetry: 'dom'` | Prepare DOM/Runtime domains for snapshots |

## Extending the Registry

`plugins.ts` keeps a registry seeded with the defaults and exposes helpers:

```ts
import { registerTelemetryPlugin, getRegisteredTelemetryPlugins } from '@/daemon/worker/plugins.js';

registerTelemetryPlugin({
  name: 'performance',
  telemetry: 'network',
  async start({ cdp, store, logger }) {
    const id = cdp.on('Performance.metrics', (event) => {
      store.customMetrics ??= [];
      store.customMetrics.push(event);
    });
    return () => cdp.off('Performance.metrics', id);
  },
});
```

* Calling `registerTelemetryPlugin` replaces any existing plugin with the same
  name.
* `getRegisteredTelemetryPlugins()` returns a copy of the registry; tests can
  call `resetTelemetryPlugins()` to restore the defaults.
* `startTelemetryCollectors()` already accepts an optional plugin array, so
  integration tests can inject custom plugin sets without touching the global
  registry.

## Usage Guidelines

1. **Add state to the store, not globals.** If your plugin needs new buffers,
   extend `TelemetryStore` so the data is available to command handlers and
   serialization.
2. **Keep collectors optional.** Use `telemetry: 'network'`/`'console'`/`'dom'`
   to tie plugins to CLI flags. Set `runAlways` only for collectors that must
   run regardless of options (dialogs/navigation).
3. **Return cleanups.** Collectors must release CDP handlers, timers, or
   resources in their cleanup function.
4. **Document plugins.** If a plugin adds new commands or output data, update
   the relevant docs/README to describe the behavior.

## Future Work

- **Configuration surface:** today, third-party plugins must call
  `registerTelemetryPlugin` in code. We may add env/config-based loading if the
  need arises.
- **Observability:** consider per-plugin log contexts or metrics if more
  collectors ship.
