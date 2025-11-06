# CLI Reference

Complete command reference for **bdg** (Browser Debugger CLI).

## Session Lifecycle

### Start a session
```bash
bdg localhost:3000
# Launches daemon in background
# Returns immediately after handshake
```

### Check session status
```bash
bdg status                      # Basic status information
bdg status --verbose            # Include Chrome diagnostics
bdg status --json               # JSON output
```

### Stop the session
```bash
bdg stop
# Sends stop command via IPC
# Daemon shuts down gracefully
# Final output written to ~/.bdg/session.json
```

## Live Monitoring

### Preview collected data
```bash
bdg peek                        # Last 10 items (compact format)
bdg peek --last 50              # Show last 50 items
bdg peek --network              # Show only network requests
bdg peek --console              # Show only console messages
bdg peek --follow               # Live updates every second
bdg peek --json                 # JSON output
bdg peek --verbose              # Verbose output (full URLs, emojis)
```

### Get full details
```bash
bdg details network <requestId>     # Full request/response with bodies
bdg details console <index>         # Full console message with args
```

## Maintenance

### Clean up stale sessions
```bash
bdg cleanup                     # Remove stale session files
bdg cleanup --force             # Force cleanup even if session appears active
bdg cleanup --aggressive        # Kill all Chrome processes
```

## Collection Options

**Note:** All three collectors (DOM, network, console) are enabled by default.
DOM data is captured as a snapshot at session end, while network and console data stream continuously.

### Basic Options
```bash
bdg localhost:3000 --port 9223              # Custom CDP port
bdg localhost:3000 --timeout 30             # Auto-stop after timeout
bdg localhost:3000 --all                    # Include all data (disable filtering)
bdg localhost:3000 --user-data-dir ~/custom # Custom Chrome profile directory
```

### Performance Optimization
```bash
# Network Optimization (50-80% data reduction)
bdg localhost:3000 --fetch-all-bodies                          # Fetch all bodies (override auto-skip)
bdg localhost:3000 --fetch-bodies-include "*/api/*,*/graphql"  # Only fetch specific patterns
bdg localhost:3000 --fetch-bodies-exclude "*tracking*"         # Additional patterns to skip
bdg localhost:3000 --network-include "api.example.com"         # Only capture specific hosts
bdg localhost:3000 --network-exclude "*analytics*,*ads*"       # Exclude tracking domains

# Output Optimization (30% size reduction)
bdg localhost:3000 --compact                                    # Compact JSON (no indentation)
```

### Pattern Syntax
Simple wildcards (* matches anything):
- `api.example.com` → matches all requests to that host
- `*/api/*` → matches any path containing /api/
- `*analytics*` → matches any hostname with "analytics"
- `*.png` → matches all PNG images

**Pattern Precedence:** Include always trumps exclude
```bash
--network-include "api.example.com" --network-exclude "*example.com"
# Result: api.example.com is captured despite exclude pattern
```

**Note:** Chrome 136+ requires `--user-data-dir` with a non-default directory. See CHROME_SETUP.md for details.

## Session Files

bdg stores session data in `~/.bdg/`:

- **daemon.pid** - Daemon process ID
- **daemon.sock** - Unix socket for IPC
- **session.meta.json** - Session metadata (Chrome PID, CDP port, target info)
- **session.json** - Final output (written on stop only)
- **chrome-profile/** - Chrome user data directory

**Key Behaviors:**
- **Only one session at a time**: Lock prevents concurrent sessions
- **Automatic cleanup**: All session files removed on stop
- **Stale session detection**: Automatically cleans up if PID is dead
- **No intermediate writes**: Data stays in memory until stop (IPC queries access live data)

## Output Format

### Success Format
```json
{
  "version": "0.2.0",
  "success": true,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "duration": 45230,
  "target": {
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard"
  },
  "data": {
    "network": [...],
    "console": [...],
    "dom": {...}
  }
}
```

### Error Format
```json
{
  "version": "0.2.0",
  "success": false,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "duration": 1234,
  "target": { "url": "", "title": "" },
  "data": {},
  "error": "Error message here"
}
```

See `src/types.ts` for complete type definitions.
