# bdg Project Structure

## Files Included

```
bdg-project/
├── package.json                    # NPM package configuration
├── tsconfig.json                   # TypeScript compiler configuration
├── .gitignore                      # Git ignore rules
├── .npmignore                      # NPM publish ignore rules
├── README.md                       # Main documentation
├── INSTALL.md                      # Quick installation guide
├── CHROME_SETUP.md                 # Detailed Chrome configuration guide
└── src/
    ├── index.ts                    # CLI entry point with signal handling
    ├── types.ts                    # TypeScript type definitions
    ├── connection/
    │   ├── cdp.ts                  # CDP WebSocket client
    │   └── finder.ts               # Target discovery (find browser tabs)
    └── collectors/
        ├── dom.ts                  # DOM snapshot collector
        ├── network.ts              # Network request collector
        └── console.ts              # Console log collector
```

## File Descriptions

### Configuration Files

**package.json**
- Project metadata
- Dependencies: commander (CLI), ws (WebSocket)
- Build scripts
- Binary configuration for global installation

**tsconfig.json**
- TypeScript compiler settings
- ES2022 target
- Strict mode enabled
- ES modules output

**.gitignore**
- Ignores node_modules, dist, logs, IDE files

**.npmignore**
- Ignores source files when publishing to npm
- Only distributes built JavaScript

### Documentation

**README.md**
- Quick start guide
- Usage examples
- API reference
- Troubleshooting

**INSTALL.md**
- Step-by-step installation
- Quick test instructions
- Platform-specific commands

**CHROME_SETUP.md**
- Chrome 136+ requirements
- All command-line flags explained
- Profile management
- Troubleshooting Chrome issues
- Security considerations

### Source Code

**src/index.ts** (Main entry point)
- CLI command definitions (commander)
- Signal handlers (SIGINT/SIGTERM)
- Graceful shutdown logic
- Output formatting
- ~200 lines

**src/types.ts** (Type definitions)
- CDPMessage, CDPTarget
- DOMData, NetworkRequest, ConsoleMessage
- BdgOutput (final JSON structure)
- CollectorType enum
- ~60 lines

**src/connection/cdp.ts** (CDP client)
- WebSocket connection management
- Request/response handling
- Event subscription
- Message ID tracking
- Connection lifecycle
- ~120 lines

**src/connection/finder.ts** (Target finder)
- Fetch available tabs from Chrome
- Match URL patterns
- Helpful error messages
- List available tabs when not found
- ~70 lines

**src/collectors/dom.ts** (DOM collector)
- Get document structure
- Extract outer HTML
- Capture page title and URL
- ~25 lines

**src/collectors/network.ts** (Network collector)
- Enable Network domain
- Listen for request events
- Track request/response pairs
- Accumulate network activity
- ~60 lines

**src/collectors/console.ts** (Console collector)
- Enable Runtime and Log domains
- Listen for console API calls
- Capture exceptions
- Format console arguments
- ~50 lines

## Build Output

After running `npm run build`, the following is generated:

```
dist/
├── index.js                        # Compiled CLI entry
├── index.d.ts                      # Type declarations
├── types.js
├── types.d.ts
├── connection/
│   ├── cdp.js
│   ├── cdp.d.ts
│   ├── finder.js
│   └── finder.d.ts
└── collectors/
    ├── dom.js
    ├── dom.d.ts
    ├── network.js
    ├── network.d.ts
    ├── console.js
    └── console.d.ts
```

## Key Design Decisions

### 1. Commander for CLI
- Clean command structure
- Auto-generated help
- Type-safe arguments
- Standard CLI patterns

### 2. Signal-Based Lifecycle
- SIGINT (Ctrl+C) for graceful stop
- Collect data until user stops
- No arbitrary timeouts
- Natural workflow

### 3. Event Collection Pattern
- Start collecting immediately on connect
- Accumulate events during session
- Capture DOM snapshot on stop
- All events timestamped

### 4. Clean Separation
- Connection logic separate from collection
- Each collector is independent
- Easy to add new collectors
- Minimal coupling

### 5. JSON Output
- Structured, parseable format
- Exit codes for success/failure
- Timestamps for ordering
- Duration tracking

## Adding New Collectors

To add a new collector (e.g., performance metrics):

1. Create `src/collectors/performance.ts`:
```typescript
import { CDPConnection } from '../connection/cdp.js';

export async function startPerformanceCollection(
  cdp: CDPConnection,
  metrics: PerformanceMetric[]
): Promise<void> {
  await cdp.send('Performance.enable');
  
  cdp.on('Performance.metrics', (params: any) => {
    metrics.push({
      name: params.name,
      value: params.value,
      timestamp: Date.now()
    });
  });
}
```

2. Add type to `src/types.ts`:
```typescript
export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
}

export type CollectorType = 'dom' | 'network' | 'console' | 'performance';
```

3. Add command in `src/index.ts`:
```typescript
program
  .command('performance')
  .description('Collect performance metrics')
  .argument('<url>', 'Target URL')
  .action(async (url: string, options) => {
    await run(url, options, ['performance']);
  });
```

## Dependencies

### Production
- **commander** (^12.1.0) - CLI framework
- **ws** (^8.18.0) - WebSocket client

### Development
- **typescript** (^5.6.0) - TypeScript compiler
- **@types/node** (^20.0.0) - Node.js type definitions
- **@types/ws** (^8.5.10) - ws type definitions

Total size: ~9.5KB (compressed)

## License

MIT