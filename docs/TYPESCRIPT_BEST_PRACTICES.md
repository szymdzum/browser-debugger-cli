# TypeScript Best Practices Implementation Guide

This guide provides comprehensive TypeScript best practices specifically tailored for the bdg CLI project, incorporating 2024 industry standards and modern development patterns with a **pragmatic, incremental approach**.

## Table of Contents

- [Configuration](#configuration)
- [Type System Best Practices](#type-system-best-practices)
- [Import/Export Patterns](#importexport-patterns)
- [Error Handling](#error-handling)
- [Code Organization](#code-organization)
- [Performance Considerations](#performance-considerations)
- [Migration Strategy](#migration-strategy)
- [Tooling & Linting](#tooling--linting)

## Configuration

### Enhanced tsconfig.json

Our current `tsconfig.json` is good but can be improved with additional strict options:

```json
{
  "compilerOptions": {
    // Current settings (keep these)
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    // Additional strict options (recommended)
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "allowUnreachableCode": false,
    "noErrorTruncation": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Why These Options Matter

- **`noUncheckedIndexedAccess`**: Prevents `undefined` access errors when using array/object indexing
- **`noImplicitOverride`**: Requires explicit `override` keyword in class inheritance
- **`noPropertyAccessFromIndexSignature`**: Enforces consistent property access patterns
- **`exactOptionalPropertyTypes`**: Stricter handling of optional properties vs undefined
- **`noImplicitReturns`**: Ensures all code paths return a value
- **`noFallthroughCasesInSwitch`**: Prevents accidental switch statement fall-through

## Type System Best Practices

### 1. Eliminate `any` Usage

**Current Issues:**
```typescript
// ❌ Avoid - loses type safety
params?: Record<string, any>;
result?: any;
args?: any[];
```

**Recommended Approach (within existing files):**
```typescript
// ✅ Better - use specific types or generics in src/types.ts
interface CDPMessage<TParams = unknown, TResult = unknown> {
  id: number;
  method?: string;
  params?: TParams;
  result?: TResult;
  error?: { message: string; code?: number };
}

// ✅ For console arguments, use discriminated unions
type ConsoleArgument =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'object'; value: Record<string, unknown>; description?: string }
  | { type: 'undefined' }
  | { type: 'null' };

interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  args?: ConsoleArgument[];
}
```

### 2. Use Discriminated Unions for State Management

**Current:**
```typescript
// ❌ Basic - doesn't prevent invalid states
interface BdgOutput {
  success: boolean;
  error?: string;
  data?: {...};
}
```

**Recommended (update existing types.ts):**
```typescript
// ✅ Better - type-safe state management
type BdgResult<T> =
  | { success: true; data: T; timestamp: string; duration: number }
  | { success: false; error: string; code: string; timestamp: string };

type SessionState =
  | { status: 'idle' }
  | { status: 'connecting'; port: number }
  | { status: 'collecting'; startTime: number; collectors: CollectorType[] }
  | { status: 'stopping' }
  | { status: 'error'; error: string };
```

### 3. Leverage Utility Types

```typescript
// ✅ Add to existing types.ts - no new files needed
type PartialNetworkRequest = Partial<NetworkRequest>;
type NetworkRequestKeys = keyof NetworkRequest;
type RequiredNetworkFields = Pick<NetworkRequest, 'requestId' | 'url' | 'method'>;
type OptionalNetworkFields = Omit<NetworkRequest, 'requestId' | 'url' | 'method'>;

// ✅ Create custom utility types for domain-specific needs
type WithTimestamp<T> = T & { timestamp: number };
type WithOptionalId<T> = T & { id?: string };
```

### 4. Generic Constraints for Type Safety

```typescript
// ✅ Add to existing files where generics are used
interface Identifiable {
  id: string;
}

function updateEntity<T extends Identifiable>(
  entity: T,
  updates: Partial<Omit<T, 'id'>>
): T {
  return { ...entity, ...updates };
}

// ✅ Enhance existing CDP connection class
interface CDPEventHandler<T extends Record<string, unknown> = Record<string, unknown>> {
  (params: T): void | Promise<void>;
}
```

## Import/Export Patterns

### 1. Type-Only Imports

**Current Issues:**
```typescript
// ❌ Mixed imports - includes runtime code for types
import { BdgOutput, CollectorType, CDPTarget } from '../types.js';
```

**Recommended (update existing import statements):**
```typescript
// ✅ Separate type and value imports
import type { BdgOutput, CollectorType, CDPTarget } from '../types.js';
import { validateCollectorTypes } from '../utils/validation.js';

// ✅ Inline type qualifiers when mixing
import { validateCollectorTypes, type CollectorType } from '../utils/validation.js';
```

### 2. Import Path Mapping for Cleaner Imports

**Update `tsconfig.json` with path mapping:**

```json
{
  "compilerOptions": {
    // ... existing options
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"],
      "@/types": ["./types.js"],
      "@/constants": ["./constants.js"],
      "@/utils/*": ["./utils/*"],
      "@/cli/*": ["./cli/*"],
      "@/collectors/*": ["./collectors/*"],
      "@/connection/*": ["./connection/*"],
      "@/session/*": ["./session/*"]
    }
  }
}
```

**Transform relative imports to logical paths:**

```typescript
// ❌ Before - hard to read, brittle relative paths
import { BdgSession } from '../../session/BdgSession.js';
import { BdgOutput, CollectorType } from '../../types.js';
import { normalizeUrl } from '../../utils/url.js';
import { createOrFindTarget } from '../../connection/tabs.js';

// ✅ After - clear, logical import paths
import { BdgSession } from '@/session/BdgSession.js';
import type { BdgOutput, CollectorType } from '@/types';
import { normalizeUrl } from '@/utils/url.js';
import { createOrFindTarget } from '@/connection/tabs.js';
```

### 3. Consistent Import Organization

```typescript
// ✅ Standardize import order with path mapping:
// 1. Node.js built-ins
import * as fs from 'fs';
import * as path from 'path';

// 2. Third-party libraries
import { Command } from 'commander';
import WebSocket from 'ws';

// 3. Internal types (type-only)
import type { CDPMessage, NetworkRequest, ConsoleMessage } from '@/types';

// 4. Internal modules (grouped by domain)
import { CDPConnection } from '@/connection/cdp.js';
import { normalizeUrl } from '@/utils/url.js';
import { BdgSession } from '@/session/BdgSession.js';
```

### 4. Organize types.ts by sections

```typescript
// ✅ Improve existing types.ts with clear sections (no new files)
// =============================================================================
// CDP Protocol Types
// =============================================================================
export interface CDPMessage<TParams = unknown, TResult = unknown> {
  // ... existing CDP types
}

// =============================================================================
// Data Collection Types
// =============================================================================
export interface NetworkRequest {
  // ... existing collector types
}

// =============================================================================
// Session Management Types
// =============================================================================
export interface SessionState {
  // ... existing session types
}

// =============================================================================
// Utility Types
// =============================================================================
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
```

## Error Handling

### 1. Result Pattern for Expected Errors

**Add to existing files without restructuring:**

```typescript
// ✅ Add to types.ts
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export interface HttpError {
  type: 'http_error';
  status: number;
  message: string;
  url: string;
}

export interface NetworkError {
  type: 'network_error';
  message: string;
  cause?: string;
}

export type FetchError = HttpError | NetworkError;

// ✅ Update existing connection/cdp.ts methods
async function safeFetch(url: string): Promise<Result<unknown, FetchError>> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        error: {
          type: 'http_error',
          status: response.status,
          message: response.statusText,
          url
        }
      };
    }
    const data = await response.json();
    return { success: true, data };
  } catch (cause) {
    return {
      success: false,
      error: {
        type: 'network_error',
        message: cause instanceof Error ? cause.message : 'Unknown network error',
        cause: cause instanceof Error ? cause.cause?.toString() : undefined
      }
    };
  }
}
```

### 2. Custom Error Classes for Exceptions

**Add to existing utils or create utils/errors.ts:**

```typescript
// ✅ Add to new file: src/utils/errors.ts (minimal addition)
export abstract class BdgError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'system' | 'user' | 'external';

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class CDPConnectionError extends BdgError {
  readonly code = 'CDP_CONNECTION_ERROR';
  readonly category = 'external';
}

export class SessionLockError extends BdgError {
  readonly code = 'SESSION_LOCK_ERROR';
  readonly category = 'user';
}

export class ChromeLaunchError extends BdgError {
  readonly code = 'CHROME_LAUNCH_ERROR';
  readonly category = 'system';
}
```

### 3. Async Error Boundaries

```typescript
// ✅ Add to existing utils/session.ts or utils/errors.ts
export async function safeAsync<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<Result<T, BdgError>> {
  try {
    const result = await operation();
    return { success: true, data: result };
  } catch (error) {
    const bdgError = error instanceof BdgError
      ? error
      : new BdgError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);

    return { success: false, error: bdgError };
  }
}
```

## Code Organization

### Current Structure (Keep As-Is - Well Organized)

```
src/
├── cli/                     # ✅ CLI interface (well organized)
│   ├── commands/           # ✅ Individual commands
│   ├── formatters/         # ✅ Output formatting
│   ├── handlers/           # ✅ Business logic handlers
│   └── registry.ts         # ✅ Command registration
├── collectors/             # ✅ Data collection (domain-focused)
├── connection/             # ✅ CDP connection logic (well-grouped)
├── session/                # ✅ Session management (appropriate)
├── utils/                  # ✅ Shared utilities (standard)
├── constants.ts            # ✅ Configuration constants
├── types.ts               # ✅ All types in one place (fine for current size)
└── index.ts               # ✅ Entry point
```

### Why This Structure Works

1. **Right-sized for the project**: ~30 files don't need complex domain architecture
2. **Functionally organized**: Each folder has a clear purpose
3. **Easy to navigate**: Developers can find things intuitively
4. **Low maintenance**: Simple structure means less reorganization overhead
5. **CLI-appropriate**: Structure matches the CLI tool's natural boundaries


### Interface Segregation (Within Existing Files)

```typescript
// ✅ Improve existing interfaces by splitting when they get large
interface NetworkRequestBasic {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
}

interface NetworkRequestWithHeaders extends NetworkRequestBasic {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

interface NetworkRequestComplete extends NetworkRequestWithHeaders {
  status?: number;
  mimeType?: string;
  requestBody?: string;
  responseBody?: string;
}
```

## Performance Considerations

### 1. Lazy Loading & Code Splitting

```typescript
// ✅ Update existing launcher.ts
async function launchChromeIfNeeded(): Promise<LaunchedChrome | null> {
  if (await isChromeRunning()) {
    return null;
  }

  // Lazy load chrome launcher only when needed
  const chromeLauncher = await import('chrome-launcher');
  return launchChrome();
}
```

### 2. Type-Level Optimizations

```typescript
// ✅ Improve existing constants.ts
export const COLLECTOR_TYPES = ['dom', 'network', 'console'] as const;
export type CollectorType = typeof COLLECTOR_TYPES[number];

// ✅ Add template literal types to types.ts
type EventName<T extends string> = `${T}Event`;
type CDPMethod = `${string}.${string}`;
```

### 3. Memory Management

```typescript
// ✅ Enhance existing session/BdgSession.ts
class ResourceManager {
  private resources = new Set<() => void>();

  addCleanup(cleanup: () => void): void {
    this.resources.add(cleanup);
  }

  cleanup(): void {
    for (const cleanup of this.resources) {
      try {
        cleanup();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
    this.resources.clear();
  }
}
```

## Migration Strategy

### ✅ Phase 1: Configuration & Import Paths (Zero Structure Changes)
1. Update `tsconfig.json` with path mapping and additional strict options
2. Replace relative imports (`../../`) with logical paths (`@/`)
3. Add type-only imports to existing import statements
4. Add ESLint configuration

**Timeline: 1-2 days, immediate developer experience improvement**

### ✅ Phase 2: Error Handling (Minimal File Changes)
1. Add `src/utils/errors.ts` (one new file)
2. Add Result pattern types to existing `types.ts`
3. Update error handling in existing functions
4. No file moves or restructuring

**Timeline: 2-3 days**

### ✅ Phase 3: Type System Enhancements (Within Existing Files)
1. Improve type definitions in existing `types.ts`
2. Add generic constraints to existing classes
3. Implement discriminated unions for state management
4. Add utility types as needed

**Timeline: 1-2 days**

### ✅ Phase 4: Only If Project Grows (Future Consideration)
1. Consider splitting `types.ts` only if it exceeds 500 lines
2. Consider additional domain folders only if adding major new features
3. No premature optimization of structure

**Timeline: Only when actually needed**

## Tooling & Linting

### ESLint Configuration

**Create `.eslintrc.json`:**

```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "@typescript-eslint/recommended",
    "@typescript-eslint/recommended-requiring-type-checking"
  ],
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "settings": {
    "import/resolver": {
      "typescript": {
        "project": "./tsconfig.json"
      }
    }
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    "@typescript-eslint/prefer-optional-chain": "error",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { "prefer": "type-imports" }
    ],
    "@typescript-eslint/consistent-type-exports": [
      "error",
      { "fixMixedExportsWithInlineTypeSpecifier": true }
    ],
    "@typescript-eslint/explicit-function-return-type": [
      "warn",
      { "allowExpressions": true }
    ],
    "import/no-unresolved": "error"
  }
}
```

### Package Scripts

**Update `package.json`:**

```json
{
  "scripts": {
    "build": "tsc",
    "postbuild": "node -e \"require('fs').chmodSync('dist/index.js', 0o755)\"",
    "dev": "tsc && node dist/index.js",
    "watch": "tsc --watch",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.10",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "eslint-import-resolver-typescript": "^3.6.0",
    "eslint-plugin-import": "^2.29.0",
    "typescript": "^5.6.0"
  }
}
```

## Practical Implementation Checklist

### ✅ Immediate Actions (No Breaking Changes)
- [ ] Add path mapping to `tsconfig.json`
- [ ] Add new strict TypeScript options
- [ ] Replace relative imports with `@/` paths throughout codebase
- [ ] Add `import type` to existing import statements
- [ ] Install ESLint and TypeScript rules
- [ ] Organize imports in consistent order

### ✅ Quick Type Safety Wins (Within Existing Files)
- [ ] Replace `any` with `unknown` where appropriate
- [ ] Add specific types for CDP message params
- [ ] Add discriminated unions for console arguments
- [ ] Add Result types to `types.ts`

### ✅ Error Handling (Minimal File Addition)
- [ ] Create `src/utils/errors.ts` with custom error classes
- [ ] Add Result pattern helper functions
- [ ] Update key functions to use Result pattern
- [ ] Add async error boundaries where needed

### ✅ Long-term Maintenance
- [ ] Monitor `types.ts` size (split if > 500 lines)
- [ ] Add new utility types as domain grows
- [ ] Consider domain folders only with major feature additions
- [ ] Regular dependency updates and type checking

### ❌ Avoid (Premature Optimization)
- [ ] Don't reorganize into domain folders immediately
- [ ] Don't split types.ts unless it becomes unwieldy
- [ ] Don't add complex architectural patterns for current project size
- [ ] Don't over-engineer simple functions

## Import Path Benefits

### Before (Relative Paths):
```typescript
// ❌ Hard to read, brittle
import { BdgSession } from '../../session/BdgSession.js';
import { BdgOutput } from '../../types.js';
import { normalizeUrl } from '../../utils/url.js';
```

### After (Logical Paths):
```typescript
// ✅ Clear, maintainable
import { BdgSession } from '@/session/BdgSession.js';
import type { BdgOutput } from '@/types';
import { normalizeUrl } from '@/utils/url.js';
```

### Key Benefits:
1. **Shorter imports**: `@/types` vs `../../types.js`
2. **Refactor-safe**: Moving files doesn't break imports across the tree
3. **Logical organization**: Clear domain boundaries (`@/utils`, `@/cli`, etc.)
4. **Better autocomplete**: IDE can better suggest completions
5. **Consistent patterns**: Same import style regardless of file location

## Benefits of This Approach

1. **Incremental**: Changes can be made gradually without disruption
2. **Low Risk**: No major restructuring that could introduce bugs
3. **Immediate Value**: Import paths provide instant developer experience improvement
4. **Maintainable**: Keeps the currently well-organized structure
5. **Scalable**: Can evolve the structure as the project actually grows

## Conclusion

This guide provides a **realistic, incremental approach** to modernizing the bdg CLI TypeScript codebase. The current file structure is appropriate for the project size, so focus on improving code quality within the existing organization rather than premature architectural changes.

Start with configuration and type safety improvements, then gradually enhance error handling and type system usage. Only consider structural changes if the project significantly grows in scope and complexity.

Each improvement can be implemented and tested independently, ensuring the codebase remains stable while steadily improving in quality and maintainability.
