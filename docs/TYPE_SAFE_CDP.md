# Type-Safe CDP API

This document describes the type-safe CDP (Chrome DevTools Protocol) API available in bdg.

## Overview

bdg now provides **compile-time type safety** for all CDP operations using official TypeScript definitions from the [`devtools-protocol`](https://www.npmjs.com/package/devtools-protocol) package.

**Benefits:**
- ✅ Autocomplete for 300+ CDP methods across 53 domains
- ✅ Type-checked parameters and return values
- ✅ Type-safe event handlers
- ✅ Zero runtime overhead (types erased at compile time)
- ✅ Always up-to-date with latest Chrome DevTools Protocol

## Quick Start

### Basic Usage

```typescript
import { CDPConnection } from '@/connection/cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';

// Create connections
const cdp = new CDPConnection(wsUrl);
await cdp.connect();

const typed = new TypedCDPConnection(cdp);

// Type-safe command with autocomplete
const cookies = await typed.send('Network.getCookies', {
  urls: ['http://example.com']
});
// cookies type: Protocol.Network.GetCookiesResponse
// cookies.cookies type: Protocol.Network.Cookie[]

// Type-safe event handler
typed.on('Network.requestWillBeSent', (event) => {
  // event type: Protocol.Network.RequestWillBeSentEvent
  // Full autocomplete available:
  console.log(event.request.url);
  console.log(event.request.method);
  console.log(event.request.headers);
});
```

### With Handler Registry

```typescript
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';

const registry = new CDPHandlerRegistry();
const typed = new TypedCDPConnection(cdp);

// Register type-safe handlers
registry.registerTyped(typed, 'Network.requestWillBeSent', (event) => {
  // event is fully typed
  console.log(event.request.url);
});

registry.registerTyped(typed, 'Runtime.consoleAPICalled', (event) => {
  // event is fully typed
  console.log(event.type, event.args);
});

// Cleanup all handlers at once
registry.cleanup(cdp);
```

## Available Types

### Protocol Namespace

Access all CDP types via the `Protocol` namespace:

```typescript
import type { Protocol } from '@/connection/typed-cdp.js';

// Network types
type Cookie = Protocol.Network.Cookie;
type Headers = Protocol.Network.Headers;
type Request = Protocol.Network.Request;
type Response = Protocol.Network.Response;

// Runtime types
type RemoteObject = Protocol.Runtime.RemoteObject;
type ExecutionContextId = Protocol.Runtime.ExecutionContextId;

// DOM types
type NodeId = Protocol.DOM.NodeId;
type Node = Protocol.DOM.Node;

// Page types
type FrameId = Protocol.Page.FrameId;
type Frame = Protocol.Page.Frame;
```

### Command Signatures

All 300+ CDP commands are typed with their exact parameter and return types:

```typescript
// Network domain
await typed.send('Network.getCookies', { urls: ['http://example.com'] });
// Parameters: { urls?: string[] }
// Returns: Protocol.Network.GetCookiesResponse

await typed.send('Network.setCookie', {
  name: 'session',
  value: 'abc123',
  url: 'http://example.com'
});
// Parameters: Protocol.Network.SetCookieRequest
// Returns: { success: boolean }

// Runtime domain
await typed.send('Runtime.evaluate', {
  expression: 'document.title',
  returnByValue: true
});
// Parameters: Protocol.Runtime.EvaluateRequest
// Returns: Protocol.Runtime.EvaluateResponse

// DOM domain
await typed.send('DOM.getDocument', {});
// Parameters: { depth?: number, pierce?: boolean }
// Returns: Protocol.DOM.GetDocumentResponse
```

### Event Signatures

All CDP events are typed with their exact parameter types:

```typescript
// Network events
typed.on('Network.requestWillBeSent', (event: Protocol.Network.RequestWillBeSentEvent) => {
  event.requestId; // string
  event.request; // Protocol.Network.Request
  event.timestamp; // Protocol.Network.MonotonicTime
});

// Console events
typed.on('Runtime.consoleAPICalled', (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
  event.type; // 'log' | 'debug' | 'info' | 'error' | 'warning' | ...
  event.args; // Protocol.Runtime.RemoteObject[]
  event.timestamp; // Protocol.Runtime.Timestamp
});

// Page events
typed.on('Page.loadEventFired', (event: Protocol.Page.LoadEventFiredEvent) => {
  event.timestamp; // Protocol.Network.MonotonicTime
});

// DOM events
typed.on('DOM.documentUpdated', () => {
  // No parameters
});
```

## API Reference

### TypedCDPConnection

Type-safe wrapper around `CDPConnection`.

#### Methods

**`send<T>(method: T, params: CommandParams<T>): Promise<CommandReturn<T>>`**

Send a type-safe CDP command.

- **method**: CDP method name (autocomplete shows all 300+ methods)
- **params**: Command parameters (type-checked based on method)
- **returns**: Promise resolving to command response (type-safe)

**`on<T>(event: T, handler: (params: EventParams<T>) => void): number`**

Register a type-safe event handler.

- **event**: CDP event name (autocomplete available)
- **handler**: Event handler with type-safe parameters
- **returns**: Handler ID for later removal

**`off(event: string, handlerId: number): void`**

Remove an event handler by ID.

- **event**: CDP event name
- **handlerId**: Handler ID returned from `on()`

**`get raw(): CDPConnection`**

Access underlying `CDPConnection` for advanced use cases.

### CDPHandlerRegistry

Registry for managing CDP event handlers with automatic cleanup.

#### Methods

**`register<T>(cdp: CDPConnection, event: string, handler: (params: T) => void): void`**

Register a CDP event handler (legacy untyped API).

**Deprecated**: Use `registerTyped()` for type safety.

**`registerTyped<T>(typed: TypedCDPConnection, event: T, handler: (params: EventParams<T>) => void): void`**

Register a type-safe CDP event handler.

- **typed**: TypedCDPConnection instance
- **event**: CDP event name (autocomplete available)
- **handler**: Event handler with type-safe parameters

**`cleanup(cdp: CDPConnection): void`**

Remove all registered event handlers and clear the registry.

- **cdp**: CDP connection instance (or `TypedCDPConnection.raw`)

**`size(): number`**

Get the number of registered handlers.

## Migration Guide

### From Untyped to Typed

**Before (untyped):**
```typescript
const cookies = await cdp.send('Network.getCookies', { urls: ['http://example.com'] });
// cookies type: unknown (no type safety)

cdp.on('Network.requestWillBeSent', (params: any) => {
  // params type: any (no autocomplete)
  console.log(params.request.url);
});
```

**After (typed):**
```typescript
const typed = new TypedCDPConnection(cdp);

const cookies = await typed.send('Network.getCookies', { urls: ['http://example.com'] });
// cookies type: Protocol.Network.GetCookiesResponse (fully typed!)

typed.on('Network.requestWillBeSent', (event) => {
  // event type: Protocol.Network.RequestWillBeSentEvent (autocomplete!)
  console.log(event.request.url);
});
```

### With Handler Registry

**Before (untyped):**
```typescript
registry.register<CDPNetworkRequestParams>(
  cdp,
  'Network.requestWillBeSent',
  (params) => {
    // Manual type annotation required
    console.log(params.request.url);
  }
);
```

**After (typed):**
```typescript
registry.registerTyped(typed, 'Network.requestWillBeSent', (event) => {
  // Type inferred automatically, full autocomplete
  console.log(event.request.url);
});
```

## Examples

### Network Monitoring

```typescript
import { TypedCDPConnection, Protocol } from '@/connection/typed-cdp.js';

const typed = new TypedCDPConnection(cdp);
const requests: Protocol.Network.Request[] = [];

// Enable network tracking
await typed.send('Network.enable', {});

// Monitor requests
typed.on('Network.requestWillBeSent', (event) => {
  requests.push(event.request);
  console.log(`${event.request.method} ${event.request.url}`);
});

// Get cookies
const { cookies } = await typed.send('Network.getCookies', {});
cookies.forEach((cookie) => {
  console.log(`${cookie.name}=${cookie.value}`);
});
```

### Runtime Evaluation

```typescript
// Evaluate JavaScript with type-safe result
const result = await typed.send('Runtime.evaluate', {
  expression: 'document.querySelectorAll("a").length',
  returnByValue: true
});

if (!result.exceptionDetails) {
  const linkCount = result.result.value as number;
  console.log(`Found ${linkCount} links`);
}
```

### DOM Manipulation

```typescript
// Get document
const { root } = await typed.send('DOM.getDocument', { depth: -1 });

// Query selector
const { nodeId } = await typed.send('DOM.querySelector', {
  nodeId: root.nodeId,
  selector: '#main'
});

// Get outer HTML
const { outerHTML } = await typed.send('DOM.getOuterHTML', { nodeId });
console.log(outerHTML);
```

## Type Safety Benefits

### Autocomplete

IDE autocomplete works for:
- ✅ All method names (300+ methods)
- ✅ All parameter names and types
- ✅ All return value properties
- ✅ All event names
- ✅ All event parameter properties

### Compile-Time Errors

TypeScript catches errors at compile time:

```typescript
// ❌ Error: unknown method
await typed.send('Network.getFoo', {});
// Property 'Network.getFoo' does not exist

// ❌ Error: invalid parameter
await typed.send('Network.getCookies', { foo: 'bar' });
// Object literal may only specify known properties

// ❌ Error: missing required parameter
await typed.send('DOM.querySelector', { selector: '#main' });
// Argument of type '{ selector: string }' is not assignable
// Property 'nodeId' is missing

// ✅ Correct usage
await typed.send('DOM.querySelector', {
  nodeId: rootNodeId,
  selector: '#main'
});
```

### Type Inference

Return types are automatically inferred:

```typescript
const response = await typed.send('Network.getCookies', {});
// response type: Protocol.Network.GetCookiesResponse

response.cookies.forEach((cookie) => {
  // cookie type: Protocol.Network.Cookie
  console.log(cookie.name, cookie.value, cookie.domain);
  // All properties have autocomplete!
});
```

## Performance

The type-safe API has **zero runtime overhead**:
- All types are erased at compile time
- No additional runtime checks or wrappers
- Same performance as untyped API

## References

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [devtools-protocol npm package](https://www.npmjs.com/package/devtools-protocol)
- [Protocol Viewer](https://chromedevtools.github.io/devtools-protocol/) - Browse all domains and methods
