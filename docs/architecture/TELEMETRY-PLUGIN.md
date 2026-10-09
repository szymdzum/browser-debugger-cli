# Telemetry Plugin Architecture

_Last updated: October 2026_

## Overview

The bdg session does not hardcode CDP collectors inside `Session.ts`. Instead,
a lightweight plugin system coordinates telemetry modules. The session runs
in-process inside the daemon, so plugins share the daemon's CDP connection:

- `TelemetryStore` (`src/daemon/session/TelemetryStore.ts`) holds all mutable
  session state.
- `TelemetryPlugin` (`src/daemon/session/plugins.ts`) describes a collector with
  a `start()` function returning a cleanup callback.
- `startTelemetryCollectors()` (`src/daemon/session/collectors.ts`) pulls the
  registered plugin list and runs the ones that apply to the current session.
  It is called from `setupCDPAndNavigate()` (`src/daemon/session/cdpSetup.ts`)
  after CDP connects and before the page is navigated.

This keeps the session lifecycle simple and makes it easy to add or replace
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
| `config`| `SessionConfig` (port, timeout, telemetry, includeAll, maxBodySize, etc.) |
| `store` | `TelemetryStore` with network/console/WebSocket buffers, DOM data, navigation events |
| `logger`| Session logger scoped to `session` |

Plugins push data into the store and must return a cleanup function. The
session runs all cleanups in `teardownSession()`
(`src/daemon/session/teardown.ts`) whenever it ends: `bdg stop`, Chrome/CDP
disconnect, `--timeout`, daemon signals, or a failed start.

## Default Plugins

`createDefaultTelemetryPlugins()` defines six plugins:

| Plugin    | Type        | Purpose |
|-----------|-------------|---------|
| `dialogs` | `runAlways` | Answer JavaScript dialogs as they open (`--dialog`; accept by default) |
| `navigation` | `runAlways` | Track navigation events and expose `getCurrentNavigationId` |
| `network` | `telemetry: 'network'` | Subscribe to `Network.*` events and store requests |
| `websocket` | `telemetry: 'network'` | Track WebSocket connections and frames |
| `console` | `telemetry: 'console'` | Subscribe to `Runtime.consoleAPICalled`/`exceptionThrown` |
| `dom`     | `telemetry: 'dom'` | Prepare Page/DOM/Runtime domains for snapshots |

## Extending the Registry

`plugins.ts` builds a module-level registry from
`createDefaultTelemetryPlugins()` and exposes it through
`getRegisteredTelemetryPlugins()`, which returns a copy. There is no runtime
registration API: to add a collector, add an entry to
`createDefaultTelemetryPlugins()`. For example, assuming a new
`performanceMetrics` buffer on `TelemetryStore`:

```ts
{
  name: 'performance',
  telemetry: 'network',
  async start({ cdp, store }) {
    await cdp.send('Performance.enable');
    return cdp.on('Performance.metrics', (event) => {
      store.performanceMetrics.push(event);
    });
  },
},
```

`cdp.on()` returns a function that unregisters the handler, so it can serve
directly as the plugin's cleanup.

* `shouldActivatePlugin()` runs a plugin if `runAlways` is set, or if its
  `telemetry` type is in the session's active telemetry list.
* `startTelemetryCollectors()` accepts an optional plugin array, so tests can
  inject custom plugin sets without touching the default registry.

## Usage Guidelines

1. **Add state to the store, not globals.** If your plugin needs new buffers,
   extend `TelemetryStore` so the data is available to command handlers
   (`src/daemon/session/commandRegistry.ts`).
2. **Keep collectors optional.** Use `telemetry: 'network'`/`'console'`/`'dom'`
   to tie plugins to CLI flags. Set `runAlways` only for collectors that must
   run regardless of options (dialogs/navigation).
3. **Return cleanups.** Collectors must release CDP handlers, timers, or
   resources in their cleanup function.
4. **Document plugins.** If a plugin adds new commands or output data, update
   the relevant docs/README to describe the behavior.

## Future Work

- **Configuration surface:** today, adding a plugin means editing
  `createDefaultTelemetryPlugins()`. We may add a registration API or
  env/config-based loading if the need arises.
- **Observability:** consider per-plugin log contexts or metrics if more
  collectors ship.
