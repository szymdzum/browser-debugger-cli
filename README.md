# bdg - Browser Telemetry CLI

Simple CLI tool to collect browser telemetry (DOM, network, console) via Chrome DevTools Protocol. Designed for agentic use.

## Features

- 🔍 **Read-only observation** - Collects telemetry without interfering
- 🎯 **Target-specific** - Connect to specific tabs by URL
- ⏱️ **Run-until-stopped** - Human/agent controls collection timing
- 📊 **JSON output** - Structured data for easy parsing
- 🚀 **Simple** - One command, clean output

## Installation

### From npm (once published)

```bash
npm install -g bdg
```

### Local Development

```bash
# Clone and install
npm install

# Build
npm run build

# Link for global use
npm link
```

## Quick Start

### 1. Start Chrome with debugging

**Chrome 136+ (required):**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg

# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg

# Windows:
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\temp\chrome-bdg
```

**Recommended flags:**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg \
  --no-first-run \
  --no-default-browser-check \
  --disable-search-engine-choice-screen
```

### 2. Open your target page in Chrome

Navigate to the page you want to collect telemetry from (e.g., `http://localhost:3000`)

### 3. Run bdg

```bash
bdg localhost:3000
```

**Output:**
```
Connected to http://localhost:3000
Collecting network, console, and DOM... (Ctrl+C to stop and output)
```

### 4. Interact with the page

- Login
- Navigate
- Click buttons
- Submit forms
- Wait for requests to complete

### 5. Stop collection (Ctrl+C)

```
^C
Capturing final state...
{
  "success": true,
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

## Usage

### Collect everything (default)

```bash
bdg localhost:3000
bdg example.com
bdg http://localhost:8080/app
```

### Collect specific data

```bash
bdg dom localhost:3000       # DOM only
bdg network example.com      # Network only
bdg console localhost:3000   # Console only
```

### Custom port

```bash
bdg localhost:3000 --port 9223
```

### Auto-timeout (optional)

```bash
bdg localhost:3000 --timeout 30   # Auto-stop after 30 seconds
```

## Output Format

```json
{
  "success": true,
  "timestamp": "2025-10-29T10:30:00.000Z",
  "duration": 45230,
  "target": {
    "url": "http://localhost:3000/dashboard",
    "title": "Dashboard"
  },
  "data": {
    "network": [
      {
        "requestId": "123.1",
        "url": "http://localhost:3000/api/login",
        "method": "POST",
        "timestamp": 1730198400.123,
        "status": 200,
        "mimeType": "application/json"
      }
    ],
    "console": [
      {
        "type": "log",
        "text": "User logged in successfully",
        "timestamp": 1730198400.456,
        "args": [...]
      }
    ],
    "dom": {
      "url": "http://localhost:3000/dashboard",
      "title": "Dashboard",
      "outerHTML": "<!DOCTYPE html>..."
    }
  }
}
```

## Agent Usage

### Node.js Example

```javascript
const { spawn } = require('child_process');

// Start collection
const proc = spawn('bdg', ['localhost:3000']);

let output = '';
proc.stdout.on('data', (data) => {
  output += data.toString();
});

// Tell human to interact
console.log('Please login and navigate to the dashboard');
console.log('Press Ctrl+C when done');

// Wait for completion
proc.on('exit', (code) => {
  if (code === 0) {
    const telemetry = JSON.parse(output);
    console.log('Collected:', telemetry.data.network.length, 'requests');
  }
});

// Or programmatically stop after some condition
setTimeout(() => {
  proc.kill('SIGINT'); // Graceful stop
}, 30000);
```

### Python Example

```python
import subprocess
import json
import signal
import time

# Start collection
proc = subprocess.Popen(
    ['bdg', 'localhost:3000'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

print('Please login and navigate to the dashboard')
print('Press Ctrl+C when done')

# Wait for user or timeout
time.sleep(30)

# Stop collection
proc.send_signal(signal.SIGINT)
output, _ = proc.communicate()

# Parse results
telemetry = json.loads(output)
print(f"Collected {len(telemetry['data']['network'])} requests")
```

## Troubleshooting

### "Chrome not responding on port 9222"

**Solution:** Start Chrome with `--remote-debugging-port=9222`

### "No browser tab found for: localhost:3000"

**Solution:** Make sure the page is open in Chrome. Check available tabs in the error message.

### "Cannot connect to Chrome on port 9222"

**Solutions:**
1. Check Chrome is running with debugging enabled
2. Check port 9222 is not blocked by firewall
3. Try a different port: `bdg localhost:3000 --port 9223`

### Chrome 136+ - DevToolsActivePort error

**Solution:** Must use `--user-data-dir` with a non-default directory:
```bash
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg
```

## Requirements

- Node.js >= 18.0.0
- Chrome/Chromium with remote debugging enabled

## Why bdg?

**For agents:**
- ✅ Simple CLI interface (no complex protocols)
- ✅ JSON output (easy to parse)
- ✅ Exit codes (0 = success, >0 = error)
- ✅ Read-only (safe observation)
- ✅ Token-efficient (human does complex interactions)

**For humans:**
- ✅ Quick setup (one command)
- ✅ Natural workflow (interact then collect)
- ✅ Clear output (structured JSON)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Test locally
npm link
bdg localhost:3000
```

## License

MIT

## Contributing

Issues and PRs welcome!
