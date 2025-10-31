# browser-debugger-cli

CLI tool for collecting browser telemetry (DOM, network, console) via Chrome DevTools Protocol.

## Installation

```bash
npm install -g browser-debugger-cli
```

## Quick Start

**1. Start Chrome with debugging enabled:**
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\temp\chrome-bdg
```

**2. Open your target page in Chrome**

**3. Run the CLI:**
```bash
bdg localhost:3000
```

**4. Interact with the page, then press Ctrl+C**

JSON output with collected network requests, console logs, and DOM will be written to stdout.

## Usage

```bash
# Collect all telemetry (default)
bdg localhost:3000

# Collect specific data
bdg dom localhost:3000
bdg network localhost:3000
bdg console localhost:3000

# Options
bdg localhost:3000 --port 9223
bdg localhost:3000 --timeout 30
```

## Output

```json
{
  "success": true,
  "duration": 45230,
  "target": { "url": "...", "title": "..." },
  "data": {
    "network": [...],
    "console": [...],
    "dom": {...}
  }
}
```

## Documentation

See [CHROME_SETUP.md](./CHROME_SETUP.md) for Chrome configuration details.

## Requirements

- Node.js >= 18.0.0
- Chrome/Chromium with remote debugging

## License

MIT
